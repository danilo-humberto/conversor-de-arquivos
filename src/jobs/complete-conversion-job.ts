import { randomUUID } from "node:crypto";

import { database } from "../db/connection.js";

type CompleteConversionJobInput = {
  jobId: string;
  processingToken: string;
  resultBucket: string;
  resultObjectKey: string;
};

export class JobCompletionError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "JobCompletionError";
  }
}

export async function completeConversionJob(
  input: CompleteConversionJobInput,
): Promise<void> {
  const client = await database.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const updatedJob = await client.query<{ id: string }>(
      `
        UPDATE jobs
        SET
          status = 'CONCLUÍDO',
          result_bucket = $3,
          result_object_key = $4,
          processing_token = NULL,
          lease_expires_at = NULL,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
          AND status = 'PROCESSANDO'
          AND processing_token = $2
        RETURNING id
      `,
      [
        input.jobId,
        input.processingToken,
        input.resultBucket,
        input.resultObjectKey,
      ],
    );

    if (updatedJob.rowCount !== 1) {
      throw new JobCompletionError(
        "Job could not be completed because its lease is no longer valid.",
      );
    }

    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();

    await client.query(
      `
        INSERT INTO outbox_events (
          id,
          job_id,
          event_type,
          payload,
          status
        )
        VALUES ($1, $2, $3, $4::jsonb, 'PENDING')
      `,
      [
        eventId,
        input.jobId,
        "conversion.completed",
        JSON.stringify({
          eventId,
          type: "conversion.completed",
          jobId: input.jobId,
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
