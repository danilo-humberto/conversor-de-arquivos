import assert from "node:assert/strict";
import test from "node:test";

import { database } from "../db/connection.js";
import {
  CONVERSION_JOB_LEASE_DURATION_MS,
  renewConversionJobLease,
} from "./claim-conversion-job.js";

const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";
const processingToken = "c0a80113-4f9d-4e3e-8d8c-123456789abc";

test("renova somente a posse ainda válida do token atual", async () => {
  const originalQuery = database.query;
  let statement = "";
  let parameters: readonly unknown[] = [];

  database.query = (async (query: string, values: readonly unknown[]) => {
    statement = query;
    parameters = values;

    return { rowCount: 1, rows: [{ id: jobId }] };
  }) as unknown as typeof database.query;

  try {
    assert.equal(await renewConversionJobLease(jobId, processingToken), true);
  } finally {
    database.query = originalQuery;
  }

  assert.match(statement, /status = 'PROCESSANDO'/);
  assert.match(statement, /processing_token = \$2/);
  assert.match(statement, /lease_expires_at > NOW\(\)/);
  assert.deepEqual(parameters, [
    jobId,
    processingToken,
    CONVERSION_JOB_LEASE_DURATION_MS,
  ]);
});

test("lease expirada ou token substituído não pode ser renovado", async () => {
  const originalQuery = database.query;

  database.query = (async () => {
    return { rowCount: 0, rows: [] };
  }) as unknown as typeof database.query;

  try {
    assert.equal(await renewConversionJobLease(jobId, processingToken), false);
  } finally {
    database.query = originalQuery;
  }
});
