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
  attemptsExhausted: false,
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
    assertProcessingOwnership() {},
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

test("converte e conclui antes de permitir a limpeza externa da origem", async () => {
  const steps: string[] = [];

  await processClaimedConversionJob(job, event, createDependencies(steps));

  assert.deepEqual(steps, [
    "check result", "download", "convert", "upload",
    "create URL", "complete job",
  ]);
});

test("resultado preexistente pula download, conversão e upload", async () => {
  const steps: string[] = [];

  await processClaimedConversionJob(job, event, createDependencies(steps, true));

  assert.deepEqual(steps, ["check result", "create URL", "complete job"]);
});

test("falha na assinatura preserva a origem e impede conclusão", async () => {
  const steps: string[] = [];
  const dependencies = createDependencies(steps, true);
  dependencies.createDownloadUrl = async () => { throw new Error("Signing failed"); };
  await assert.rejects(processClaimedConversionJob(job, event, dependencies), /Signing failed/);
  assert.deepEqual(steps, ["check result"]);
});

test("perda da posse antes da assinatura impede conclusão", async () => {
  const steps: string[] = [];
  const dependencies = createDependencies(steps, true);
  let ownershipChecks = 0;

  dependencies.assertProcessingOwnership = () => {
    ownershipChecks += 1;

    if (ownershipChecks === 2) {
      throw new Error("Conversion job processing lease was lost.");
    }
  };

  await assert.rejects(
    processClaimedConversionJob(job, event, dependencies),
    /lease was lost/,
  );

  assert.deepEqual(steps, ["check result"]);
});

test("reentrega após falha de commit retoma resultado persistido sem reconverter", async () => {
  const steps: string[] = [];
  const firstDelivery = createDependencies(steps);
  firstDelivery.completeConversionJob = async () => {
    steps.push("interrupted before commit");
    throw new Error("connection lost");
  };

  await assert.rejects(processClaimedConversionJob(job, event, firstDelivery), /connection lost/);

  const retrySteps: string[] = [];
  const retry = createDependencies(retrySteps, true);


  await processClaimedConversionJob(job, event, retry);

  assert.deepEqual(steps, [
    "check result", "download", "convert", "upload",
    "create URL", "interrupted before commit",
  ]);
  assert.deepEqual(retrySteps, [
    "check result", "create URL", "complete job",
  ]);
});
