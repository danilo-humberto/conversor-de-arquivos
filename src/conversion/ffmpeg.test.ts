import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import test from "node:test";

import { convertMedia, MediaConversionError } from "./ffmpeg.js";

const input = {
  inputPath: "source.wav", outputPath: "result.mp3",
  sourceType: "audio" as const, targetFormat: "mp3",
};

function processFixture() {
  const child = new EventEmitter();
  const stderr = new EventEmitter();
  const signals: string[] = [];
  const start = (() => Object.assign(child, {
    stderr,
    kill(signal: string) { signals.push(signal); return true; },
  })) as unknown as typeof spawn;
  return { child, signals, start };
}

test("cancelamento encerra FFmpeg e aguarda close antes de liberar os arquivos", async () => {
  const fixture = processFixture();
  const controller = new AbortController();
  const reason = new Error("Lease lost");
  let settled = false;
  const conversion = convertMedia({ ...input, signal: controller.signal }, fixture.start);
  const rejection = assert.rejects(conversion, (error) => error === reason);
  void conversion.then(() => { settled = true; }, () => { settled = true; });

  controller.abort(reason);
  await Promise.resolve();
  assert.deepEqual(fixture.signals, ["SIGKILL"]);
  assert.equal(settled, false);

  fixture.child.emit("close", null);
  await rejection;
});

test("sinal já cancelado impede iniciar FFmpeg", async () => {
  let starts = 0;
  const start = (() => { starts++; throw new Error("Should not start"); }) as unknown as typeof spawn;
  const controller = new AbortController();
  controller.abort(new Error("Lease lost"));
  await assert.rejects(convertMedia({ ...input, signal: controller.signal }, start), /Lease lost/);
  assert.equal(starts, 0);
});

test("sucesso remove o listener de cancelamento sem matar processo encerrado", async () => {
  const fixture = processFixture();
  const controller = new AbortController();
  const conversion = convertMedia({ ...input, signal: controller.signal }, fixture.start);
  fixture.child.emit("close", 0);
  await conversion;
  controller.abort();
  assert.deepEqual(fixture.signals, []);
});

test("erro de inicialização é reportado após fechamento do processo", async () => {
  const fixture = processFixture();
  const conversion = convertMedia(input, fixture.start);
  const rejection = assert.rejects(conversion, MediaConversionError);
  fixture.child.emit("error", new Error("ENOENT"));
  fixture.child.emit("close", -2);
  await rejection;
});

test("cancelamento encerra um subprocesso real", { timeout: 5_000 }, async () => {
  const controller = new AbortController();
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true });
  const start = (() => child) as unknown as typeof spawn;
  const reason = new Error("Lease lost");
  try {
    const conversion = convertMedia({ ...input, signal: controller.signal }, start);
    const rejection = assert.rejects(conversion, (error) => error === reason);
    await once(child, "spawn");
    controller.abort(reason);
    await rejection;
    assert.ok(child.exitCode !== null || child.signalCode !== null);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
