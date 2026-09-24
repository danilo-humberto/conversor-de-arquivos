import assert from "node:assert/strict";
import test from "node:test";

import { database } from "../db/connection.js";
import { getJobStatus } from "./get-job-status.js";

const baseJob = {
  id: "c0a80112-4f9d-4e3e-8d8c-123456789abc",
  source_format: "mp4",
  target_format: "webm",
  created_at: new Date("2026-09-24T10:00:00.000Z"),
  completed_at: null as Date | null,
  result_bucket: null as string | null,
  result_object_key: null as string | null,
};

test("status não assina nem expõe resultado para estados não concluídos", async () => {
  const originalQuery = database.query;
  const signedObjects: string[] = [];
  const states = ["PENDENTE", "PROCESSANDO", "ERRO"];

  try {
    for (const state of states) {
      database.query = (async () => ({
        rows: [{ ...baseJob, status: state }],
      })) as unknown as typeof database.query;

      const status = await getJobStatus(baseJob.id, async () => {
        signedObjects.push(state);
        return "https://storage.example/download";
      });

      assert.ok(status);
      assert.equal(status.status, state);
      assert.equal("downloadUrl" in status, false);
    }
  } finally {
    database.query = originalQuery;
  }

  assert.deepEqual(signedObjects, []);
});

test("status concluído gera URL nova em cada consulta pelas chaves persistidas", async () => {
  const originalQuery = database.query;
  const calls: Array<[string, string]> = [];
  let signature = 0;

  database.query = (async () => ({
    rows: [{
      ...baseJob,
      status: "CONCLUÍDO",
      completed_at: new Date("2026-09-24T10:05:00.000Z"),
      result_bucket: "converted-files",
      result_object_key: "jobs/result.webm",
    }],
  })) as unknown as typeof database.query;

  try {
    const createUrl = async (bucket: string, key: string) => {
      calls.push([bucket, key]);
      signature += 1;
      return `https://storage.example/download?signature=${signature}`;
    };

    const first = await getJobStatus(baseJob.id, createUrl);
    const second = await getJobStatus(baseJob.id, createUrl);

    assert.equal(first?.downloadUrl, "https://storage.example/download?signature=1");
    assert.equal(second?.downloadUrl, "https://storage.example/download?signature=2");
    assert.deepEqual(calls, [
      ["converted-files", "jobs/result.webm"],
      ["converted-files", "jobs/result.webm"],
    ]);
  } finally {
    database.query = originalQuery;
  }
});

test("status concluído sem chave de resultado não devolve URL", async () => {
  const originalQuery = database.query;
  database.query = (async () => ({
    rows: [{ ...baseJob, status: "CONCLUÍDO" }],
  })) as unknown as typeof database.query;

  try {
    const status = await getJobStatus(baseJob.id, async () => {
      assert.fail("não deve assinar sem as chaves persistidas");
    });

    assert.ok(status);
    assert.equal("downloadUrl" in status, false);
  } finally {
    database.query = originalQuery;
  }
});
