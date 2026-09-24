import assert from "node:assert/strict";
import test from "node:test";

import {
  publishClaimedOutboxEvent,
  type ClaimedOutboxEvent,
  type OutboxPublisherDependencies,
} from "./dispatch.js";

const event: ClaimedOutboxEvent = {
  id: "c0a80111-4f9d-4e3e-8d8c-123456789abc",
  eventType: "conversion.requested",
  payload: { jobId: "c0a80112-4f9d-4e3e-8d8c-123456789abc", attempt: 1 },
  processingToken: "c0a80113-4f9d-4e3e-8d8c-123456789abc",
};

function createDependencies(calls: string[]): OutboxPublisherDependencies {
  return {
    async createChannel() {
      return {
        connection: { async close() { calls.push("connection closed"); } },
        channel: {
          sendToQueue(queueName, content, options) {
            calls.push(`publish:${queueName}:${content.toString("utf8")}:${options.messageId}:${options.type}`);
            return true;
          },
          async waitForConfirms() { calls.push("confirmed"); },
          async close() { calls.push("channel closed"); },
        },
      };
    },
    getDestinationQueue(eventType) {
      assert.equal(eventType, event.eventType);
      return "conversion.jobs";
    },
    async markAsPublished(eventId, processingToken) {
      assert.equal(eventId, event.id);
      assert.equal(processingToken, event.processingToken);
      calls.push("marked published");
    },
  };
}

test("publica com confirmação antes de marcar o evento da outbox", async () => {
  const calls: string[] = [];

  await publishClaimedOutboxEvent(event, createDependencies(calls));

  assert.deepEqual(calls, [
    `publish:conversion.jobs:${JSON.stringify(event.payload)}:${event.id}:${event.eventType}`,
    "confirmed",
    "marked published",
    "channel closed",
    "connection closed",
  ]);
});

test("falha de confirmação mantém o evento pendente e fecha recursos", async () => {
  const calls: string[] = [];
  const dependencies = createDependencies(calls);
  const baseCreateChannel = dependencies.createChannel;
  dependencies.createChannel = async () => {
    const resources = await baseCreateChannel();
    resources.channel.waitForConfirms = async () => {
      calls.push("confirmation failed");
      throw new Error("RabbitMQ unavailable");
    };
    return resources;
  };

  await assert.rejects(
    publishClaimedOutboxEvent(event, dependencies),
    /RabbitMQ unavailable/,
  );

  assert.deepEqual(calls, [
    `publish:conversion.jobs:${JSON.stringify(event.payload)}:${event.id}:${event.eventType}`,
    "confirmation failed",
    "channel closed",
    "connection closed",
  ]);
});
