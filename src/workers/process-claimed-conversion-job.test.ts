import assert from "node:assert/strict";
import test from "node:test";

import type { ConversionRequestedEvent } from "../contracts/conversion-events.js";
import type { ClaimedConversionJob } from "../jobs/claim-conversion-job.js";
import type { ConversionProcessingDependencies } from "./process-claimed-conversion-job.js";
import { processClaimedConversionJob } from "./process-claimed-conversion-job.js";

const job: ClaimedConversionJob = {
  id: "c0a80112-4f9d-4e3e-8d8c-123456789abc",
  attemptCount: 1,
  processingToken: "c0a80113-4f9d-4e3e-8d8c-123456789abc",
  sourceBucket: "uploads",
  sourceObjectKey: "c0a80112-4f9d-4e3e-8d8c-123456789abc/source.mp3",
};

const event: ConversionRequestedEvent = {
  eventId: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
  type: "conversion.requested",
  jobId: job.id,
  sourceUrl: "http://minio:9000/uploads/source.mp3?X-Amz-Signature=test",
  sourceType: "audio",
  sourceFormat: "mp3",
  targetFormat: "wav",
  notifyEmail: "user@example.com",
  requestedAt: "2026-09-24T12:00:00.000Z",
  attempt: 1,
};

const resultKey = `${job.id}/result.wav`;

function createDependencies(steps: string[], resultExists = false): ConversionProcessingDependencies {
  return {
    resultBucket: "converted",
    async objectExists(bucketName, objectKey) {
      assert.deepEqual([bucketName, objectKey], ["converted", resultKey]);
      steps.push("check result");
      return resultExists;
    },
    async downloadUrlToFile(sourceUrl, destinationPath) {
      assert.equal(sourceUrl, event.sourceUrl);
      assert.match(destinationPath, /source\.mp3$/);
      steps.push("download");
    },
    async convertMedia(input) {
      assert.equal(input.sourceType, "audio");
      assert.equal(input.targetFormat, "wav");
      steps.push("convert");
    },
    async uploadFileAsObject(bucketName, objectKey, filePath) {
      assert.deepEqual([bucketName, objectKey], ["converted", resultKey]);
      assert.match(filePath, /result\.wav$/);
      steps.push("upload");
    },
    async removeObjectIfExists(bucketName, objectKey) {
      assert.deepEqual([bucketName, objectKey], [job.sourceBucket, job.sourceObjectKey]);
      steps.push("remove source");
    },
    async createDownloadUrl(bucketName, objectKey) {
      assert.deepEqual([bucketName, objectKey], ["converted", resultKey]);
      steps.push("create URL");
      return "http://localhost:9000/converted/result.wav";
    },
    async completeConversionJob(input) {
      assert.deepEqual(input, {
        jobId: job.id,
        processingToken: job.processingToken,
        resultBucket: "converted",
        resultObjectKey: resultKey,
        notifyEmail: event.notifyEmail,
        resultUrl: "http://localhost:9000/converted/result.wav",
      });
      steps.push("complete job");
    },
  };
}

test("converte, persiste, remove a origem e só então conclui o job", async () => {
  const steps: string[] = [];

  await processClaimedConversionJob(job, event, createDependencies(steps));

  assert.deepEqual(steps, [
    "check result", "download", "convert", "upload", "remove source",
    "create URL", "complete job",
  ]);
});

test("resultado preexistente pula download, conversão e upload", async () => {
  const steps: string[] = [];

  await processClaimedConversionJob(job, event, createDependencies(steps, true));

  assert.deepEqual(steps, ["check result", "remove source", "create URL", "complete job"]);
});

test("origem ausente é limpeza idempotente e permite conclusão", async () => {
  const steps: string[] = [];
  const dependencies = createDependencies(steps, true);
  dependencies.removeObjectIfExists = async () => {
    steps.push("source already absent");
  };

  await processClaimedConversionJob(job, event, dependencies);

  assert.deepEqual(steps, ["check result", "source already absent", "create URL", "complete job"]);
});

test("falha de remoção impede conclusão e evento de sucesso", async () => {
  const steps: string[] = [];
  const dependencies = createDependencies(steps);
  const removalFailure = new Error("MinIO unavailable");
  dependencies.removeObjectIfExists = async () => {
    steps.push("remove source");
    throw removalFailure;
  };

  await assert.rejects(processClaimedConversionJob(job, event, dependencies), removalFailure);

  assert.deepEqual(steps, ["check result", "download", "convert", "upload", "remove source"]);
});

test("reentrega após upload e remoção retoma sem reconverter", async () => {
  const steps: string[] = [];
  const firstDelivery = createDependencies(steps);
  firstDelivery.completeConversionJob = async () => {
    steps.push("interrupted before commit");
    throw new Error("connection lost");
  };

  await assert.rejects(processClaimedConversionJob(job, event, firstDelivery), /connection lost/);

  const retrySteps: string[] = [];
  const retry = createDependencies(retrySteps, true);
  retry.removeObjectIfExists = async () => {
    retrySteps.push("source already absent");
  };

  await processClaimedConversionJob(job, event, retry);

  assert.deepEqual(steps, [
    "check result", "download", "convert", "upload", "remove source",
    "create URL", "interrupted before commit",
  ]);
  assert.deepEqual(retrySteps, [
    "check result", "source already absent", "create URL", "complete job",
  ]);
});
