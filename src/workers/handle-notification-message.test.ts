import assert from "node:assert/strict";
import test from "node:test";

import type { ConversionFinishedEvent } from "../contracts/conversion-events.js";
import type { ClaimedNotification } from "../notifications/claim-notification.js";
import {
  handleNotificationMessage,
  type NotificationHandlerDependencies,
  type NotificationMessageActions,
} from "./handle-notification-message.js";

const jobId = "c0a80112-4f9d-4e3e-8d8c-123456789abc";
const notificationToken = "c0a80113-4f9d-4e3e-8d8c-123456789abc";
const queues = {
  retryAfter5Seconds: "notification.retry.5s",
  retryAfter30Seconds: "notification.retry.30s",
};
const message = { content: Buffer.from("event") };

const completedEvent: ConversionFinishedEvent = {
  eventId: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
  type: "conversion.finished",
  jobId,
  notifyEmail: "user@example.com",
  status: "CONCLUÍDO",
  resultUrl: "http://example.com/result.wav",
  error: null,
  occurredAt: "2026-09-24T12:00:00.000Z",
};

const failedEvent: ConversionFinishedEvent = {
  ...completedEvent,
  status: "ERRO",
  resultUrl: null,
  error: "FFmpeg failed",
};

function claimed(attemptCount: number): ClaimedNotification {
  return { jobId, attemptCount, notificationToken };
}

function createDependencies(
  event: ConversionFinishedEvent,
): NotificationHandlerDependencies & { calls: string[]; emails: string[] } {
  const calls: string[] = [];
  const emails: string[] = [];

  return {
    calls,
    emails,
    parseEvent() {
      return event;
    },
    async claimNotification() {
      return claimed(1);
    },
    async getNotificationState() {
      return null;
    },
    async sendEmail(input) {
      emails.push(`${input.subject}|${input.messageId}`);
    },
    async markNotificationAsSent() {
      calls.push("sent");
    },
    async releaseNotificationForRetry(input) {
      calls.push(`retry-state:${input.errorMessage}`);
    },
    async markNotificationAsFailed(input) {
      calls.push(`failed-state:${input.errorMessage}`);
    },
  };
}

function createActions(calls: string[]): NotificationMessageActions {
  return {
    acknowledge() {
      calls.push("ack");
    },
    async retry(_, queueName, reason) {
      calls.push(`retry:${queueName}:${reason}`);
    },
    async deadLetter(_, reason) {
      calls.push(`dlq:${reason}`);
    },
  };
}

test("envia notificações de conclusão e erro com Message-ID determinístico", async () => {
  const completed = createDependencies(completedEvent);
  await handleNotificationMessage(message, completed, createActions(completed.calls), queues);

  const failed = createDependencies(failedEvent);
  await handleNotificationMessage(message, failed, createActions(failed.calls), queues);

  assert.match(completed.emails[0] ?? "", /Sua conversão foi concluída/);
  assert.match(failed.emails[0] ?? "", /não pôde ser concluída/);
  assert.deepEqual(completed.emails, [
    `Sua conversão foi concluída|<conversion-${jobId}@conversor.local>`,
  ]);
  assert.deepEqual(failed.emails, [
    `Sua conversão não pôde ser concluída|<conversion-${jobId}@conversor.local>`,
  ]);
  assert.deepEqual(completed.calls, ["sent", "ack"]);
  assert.deepEqual(failed.calls, ["sent", "ack"]);
});

test("falha inicial persiste PENDING e agenda o primeiro retry", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.sendEmail = async () => {
    throw new Error("SMTP unavailable");
  };

  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "retry-state:SMTP unavailable",
    "retry:notification.retry.5s:SMTP unavailable",
  ]);
});

test("terceira falha persiste FAILED antes de publicar na DLQ", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.claimNotification = async () => claimed(3);
  dependencies.sendEmail = async () => {
    throw new Error("SMTP unavailable");
  };

  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.calls, [
    "failed-state:SMTP unavailable",
    "dlq:SMTP unavailable",
  ]);
});

test("reentrega de uma notificação FAILED vai para a DLQ sem novo envio", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.claimNotification = async () => null;
  dependencies.getNotificationState = async () => ({
    status: "FAILED",
    leaseExpiresAt: null,
  });

  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);

  assert.deepEqual(dependencies.emails, []);
  assert.deepEqual(dependencies.calls, [
    "dlq:Notification has already exhausted its delivery attempts.",
  ]);
});
