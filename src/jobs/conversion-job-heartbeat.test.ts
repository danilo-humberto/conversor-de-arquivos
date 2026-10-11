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
  assert.equal(heartbeat.signal.aborted, true);

  callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewalCount, 1);

  await heartbeat.stop();
  assert.equal(clearCount, 1);
});

test("lease expira e cancela mesmo quando a renovação fica sem resposta", async () => {
  let tick: (() => void) | undefined;
  let expire: (() => void) | undefined;
  let now = 0;
  const renewal = createDeferred<boolean>();
  const heartbeat = startConversionJobHeartbeat(jobId, processingToken, {
    now: () => now,
    renewLease: () => renewal.promise,
    setInterval(callback) { tick = callback; return 1 as unknown as NodeJS.Timeout; },
    clearInterval() {},
    setTimeout(callback) { expire = callback; return 2 as unknown as NodeJS.Timeout; },
    clearTimeout() {},
  });
  assert.ok(tick);
  tick();
  now = 120_000;
  assert.ok(expire);
  expire();
  assert.equal(heartbeat.signal.aborted, true);
  assert.throws(() => heartbeat.assertOwnership(), ConversionJobLeaseLostError);
  await heartbeat.stop();
  renewal.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(heartbeat.signal.aborted, true);
});

test("deadline bloqueia posse mesmo antes de executar o callback de expiração", async () => {
  let now = 0;
  const heartbeat = startConversionJobHeartbeat(jobId, processingToken, {
    now: () => now,
    setInterval() { return 1 as unknown as NodeJS.Timeout; }, clearInterval() {},
    setTimeout() { return 2 as unknown as NodeJS.Timeout; }, clearTimeout() {},
  });
  now = 120_000;
  assert.throws(() => heartbeat.assertOwnership(), ConversionJobLeaseLostError);
  await heartbeat.stop();
});

test("renovação confirmada estende o prazo local sem ressuscitar uma posse perdida", async () => {
  let now = 0;
  let tick: (() => void) | undefined;
  const expiryDelays: number[] = [];
  const heartbeat = startConversionJobHeartbeat(jobId, processingToken, {
    now: () => now,
    renewLease: async () => true,
    setInterval(callback) { tick = callback; return 1 as unknown as NodeJS.Timeout; },
    clearInterval() {},
    setTimeout(_callback, delay) { expiryDelays.push(delay); return 2 as unknown as NodeJS.Timeout; },
    clearTimeout() {},
  });
  assert.ok(tick);
  now = 30_000;
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  now = 120_000;
  heartbeat.assertOwnership();
  assert.equal(heartbeat.signal.aborted, false);
  assert.deepEqual(expiryDelays, [120_000, 120_000]);
  now = 150_000;
  assert.throws(() => heartbeat.assertOwnership(), ConversionJobLeaseLostError);
  await heartbeat.stop();
});
