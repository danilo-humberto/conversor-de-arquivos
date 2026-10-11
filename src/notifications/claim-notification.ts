import { randomUUID } from "node:crypto";

import { database } from "../db/connection.js";
import { MAX_NOTIFICATION_ATTEMPTS } from "../contracts/processing-policy.js";

const NOTIFICATION_LEASE_DURATION_MS = 2 * 60 * 1000;

type NotificationRow = {
  job_id: string;
  attempt_count: number;
  notification_token: string;
  attempts_exhausted: boolean;
  delivery_uncertain: boolean;
};

export type ClaimedNotification = {
  jobId: string;
  attemptCount: number;
  notificationToken: string;
  attemptsExhausted: boolean;
  deliveryUncertain: boolean;
};

export async function claimNotification(
  jobId: string,
): Promise<ClaimedNotification | null> {
  const client = await database.connect();
  let transactionOpen = false;

  try {
    const processingToken = randomUUID();

    await client.query("BEGIN");
    transactionOpen = true;

    await client.query(
      `
        INSERT INTO notifications (
          job_id,
          status
        )
        VALUES ($1, 'PENDING')
        ON CONFLICT (job_id) DO NOTHING
      `,
      [jobId],
    );

    const result = await client.query<NotificationRow>(
      `
        WITH available_notification AS (
          SELECT notification.job_id, notification.attempt_count, notification.status
          FROM notifications AS notification
          JOIN jobs ON notification.job_id = jobs.id
          WHERE notification.job_id = $1
            AND jobs.status IN ('CONCLUÍDO', 'ERRO')
            AND (
              notification.status = 'PENDING'
              OR (
                notification.status = 'SENDING'
                AND notification.lease_expires_at < NOW()
              )
            )
          FOR UPDATE OF notification SKIP LOCKED
        )
        UPDATE notifications AS notification
        SET
          status = 'SENDING',
          attempt_count = CASE
            WHEN available_notification.status = 'PENDING' AND available_notification.attempt_count < $4 THEN available_notification.attempt_count + 1
            ELSE available_notification.attempt_count
          END,
          notification_token = $2,
          lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          updated_at = NOW()
        FROM available_notification
        WHERE notification.job_id = available_notification.job_id
        RETURNING
          notification.job_id,
          notification.attempt_count,
          notification.notification_token,
          available_notification.attempt_count >= $4 AS attempts_exhausted,
          available_notification.status = 'SENDING' AS delivery_uncertain
      `,
      [jobId, processingToken, NOTIFICATION_LEASE_DURATION_MS, MAX_NOTIFICATION_ATTEMPTS],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    const notification = result.rows.at(0);

    if (!notification) {
      return null;
    }

    return {
      jobId: notification.job_id,
      attemptCount: notification.attempt_count,
      notificationToken: notification.notification_token,
      attemptsExhausted: notification.attempts_exhausted,
      deliveryUncertain: notification.delivery_uncertain,
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

type NotificationStateRow = {
  status: string;
  lease_expires_at: Date | null;
};

export type NotificationState = {
  status: string;
  leaseExpiresAt: Date | null;
};

export async function getNotificationState(
  jobId: string,
): Promise<NotificationState | null> {
  const result = await database.query<NotificationStateRow>(
    `
      SELECT
        status,
        lease_expires_at
      FROM notifications
      WHERE job_id = $1
    `,
    [jobId],
  );

  const notification = result.rows.at(0);

  if (!notification) {
    return null;
  }

  return {
    status: notification.status,
    leaseExpiresAt: notification.lease_expires_at,
  };
}
