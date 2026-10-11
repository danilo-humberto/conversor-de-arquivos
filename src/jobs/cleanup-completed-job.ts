import { database } from "../db/connection.js";
import { minioClient } from "../storage/minio.js";
import { removeObjectIfExists } from "../storage/object-lifecycle.js";

// Completion is durable before cleanup, so redelivery can safely resume removal.
export async function cleanupCompletedJob(jobId: string): Promise<void> {
  const result = await database.query<{
    source_bucket: string;
    source_object_key: string;
  }>(
    "SELECT source_bucket, source_object_key FROM jobs WHERE id = $1 AND status = 'CONCLUÍDO'",
    [jobId],
  );
  const job = result.rows.at(0);
  if (!job) {
    throw new Error("Source cleanup requires a completed conversion job.");
  }
  await removeObjectIfExists(minioClient, job.source_bucket, job.source_object_key);
}
