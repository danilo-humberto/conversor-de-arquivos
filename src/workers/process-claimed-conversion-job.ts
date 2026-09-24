import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ConversionRequestedEvent } from "../contracts/conversion-events.js";
import { type ClaimedConversionJob } from "../jobs/claim-conversion-job.js";
import { type convertMedia } from "../conversion/ffmpeg.js";
import { type completeConversionJob } from "../jobs/complete-conversion-job.js";

export type ConversionProcessingDependencies = {
  resultBucket: string;
  assertProcessingOwnership(): void;
  objectExists(bucketName: string, objectKey: string): Promise<boolean>;
  removeObjectIfExists(bucketName: string, objectKey: string): Promise<void>;
  downloadUrlToFile(sourceUrl: string, destinationPath: string): Promise<void>;
  convertMedia: typeof convertMedia;
  uploadFileAsObject(
    bucketName: string,
    objectKey: string,
    filePath: string,
  ): Promise<void>;
  createDownloadUrl(bucketName: string, objectKey: string): Promise<string>;
  completeConversionJob: typeof completeConversionJob;
};

export async function processClaimedConversionJob(
  job: ClaimedConversionJob,
  event: ConversionRequestedEvent,
  dependencies: ConversionProcessingDependencies,
): Promise<void> {
  const outputFileName = `result.${event.targetFormat}`;
  const resultObjectKey = `${job.id}/${outputFileName}`;

  dependencies.assertProcessingOwnership();

  if (
    !(await dependencies.objectExists(dependencies.resultBucket, resultObjectKey))
  ) {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), `conversion-${job.id}-`),
    );
    const inputPath = join(workingDirectory, `source.${event.sourceFormat}`);
    const outputPath = join(workingDirectory, outputFileName);

    try {
      await dependencies.downloadUrlToFile(event.sourceUrl, inputPath);
      dependencies.assertProcessingOwnership();
      await dependencies.convertMedia({
        inputPath,
        outputPath,
        sourceType: event.sourceType,
        targetFormat: event.targetFormat,
      });
      dependencies.assertProcessingOwnership();
      await dependencies.uploadFileAsObject(
        dependencies.resultBucket,
        resultObjectKey,
        outputPath,
      );
      dependencies.assertProcessingOwnership();
    } finally {
      await rm(workingDirectory, { force: true, recursive: true });
    }
  }

  dependencies.assertProcessingOwnership();
  await dependencies.removeObjectIfExists(job.sourceBucket, job.sourceObjectKey);
  dependencies.assertProcessingOwnership();
  const resultUrl = await dependencies.createDownloadUrl(
    dependencies.resultBucket,
    resultObjectKey,
  );

  dependencies.assertProcessingOwnership();
  await dependencies.completeConversionJob({
    jobId: job.id,
    processingToken: job.processingToken,
    resultBucket: dependencies.resultBucket,
    resultObjectKey,
    notifyEmail: event.notifyEmail,
    resultUrl,
  });
}
