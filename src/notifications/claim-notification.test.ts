import assert from "node:assert/strict";
import test from "node:test";

import { database } from "../db/connection.js";
import { claimNotification } from "./claim-notification.js";

const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";

test("duas entregas concorrentes do mesmo job obtêm uma única trava", async () => {
  const originalConnect = database.connect;
  let status: "PENDING" | "SENDING" = "PENDING";
  const updateStatements: string[] = [];

  database.connect = (async () => ({
    async query(statement: string) {
      if (statement.includes("UPDATE notifications AS notification")) {
        updateStatements.push(statement);
        await Promise.resolve();

        if (status === "PENDING") {
          status = "SENDING";
          return {
            rowCount: 1,
            rows: [{ job_id: jobId, attempt_count: 1, notification_token: "token" }],
          };
        }

        return { rowCount: 0, rows: [] };
      }

      return { rowCount: 1, rows: [] };
    },
    release() {},
  })) as unknown as typeof database.connect;

  try {
    const claims = await Promise.all([claimNotification(jobId), claimNotification(jobId)]);

    assert.equal(claims.filter((claim) => claim !== null).length, 1);
    assert.equal(updateStatements.length, 2);
    assert.match(updateStatements[0] ?? "", /notification\.status = 'PENDING'/);
    assert.match(updateStatements[0] ?? "", /notification\.status = 'SENDING'/);
    assert.match(updateStatements[0] ?? "", /notification\.lease_expires_at < NOW\(\)/);
  } finally {
    database.connect = originalConnect;
  }
});
