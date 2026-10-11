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
            rows: [{ job_id: jobId, attempt_count: 1, notification_token: "token", attempts_exhausted: false, delivery_uncertain: false }],
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

test("recuperação de notificação esgotada preserva contador e reserva apenas finalização", async () => {
  const originalConnect = database.connect;
  const statements: string[] = [];
  let released = false;
  database.connect = (async () => ({
    async query(statement: string, parameters?: readonly unknown[]) {
      statements.push(statement);
      if (statement.includes("UPDATE notifications AS notification")) {
        assert.match(statement, /FOR UPDATE OF notification SKIP LOCKED/);
        assert.match(statement, /ELSE available_notification\.attempt_count/);
        assert.match(statement, /available_notification\.attempt_count >= \$4 AS attempts_exhausted/);
        assert.equal(parameters?.[3], 3);
        return { rowCount: 1, rows: [{
          job_id: jobId, attempt_count: 3, notification_token: "token", attempts_exhausted: true, delivery_uncertain: true,
        }] };
      }
      return { rowCount: 0, rows: [] };
    },
    release() { released = true; },
  })) as unknown as typeof database.connect;
  try {
    const notification = await claimNotification(jobId);
    assert.equal(notification?.attemptCount, 3);
    assert.equal(notification?.attemptsExhausted, true);
    assert.equal(notification?.deliveryUncertain, true);
    assert.equal(statements.at(-1), "COMMIT");
    assert.equal(released, true);
  } finally {
    database.connect = originalConnect;
  }
});
