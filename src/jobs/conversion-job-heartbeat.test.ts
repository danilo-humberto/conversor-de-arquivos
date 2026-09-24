import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERSION_JOB_HEARTBEAT_INTERVAL_MS,
  ConversionJobLeaseLostError,
  startConversionJobHeartbeat,
} from "./conversion-job-heartbeat.js";

const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";
const processingToken = "c0a80113-4f9d-4e3e-8d8c-123456789abc";

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      resolvePromise(value);
    },
  };
}

test("renova a cada 30 segundos sem sobrepor heartbeats concorrentes", async () => {
  let callback: (() => void) | undefined;
  const clearedIntervals: unknown[] = [];
  const renewal = createDeferred<boolean>();
  const renewals: Array<[string, string]> = [];

  const heartbeat = startConversionJobHeartbeat(jobId, processingToken, {
    renewLease: async (renewedJobId, renewedToken) => {
      renewals.push([renewedJobId, renewedToken]);
      return renewal.promise;
    },
    setInterval(receivedCallback, delayMs) {
      assert.equal(delayMs, CONVERSION_JOB_HEARTBEAT_INTERVAL_MS);
      callback = receivedCallback;
      return "heartbeat-interval" as unknown as NodeJS.Timeout;
    },
    clearInterval(interval) {
      clearedIntervals.push(interval);
    },
  });

  assert.ok(callback);
  callback();
  callback();
  assert.deepEqual(renewals, [[jobId, processingToken]]);

  const stop = heartbeat.stop();
  assert.deepEqual(clearedIntervals, ["heartbeat-interval"]);

  renewal.resolve(true);
  await stop;
  heartbeat.assertOwnership();
});

test("expiração ou troca de token bloqueia o restante do processamento e limpa o timer", async () => {
  let callback: (() => void) | undefined;
  let clearCount = 0;
  let renewalCount = 0;

  const heartbeat = startConversionJobHeartbeat(jobId, processingToken, {
    renewLease: async () => {
      renewalCount += 1;
      return false;
    },
    setInterval(receivedCallback) {
      callback = receivedCallback;
      return "heartbeat-interval" as unknown as NodeJS.Timeout;
    },
    clearInterval() {
      clearCount += 1;
    },
  });

  assert.ok(callback);
  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => heartbeat.assertOwnership(), ConversionJobLeaseLostError);

  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewalCount, 1);

  await heartbeat.stop();
  assert.equal(clearCount, 1);
});
