import { database } from "../db/connection.js";
import { createDownloadUrl } from "../storage/download-url.js";

type JobStatusRow = {
  id: string;
  status: string;
  source_format: string;
  target_format: string;
  created_at: Date;
  completed_at: Date | null;
  result_bucket: string | null;
  result_object_key: string | null;
};

export type JobStatusResponse = {
  id: string;
  status: string;
  sourceFormat: string;
  targetFormat: string;
  createdAt: Date;
  completedAt: Date | null;
  resultAvailable: boolean;
  downloadUrl?: string;
};

export async function getJobStatus(
  jobId: string,
  signDownloadUrl: typeof createDownloadUrl = createDownloadUrl,
): Promise<JobStatusResponse | null> {
  const result = await database.query<JobStatusRow>(
    `
      SELECT
        id,
        status,
        source_format,
        target_format,
        created_at,
        completed_at,
        result_bucket,
        result_object_key
      FROM jobs
      WHERE id = $1
    `,
    [jobId],
  );

  const job = result.rows.at(0);

  if (!job) {
    return null;
  }

  const status: JobStatusResponse = {
    id: job.id,
    status: job.status,
    sourceFormat: job.source_format,
    targetFormat: job.target_format,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    resultAvailable: job.status === "CONCLUÍDO",
  };

  if (
    job.status === "CONCLUÍDO" &&
    job.result_bucket !== null &&
    job.result_object_key !== null
  ) {
    status.downloadUrl = await signDownloadUrl(
      job.result_bucket,
      job.result_object_key,
    );
  }

  return status;
}
