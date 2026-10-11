import assert from "node:assert/strict";
import test from "node:test";

import { database } from "../db/connection.js";
import {
  JobFailureError,
  markConversionJobAsFailed,
  releaseConversionJobForRetry,
} from "./fail-conversion-job.js";

const input = {
  jobId: "c0a80112-4f9d-4e3e-8d8c-123456789abc",
  processingToken: "old-token",
  errorMessage: "FFmpeg failed",
  notifyEmail: "user@example.com",
};

test("posse expirada não pode liberar o job para outra tentativa", async () => {
  const originalQuery = database.query;
  database.query = (async (statement: string) => {
    assert.match(statement, /processing_token = \$2/);
    assert.match(statement, /lease_expires_at > NOW\(\)/);
    return { rowCount: 0, rows: [] };
  }) as unknown as typeof database.query;
  try {
    await assert.rejects(releaseConversionJobForRetry(input), JobFailureError);
  } finally {
    database.query = originalQuery;
  }
});

test("posse expirada não finaliza em ERRO nem cria evento final", async () => {
  const originalConnect = database.connect;
  const statements: string[] = [];
  let released = false;
  database.connect = (async () => ({
    async query(statement: string) {
      statements.push(statement);
      if (statement.includes("UPDATE jobs")) {
        assert.match(statement, /processing_token = \$2/);
        assert.match(statement, /lease_expires_at > NOW\(\)/);
      }
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; },
  })) as unknown as typeof database.connect;
  try {
    await assert.rejects(markConversionJobAsFailed(input), JobFailureError);
    assert.equal(statements.some((statement) => statement.includes("INSERT INTO outbox_events")), false);
    assert.equal(statements.at(-1), "ROLLBACK");
    assert.equal(released, true);
  } finally {
    database.connect = originalConnect;
  }
});
