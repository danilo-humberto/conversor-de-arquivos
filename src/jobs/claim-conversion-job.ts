import { randomUUID } from "node:crypto";

import { database } from "../db/connection.js";
import { MAX_CONVERSION_ATTEMPTS } from "../contracts/processing-policy.js";

export const CONVERSION_JOB_LEASE_DURATION_MS = 120 * 1000;

type JobRow = {
  id: string;
  attempt_count: number;
  processing_token: string;
  source_bucket: string;
  source_object_key: string;
  attempts_exhausted: boolean;
};

export type ClaimedConversionJob = {
  id: string;
  attemptCount: number;
  processingToken: string;
  sourceBucket: string;
  sourceObjectKey: string;
  attemptsExhausted: boolean;
};

export async function claimConversionJob(
  jobId: string,
): Promise<ClaimedConversionJob | null> {
  const processingToken = randomUUID();

  const result = await database.query<JobRow>(
    `
      WITH available_job AS (
        SELECT id, attempt_count
        FROM jobs
        WHERE id = $1
          AND (
            status = 'PENDENTE'
            OR (status = 'PROCESSANDO' AND lease_expires_at < NOW())
          )
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs AS job
      SET
        status = 'PROCESSANDO',
        attempt_count = CASE
          WHEN available_job.attempt_count < $4 THEN available_job.attempt_count + 1
          ELSE available_job.attempt_count
        END,
        processing_token = $2,
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      FROM available_job
      WHERE job.id = available_job.id
        RETURNING
          job.id,
          job.attempt_count,
          job.processing_token,
          job.source_bucket,
          job.source_object_key,
          available_job.attempt_count >= $4 AS attempts_exhausted
    `,
    [jobId, processingToken, CONVERSION_JOB_LEASE_DURATION_MS, MAX_CONVERSION_ATTEMPTS],
  );

  const job = result.rows.at(0);

  if (!job) {
    return null;
  }

  return {
    id: job.id,
    attemptCount: job.attempt_count,
    processingToken: job.processing_token,
    sourceBucket: job.source_bucket,
    sourceObjectKey: job.source_object_key,
    attemptsExhausted: job.attempts_exhausted,
  };
}

export async function renewConversionJobLease(
  jobId: string,
  processingToken: string,
): Promise<boolean> {
  const result = await database.query<{ id: string }>(
    `
      UPDATE jobs
      SET
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'PROCESSANDO'
        AND processing_token = $2
        AND lease_expires_at > NOW()
      RETURNING id
    `,
    [jobId, processingToken, CONVERSION_JOB_LEASE_DURATION_MS],
  );

  return result.rowCount === 1;
}

type JobStateRow = {
  status: string;
  lease_expires_at: Date | null;
};

export type ConversionJobState = {
  status: string;
  leaseExpiresAt: Date | null;
};

export async function getConversionJobState(
  jobId: string,
): Promise<ConversionJobState | null> {
  const result = await database.query<JobStateRow>(
    `
      SELECT
        status,
        lease_expires_at
      FROM jobs
      WHERE id = $1
    `,
    [jobId],
  );

  const job = result.rows.at(0);

  if (!job) {
    return null;
  }

  return {
    status: job.status,
    leaseExpiresAt: job.lease_expires_at,
  };
}
