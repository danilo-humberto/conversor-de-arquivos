import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import os from "node:os";

const apiUrl = process.env.BENCHMARK_API_URL ?? "http://localhost:3000";
const jobCount = Number(process.env.BENCHMARK_JOBS ?? 8);
const durationSeconds = Number(process.env.BENCHMARK_AUDIO_SECONDS ?? 30);
const pollIntervalMs = 500;
const timeoutMs = 10 * 60 * 1000;

if (!Number.isInteger(jobCount) || jobCount < 2) {
  throw new Error("BENCHMARK_JOBS must be an integer greater than or equal to 2.");
}
if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
  throw new Error("BENCHMARK_AUDIO_SECONDS must be a positive integer.");
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
    });
  });
}

function createWav(seconds) {
  const sampleRate = 48_000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = sampleRate * seconds;
  const dataSize = samples * channels * bitsPerSample / 8;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
  wav.writeUInt16LE(channels * bitsPerSample / 8, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 440 * index / sampleRate) * 12_000);
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

const fixture = createWav(durationSeconds);

async function submitJob() {
  const form = new FormData();
  form.append("file", new Blob([fixture], { type: "audio/wav" }), "benchmark.wav");
  form.append("targetFormat", "mp3");
  form.append("notifyEmail", "benchmark@conversor.local");
  const response = await fetch(`${apiUrl}/jobs`, { method: "POST", body: form });
  const body = await response.json();
  if (response.status !== 202 || typeof body.jobId !== "string") {
    throw new Error(`Job submission failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.jobId;
}

async function runBatch(workerCount) {
  await run("docker", ["compose", "up", "-d", "--scale", `conversion-worker=${workerCount}`, "conversion-worker"]);
  const replicas = (await run("docker", ["compose", "ps", "-q", "conversion-worker"]))
    .split(/\r?\n/).filter(Boolean);
  if (replicas.length !== workerCount) {
    throw new Error(`Expected ${workerCount} worker containers, found ${replicas.length}.`);
  }
  let consumerCount = 0;
  const consumerDeadline = Date.now() + 30_000;
  while (Date.now() < consumerDeadline) {
    const consumers = await run("docker", ["compose", "exec", "-T", "rabbitmq", "rabbitmqctl", "list_consumers", "-p", "/", "queue_name"]);
    consumerCount = consumers.split(/\r?\n/).filter((line) => line.trim() === "conversion.jobs").length;
    if (consumerCount >= workerCount) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (consumerCount !== workerCount) {
    throw new Error(`Expected ${workerCount} conversion queue consumers, found ${consumerCount}.`);
  }

  const startedAt = performance.now();
  const jobIds = [];
  for (let index = 0; index < jobCount; index += 1) jobIds.push(await submitJob());
  if (new Set(jobIds).size !== jobIds.length) throw new Error("API returned duplicate job IDs.");

  const deadline = Date.now() + timeoutMs;
  const statuses = new Map();
  while (Date.now() < deadline) {
    for (const jobId of jobIds) {
      if (statuses.get(jobId) === "CONCLUÍDO" || statuses.get(jobId) === "ERRO") continue;
      const response = await fetch(`${apiUrl}/jobs/${jobId}`);
      if (!response.ok) throw new Error(`Status check failed for ${jobId}: ${response.status}`);
      const job = await response.json();
      statuses.set(jobId, job.status);
    }
    if ([...statuses.values()].every((status) => status === "CONCLUÍDO" || status === "ERRO")) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  if (statuses.size !== jobCount || [...statuses.values()].some((status) => status !== "CONCLUÍDO")) {
    throw new Error(`Batch did not complete successfully before timeout: ${JSON.stringify(Object.fromEntries(statuses))}`);
  }

  const idList = jobIds.map((id) => `'${id}'`).join(",");
  const integrity = await run("docker", ["compose", "exec", "-T", "postgres", "sh", "-c",
    `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F '|' -c "SELECT count(*), count(DISTINCT id), count(DISTINCT result_bucket || '/' || result_object_key), bool_and(attempt_count = 1), bool_and(status = 'CONCLUÍDO') FROM jobs WHERE id IN (${idList}) AND result_object_key IS NOT NULL"`]);
  const [rows, distinctJobs, distinctResults, singleAttempt, allCompleted] = integrity.split("|");
  if (rows !== String(jobCount) || distinctJobs !== String(jobCount) || distinctResults !== String(jobCount) || singleAttempt !== "t" || allCompleted !== "t") {
    throw new Error(`Job/result integrity check failed: ${integrity}`);
  }

  return {
    workers: workerCount,
    jobs: jobCount,
    durationSeconds: Number(elapsedSeconds.toFixed(3)),
    throughputJobsPerSecond: Number((jobCount / elapsedSeconds).toFixed(3)),
    distinctJobIds: Number(distinctJobs),
    distinctResults: Number(distinctResults),
    oneAttemptPerJob: singleAttempt === "t",
    workerContainers: replicas.length,
    registeredConversionConsumers: consumerCount,
  };
}

const initialWorkerCount = (await run("docker", ["compose", "ps", "-q", "conversion-worker"]))
  .split(/\r?\n/).filter(Boolean).length || 1;

console.log(JSON.stringify({
  environment: {
    date: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
    dockerCompose: await run("docker", ["compose", "version", "--short"]),
    workerImage: await run("docker", ["compose", "images", "-q", "conversion-worker"]),
    fixture: `deterministic ${durationSeconds}s 48 kHz mono PCM sine WAV (${fixture.length} bytes) to MP3`,
    apiUrl,
  },
}, null, 2));

try {
  const results = [];
  results.push(await runBatch(1));
  results.push(await runBatch(2));
  console.log(JSON.stringify({ results }, null, 2));
} finally {
  await run("docker", ["compose", "up", "-d", "--scale", `conversion-worker=${initialWorkerCount}`, "conversion-worker"]);
}
