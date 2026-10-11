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
  return { jobId, attemptCount, notificationToken, attemptsExhausted: false, deliveryUncertain: false };
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
    throw Object.assign(new Error("SMTP unavailable"), { command: "CONN" });
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
    throw Object.assign(new Error("SMTP unavailable"), { command: "CONN" });
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
    "dlq:Notification requires review or has exhausted its delivery attempts.",
  ]);
});

test("recuperação após terceira tentativa interrompida não envia um quarto e-mail", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.claimNotification = async () => ({ ...claimed(3), attemptsExhausted: true });
  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);
  assert.deepEqual(dependencies.emails, []);
  assert.deepEqual(dependencies.calls, [
    "failed-state:Notification has exhausted its delivery attempts.",
    "dlq:Notification has exhausted its delivery attempts.",
  ]);
});

test("notificação ocupada espera sem enviar nem incrementar tentativas no handler", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.claimNotification = async () => null;
  dependencies.getNotificationState = async () => ({ status: "SENDING", leaseExpiresAt: new Date() });
  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);
  assert.deepEqual(dependencies.emails, []);
  assert.deepEqual(dependencies.calls, [
    "retry:notification.retry.30s:Notification is not currently available for processing.",
  ]);
});

test("SMTP aceitou mas falha ao registrar SENT exige revisão sem liberar novo envio", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.markNotificationAsSent = async () => { throw new Error("Database unavailable"); };
  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);
  assert.equal(dependencies.emails.length, 1);
  assert.equal(dependencies.calls.length, 2);
  assert.match(dependencies.calls[0] ?? "", /^failed-state:SMTP accepted; SENT persistence failed:/);
  assert.match(dependencies.calls[1] ?? "", /^dlq:SMTP accepted;/);
});

test("falha também ao registrar revisão mantém SENDING para recuperação sem reenvio", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.markNotificationAsSent = async () => { throw new Error("Database unavailable"); };
  dependencies.markNotificationAsFailed = async () => { throw new Error("Database still unavailable"); };
  await assert.rejects(handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues), /Database still unavailable/);
  assert.equal(dependencies.emails.length, 1);
  assert.deepEqual(dependencies.calls, []);
});

test("lease SENDING expirada na primeira tentativa exige revisão sem enviar", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.claimNotification = async () => ({ ...claimed(1), deliveryUncertain: true });
  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);
  assert.deepEqual(dependencies.emails, []);
  assert.match(dependencies.calls[0] ?? "", /^failed-state:Delivery outcome uncertain:/);
  assert.match(dependencies.calls[1] ?? "", /^dlq:Delivery outcome uncertain:/);
});

test("timeout durante DATA não provoca reenvio de resultado incerto", async () => {
  const dependencies = createDependencies(completedEvent);
  dependencies.sendEmail = async () => {
    throw Object.assign(new Error("SMTP timeout"), { code: "ETIMEDOUT", command: "DATA" });
  };
  await handleNotificationMessage(message, dependencies, createActions(dependencies.calls), queues);
  assert.match(dependencies.calls[0] ?? "", /^failed-state:Delivery outcome uncertain:/);
  assert.match(dependencies.calls[1] ?? "", /^dlq:Delivery outcome uncertain:/);
});
