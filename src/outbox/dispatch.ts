import { randomUUID } from "node:crypto";

import {
  createRabbitMqConfirmChannel,
} from "../broker/rabbitmq.js";
import { database } from "../db/connection.js";
import { getOutboxDestinationQueue } from "./event-routing.js";

const OUTBOX_LEASE_DURATION_MS = 60_000;

type ClaimedOutboxEvent = {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  processingToken: string;
};

type OutboxRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  processing_token: string;
};

async function claimNextOutboxEvent(): Promise<ClaimedOutboxEvent | null> {
  const client = await database.connect();
  let transactionOpen = false;

  try {
    const processingToken = randomUUID();

    await client.query("BEGIN");
    transactionOpen = true;

    const result = await client.query<OutboxRow>(
      `
        WITH next_event AS (
          SELECT id
          FROM outbox_events
          WHERE status = 'PENDING'
             OR (
               status = 'PUBLISHING'
               AND lease_expires_at < NOW()
             )
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE outbox_events AS event
        SET
          status = 'PUBLISHING',
          processing_token = $1,
          lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond')
        FROM next_event
        WHERE event.id = next_event.id
        RETURNING
          event.id,
          event.event_type,
          event.payload,
          event.processing_token
      `,
      [processingToken, OUTBOX_LEASE_DURATION_MS],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    const event = result.rows.at(0);

    if (!event) {
      return null;
    }

    return {
      id: event.id,
      eventType: event.event_type,
      payload: event.payload,
      processingToken: event.processing_token,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function markOutboxEventAsPublished(
  eventId: string,
  processingToken: string,
): Promise<void> {
  const result = await database.query(
    `
      UPDATE outbox_events
      SET
        status = 'PUBLISHED',
        published_at = NOW(),
        processing_token = NULL,
        lease_expires_at = NULL
      WHERE id = $1
        AND status = 'PUBLISHING'
        AND processing_token = $2
    `,
    [eventId, processingToken],
  );

  if (result.rowCount !== 1) {
    throw new Error("Outbox event could not be marked as published.");
  }
}

export async function dispatchNextOutboxEvent(): Promise<boolean> {
  const event = await claimNextOutboxEvent();

  if (!event) {
    return false;
  }

  const { connection, channel } = await createRabbitMqConfirmChannel();

  try {
    channel.sendToQueue(
      getOutboxDestinationQueue(event.eventType),
      Buffer.from(JSON.stringify(event.payload)),
      {
        contentType: "application/json",
        messageId: event.id,
        persistent: true,
        type: event.eventType,
      },
    );

    await channel.waitForConfirms();

    await markOutboxEventAsPublished(event.id, event.processingToken);

    return true;
  } finally {
    await channel.close();
    await connection.close();
  }
}

export async function dispatchPendingOutboxEvents(): Promise<number> {
  let dispatchedEvents = 0;

  while (await dispatchNextOutboxEvent()) {
    dispatchedEvents += 1;
  }

  return dispatchedEvents;
}
