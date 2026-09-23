import { database } from "../db/connection.js";

type JobStatusRow = {
  id: string;
  status: string;
  source_format: string;
  target_format: string;
  created_at: Date;
  completed_at: Date | null;
};

export type JobStatusResponse = {
  id: string;
  status: string;
  sourceFormat: string;
  targetFormat: string;
  createdAt: Date;
  completedAt: Date | null;
  resultAvailable: boolean;
};

export async function getJobStatus(
  jobId: string,
): Promise<JobStatusResponse | null> {
  const result = await database.query<JobStatusRow>(
    `
      SELECT
        id,
        status,
        source_format,
        target_format,
        created_at,
        completed_at
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
    id: job.id,
    status: job.status,
    sourceFormat: job.source_format,
    targetFormat: job.target_format,
    createdAt: job.created_at,
    completedAt: job.completed_at,
    resultAvailable: job.status === "CONCLUÍDO",
  };
}
