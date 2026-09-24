import { randomUUID } from "node:crypto";

import { database } from "../db/connection.js";

const JOB_LEASE_DURATION_MS = 5 * 60 * 1000;

type JobRow = {
  id: string;
  attempt_count: number;
  processing_token: string;
};

export type ClaimedConversionJob = {
  id: string;
  attemptCount: number;
  processingToken: string;
};

export async function claimConversionJob(
  jobId: string,
): Promise<ClaimedConversionJob | null> {
  const processingToken = randomUUID();

  const result = await database.query<JobRow>(
    `
      UPDATE jobs
      SET
        status = 'PROCESSANDO',
        attempt_count = attempt_count + 1,
        processing_token = $2,
        lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
        updated_at = NOW()
      WHERE id = $1
        AND (
          status = 'PENDENTE'
          OR (
            status = 'PROCESSANDO'
            AND lease_expires_at < NOW()
          )
        )
        RETURNING
          id,
          attempt_count,
        processing_token
    `,
    [jobId, processingToken, JOB_LEASE_DURATION_MS],
  );

  const job = result.rows.at(0);

  if (!job) {
    return null;
  }

  return {
    id: job.id,
    attemptCount: job.attempt_count,
    processingToken: job.processing_token,
  };
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
