import assert from "node:assert/strict";
import test from "node:test";

import { createInitialConversionRequestedEvent } from "./conversion-requested-payload.js";

test("cria o payload inicial completo da outbox com attempt 1", () => {
  const event = createInitialConversionRequestedEvent({
    eventId: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
    jobId: "c0a80112-4f9d-4e3e-8d8c-123456789abc",
    sourceUrl:
      "http://minio:9000/uploads/source.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20260924T120000Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=test",
    sourceType: "audio",
    sourceFormat: "mp3",
    targetFormat: "wav",
    notifyEmail: "user@example.com",
    requestedAt: "2026-09-24T12:00:00.000Z",
  });

  assert.deepEqual(event, {
    eventId: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
    type: "conversion.requested",
    jobId: "c0a80112-4f9d-4e3e-8d8c-123456789abc",
    sourceUrl:
      "http://minio:9000/uploads/source.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Date=20260924T120000Z&X-Amz-Expires=604800&X-Amz-SignedHeaders=host&X-Amz-Signature=test",
    sourceType: "audio",
    sourceFormat: "mp3",
    targetFormat: "wav",
    notifyEmail: "user@example.com",
    requestedAt: "2026-09-24T12:00:00.000Z",
    attempt: 1,
  });
});
