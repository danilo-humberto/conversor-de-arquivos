import assert from "node:assert/strict";
import test from "node:test";

import {
  ConversionEventValidationError,
  createConversionRequestedRetryEvent,
  parseConversionFinishedEvent,
  parseConversionRequestedEventJson,
  serializeConversionFinishedEvent,
  serializeConversionRequestedEvent,
} from "./conversion-events.js";

const eventId = "c0a80111-4f9d-4e3e-8d8c-123456789abc";
const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";
const requestedEvent = {
  eventId,
  type: "conversion.requested",
  jobId,
  sourceUrl:
    "http://minio:9000/uploads/source.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20260924T120000Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=test",
  sourceType: "audio",
  sourceFormat: "mp3",
  targetFormat: "wav",
  notifyEmail: "user@example.com",
  requestedAt: "2026-09-24T12:00:00.000Z",
  attempt: 1,
} as const;

test("serializa e recupera o contrato completo de conversion.requested", () => {
  const serialized = serializeConversionRequestedEvent(requestedEvent);

  assert.deepEqual(parseConversionRequestedEventJson(serialized), requestedEvent);
});

test("rejeita conversion.requested com campo ausente, URL inválida ou tentativa inválida", () => {
  const missingEmail = { ...requestedEvent } as Record<string, unknown>;
  delete missingEmail.notifyEmail;

  assert.throws(
    () => parseConversionRequestedEventJson("{invalid JSON"),
    ConversionEventValidationError,
  );
  assert.throws(
    () => parseConversionRequestedEventJson(JSON.stringify(missingEmail)),
    ConversionEventValidationError,
  );
  assert.throws(
    () =>
      parseConversionRequestedEventJson(
        JSON.stringify({ ...requestedEvent, sourceUrl: "file:///tmp/source" }),
      ),
    ConversionEventValidationError,
  );
  assert.throws(
    () =>
      parseConversionRequestedEventJson(
        JSON.stringify({ ...requestedEvent, sourceUrl: "http://minio:9000/uploads/source.mp3" }),
      ),
    ConversionEventValidationError,
  );
  assert.throws(
    () =>
      parseConversionRequestedEventJson(
        JSON.stringify({ ...requestedEvent, attempt: 0 }),
      ),
    ConversionEventValidationError,
  );
});

test("preserva os metadados do contrato ao preparar um retry", () => {
  const retryEvent = createConversionRequestedRetryEvent(requestedEvent, 2);

  assert.deepEqual(retryEvent, {
    ...requestedEvent,
    attempt: 2,
  });
});

test("valida a coerência entre status, URL de resultado e erro", () => {
  const completed = {
    eventId,
    type: "conversion.finished",
    jobId,
    notifyEmail: "user@example.com",
    status: "CONCLUÍDO",
    resultUrl: "http://localhost:9000/converted/result.wav?X-Amz-Signature=test",
    error: null,
    occurredAt: "2026-09-24T12:05:00.000Z",
  } as const;

  assert.deepEqual(
    parseConversionFinishedEvent(JSON.parse(serializeConversionFinishedEvent(completed))),
    completed,
  );
  assert.throws(
    () =>
      parseConversionFinishedEvent({
        ...completed,
        status: "ERRO",
        resultUrl: completed.resultUrl,
        error: "FFmpeg failed",
      }),
    ConversionEventValidationError,
  );
});
