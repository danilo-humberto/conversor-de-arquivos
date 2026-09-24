import assert from "node:assert/strict";
import test from "node:test";

import type { ConversionRequestedEvent } from "../contracts/conversion-events.js";
import type { ClaimedConversionJob } from "../jobs/claim-conversion-job.js";
import { JobCompletionError } from "../jobs/complete-conversion-job.js";
import {
  handleConversionMessage,
  type ConversionMessageActions,
  type ConversionMessageDependencies,
} from "./handle-conversion-message.js";

const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";
const message = { content: Buffer.from("event") };
const queues = { retryAfter5Seconds: "conversion.retry.5s", retryAfter30Seconds: "conversion.retry.30s" };
const event: ConversionRequestedEvent = {
  eventId: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
  type: "conversion.requested",
  jobId,
  sourceUrl: "http://minio:9000/uploads/source.mp3?X-Amz-Signature=test",
  sourceType: "audio",
  sourceFormat: "mp3",
  targetFormat: "wav",
  notifyEmail: "user@example.com",
  requestedAt: "2026-09-24T12:00:00.000Z",
  attempt: 1,
};

function claimed(attemptCount = 1): ClaimedConversionJob {
  return {
    id: jobId,
    attemptCount,
    processingToken: "c0a80113-4f9d-4e3e-8d8c-123456789abc",
    sourceBucket: "uploads",
    sourceObjectKey: `${jobId}/source.mp3`,
  };
}

function createDependencies(): ConversionMessageDependencies & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    parseEvent() { return event; },
    async claimConversionJob() { return claimed(); },
    async getConversionJobState() { return null; },
    startHeartbeat() {
      return {
        assertOwnership() {},
        async stop() { calls.push("heartbeat stopped"); },
      };
    },
    async processClaimedJob() { calls.push("process"); },
    async releaseForRetry(input) { calls.push(`release:${input.errorMessage}`); },
    async markAsFailed(input) { calls.push(`failed:${input.errorMessage}`); },
  };
}

function createActions(calls: string[]): ConversionMessageActions {
  return {
    acknowledge() { calls.push("ack"); },
    async retry(input) {
      calls.push(`retry:${input.queueName}:${input.attempt}:${input.reason}`);
    },
    async deadLetter(_, reason) { calls.push(`dlq:${reason}`); },
  };
}

test("confirma o consumo somente após processar e encerrar o heartbeat", async () => {
  const dependencies = createDependencies();
  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, ["process", "heartbeat stopped", "ack"]);
});

test("evento inválido vai para a DLQ sem tentar reservar o job", async () => {
  const dependencies = createDependencies();
  dependencies.parseEvent = () => { throw new Error("Invalid event"); };

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, ["dlq:Invalid event"]);
});

test("falha ao reservar o job agenda retry preservando a tentativa", async () => {
  const dependencies = createDependencies();
  dependencies.claimConversionJob = async () => { throw new Error("Database unavailable"); };

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, ["retry:conversion.retry.5s:1:Database unavailable"]);
});

test("job já concluído é reconhecido como reentrega idempotente", async () => {
  const dependencies = createDependencies();
  dependencies.claimConversionJob = async () => null;
  dependencies.getConversionJobState = async () => ({ status: "CONCLUÍDO", leaseExpiresAt: null });

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, ["ack"]);
});

test("job ocupado é reenfileirado no retry longo sem aumentar a tentativa", async () => {
  const dependencies = createDependencies();
  dependencies.claimConversionJob = async () => null;
  dependencies.getConversionJobState = async () => ({ status: "PROCESSANDO", leaseExpiresAt: new Date() });

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "retry:conversion.retry.30s:1:Job is not currently available for processing.",
  ]);
});

test("falha de processamento libera o job antes do primeiro retry", async () => {
  const dependencies = createDependencies();
  dependencies.processClaimedJob = async () => { throw new Error("FFmpeg failed"); };

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "heartbeat stopped",
    "release:FFmpeg failed",
    "retry:conversion.retry.5s:2:FFmpeg failed",
  ]);
});

test("terceira falha marca erro antes de enviar a mensagem à DLQ", async () => {
  const dependencies = createDependencies();
  dependencies.claimConversionJob = async () => claimed(3);
  dependencies.processClaimedJob = async () => { throw new Error("FFmpeg failed"); };

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "heartbeat stopped",
    "failed:FFmpeg failed",
    "dlq:FFmpeg failed",
  ]);
});

test("perda da janela de conclusão é reenfileirada sem alterar o estado", async () => {
  const dependencies = createDependencies();
  dependencies.processClaimedJob = async () => { throw new JobCompletionError("Lease expired"); };

  await handleConversionMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "heartbeat stopped",
    "retry:conversion.retry.30s:1:Lease expired",
  ]);
});
