import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import { type ClaimedConversionJob } from "../jobs/claim-conversion-job.js";
import { completeConversionJob } from "../jobs/complete-conversion-job.js";
import { convertMedia } from "../conversion/ffmpeg.js";
import { convertedBucket, minioClient } from "../storage/minio.js";
import {
  downloadObjectToFile,
  uploadFileAsObject,
} from "../storage/object-files.js";

export async function processClaimedConversionJob(
  job: ClaimedConversionJob,
): Promise<void> {
  const workingDirectory = await mkdtemp(
    join(tmpdir(), `conversion-${job.id}-`),
  );

  const sourceExtension =
    extname(job.sourceObjectKey) || `.${job.sourceFormat}`;

  const inputPath = join(workingDirectory, `source${sourceExtension}`);

  const outputFileName = `result.${job.targetFormat}`;

  const outputPath = join(workingDirectory, outputFileName);

  const resultObjectKey = `${job.id}/${outputFileName}`;

  try {
    await downloadObjectToFile(
      job.sourceBucket,
      job.sourceObjectKey,
      inputPath,
    );

    await convertMedia({
      inputPath,
      outputPath,
      targetFormat: job.targetFormat,
    });

    await uploadFileAsObject(convertedBucket, resultObjectKey, outputPath);

    await completeConversionJob({
      jobId: job.id,
      processingToken: job.processingToken,
      resultBucket: convertedBucket,
      resultObjectKey,
    });

    try {
      await minioClient.removeObject(job.sourceBucket, job.sourceObjectKey);
    } catch (error) {
      console.error(`Could not remove original file for job ${job.id}.`, error);
    }
  } finally {
    await rm(workingDirectory, {
      force: true,
      recursive: true,
    });
  }
}
