import assert from "node:assert/strict";
import test from "node:test";

import {
  objectExists,
  ObjectRemovalError,
  removeObjectIfExists,
  type ObjectStorageClient,
} from "./object-lifecycle.js";

function storageError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

function createClient(overrides: Partial<ObjectStorageClient> = {}): ObjectStorageClient {
  return {
    async statObject() { return {}; },
    async bucketExists() { return true; },
    async removeObject() {},
    ...overrides,
  };
}

test("HEAD distingue objeto ausente de falha operacional", async () => {
  const missing = createClient({ async statObject() { throw storageError("NoSuchKey"); } });
  assert.equal(await objectExists(missing, "converted", "job/result.wav"), false);

  const notFound = createClient({ async statObject() { throw storageError("NotFound"); } });
  assert.equal(await objectExists(notFound, "converted", "job/result.wav"), false);

  const forbidden = storageError("AccessDenied");
  const operational = createClient({ async statObject() { throw forbidden; } });
  await assert.rejects(objectExists(operational, "converted", "job/result.wav"), forbidden);

  const missingBucket = storageError("NotFound");
  const noBucket = createClient({
    async statObject() { throw missingBucket; },
    async bucketExists() { return false; },
  });
  await assert.rejects(objectExists(noBucket, "converted", "job/result.wav"), missingBucket);
});

test("DELETE aceita origem ausente e propaga falha operacional", async () => {
  const absent = createClient({ async removeObject() { throw storageError("NoSuchKey"); } });
  await removeObjectIfExists(absent, "uploads", "job/source.mp3");

  const notFound = createClient({ async removeObject() { throw storageError("NotFound"); } });
  await removeObjectIfExists(notFound, "uploads", "job/source.mp3");

  const failure = storageError("AccessDenied");
  const forbidden = createClient({ async removeObject() { throw failure; } });
  await assert.rejects(
    removeObjectIfExists(forbidden, "uploads", "job/source.mp3"),
    (error: unknown) => error instanceof ObjectRemovalError && error.cause === failure,
  );
});
