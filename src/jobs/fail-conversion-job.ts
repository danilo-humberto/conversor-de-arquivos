import { randomUUID } from "node:crypto";

import { serializeConversionFinishedEvent } from "../contracts/conversion-events.js";
import { database } from "../db/connection.js";

type JobFailureInput = {
  jobId: string;
  processingToken: string;
  errorMessage: string;
  notifyEmail?: string;
};

export class JobFailureError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "JobFailureError";
  }
}

export async function releaseConversionJobForRetry(
  input: JobFailureInput,
): Promise<void> {
  const result = await database.query(
    `
      UPDATE jobs
      SET
        status = 'PENDENTE',
        processing_token = NULL,
        lease_expires_at = NULL,
        last_error = $3,
        updated_at = NOW()
      WHERE id = $1
        AND status = 'PROCESSANDO'
        AND processing_token = $2
    `,
    [input.jobId, input.processingToken, input.errorMessage],
  );

  if (result.rowCount !== 1) {
    throw new JobFailureError(
      "Job could not be released for retry because its lease is no longer valid.",
    );
  }
}

export async function markConversionJobAsFailed(
  input: JobFailureInput,
): Promise<void> {
  if (!input.notifyEmail) {
    throw new JobFailureError("notifyEmail is required for a failed conversion.");
  }

  const client = await database.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const result = await client.query(
      `
        UPDATE jobs
        SET
          status = 'ERRO',
          processing_token = NULL,
          lease_expires_at = NULL,
          last_error = $3,
          updated_at = NOW()
        WHERE id = $1
          AND status = 'PROCESSANDO'
          AND processing_token = $2
      `,
      [input.jobId, input.processingToken, input.errorMessage],
    );

    if (result.rowCount !== 1) {
      throw new JobFailureError(
        "Job could not be marked as failed because its lease is no longer valid.",
      );
    }

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    await client.query(
      `
        INSERT INTO outbox_events (id, job_id, event_type, payload, status)
        VALUES ($1, $2, 'conversion.finished', $3::jsonb, 'PENDING')
      `,
      [
        eventId,
        input.jobId,
        serializeConversionFinishedEvent({
          eventId,
          type: "conversion.finished",
          jobId: input.jobId,
          notifyEmail: input.notifyEmail,
          status: "ERRO",
          resultUrl: null,
          error: input.errorMessage,
          occurredAt,
        }),
      ],
    );

    await client.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}
