import assert from "node:assert/strict";
import test from "node:test";

import { createInternalSourceUrl } from "./source-url.js";

test("gera a URL de origem pelo cliente interno com a validade configurada", async () => {
  const calls: unknown[][] = [];
  const url = await createInternalSourceUrl(
    {
      async presignedGetObject(...argumentsList: unknown[]): Promise<string> {
        calls.push(argumentsList);
        return "http://minio:9000/uploads/source.mp3?X-Amz-Signature=test";
      },
    },
    "uploads",
    "job/source.mp3",
    604800,
  );

  assert.equal(
    url,
    "http://minio:9000/uploads/source.mp3?X-Amz-Signature=test",
  );
  assert.deepEqual(calls, [["uploads", "job/source.mp3", 604800]]);
});
