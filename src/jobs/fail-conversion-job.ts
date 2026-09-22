import { database } from "../db/connection.js";

type JobFailureInput = {
  jobId: string;
  processingToken: string;
  errorMessage: string;
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
  const result = await database.query(
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
}
