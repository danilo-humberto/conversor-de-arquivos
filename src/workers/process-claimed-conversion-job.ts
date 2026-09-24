import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ConversionRequestedEvent } from "../contracts/conversion-events.js";
import { type ClaimedConversionJob } from "../jobs/claim-conversion-job.js";
import { completeConversionJob } from "../jobs/complete-conversion-job.js";
import { convertMedia } from "../conversion/ffmpeg.js";
import { convertedBucket } from "../storage/minio.js";
import { createDownloadUrl } from "../storage/download-url.js";
import {
  downloadUrlToFile,
  uploadFileAsObject,
} from "../storage/object-files.js";

export async function processClaimedConversionJob(
  job: ClaimedConversionJob,
  event: ConversionRequestedEvent,
): Promise<void> {
  const workingDirectory = await mkdtemp(
    join(tmpdir(), `conversion-${job.id}-`),
  );

  const inputPath = join(workingDirectory, `source.${event.sourceFormat}`);

  const outputFileName = `result.${event.targetFormat}`;

  const outputPath = join(workingDirectory, outputFileName);

  const resultObjectKey = `${job.id}/${outputFileName}`;

  try {
    await downloadUrlToFile(event.sourceUrl, inputPath);

    await convertMedia({
      inputPath,
      outputPath,
      sourceType: event.sourceType,
      targetFormat: event.targetFormat,
    });

    await uploadFileAsObject(convertedBucket, resultObjectKey, outputPath);

    const resultUrl = await createDownloadUrl(convertedBucket, resultObjectKey);

    await completeConversionJob({
      jobId: job.id,
      processingToken: job.processingToken,
      resultBucket: convertedBucket,
      resultObjectKey,
      notifyEmail: event.notifyEmail,
      resultUrl,
    });
  } finally {
    await rm(workingDirectory, {
      force: true,
      recursive: true,
    });
  }
}
