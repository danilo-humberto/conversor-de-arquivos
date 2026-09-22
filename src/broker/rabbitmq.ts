import { connect, type Channel, type ConfirmChannel } from "amqplib";
import { env } from "../config/env.js";

export const conversionQueue = "conversion.jobs";
export const conversionRetry5SecondsQueue = "conversion.retry.5s";
export const conversionRetry30SecondsQueue = "conversion.retry.30s";
export const conversionDeadLetterQueue = "conversion.dlq";

function createRabbitMqUrl(): string {
  const user = encodeURIComponent(env.rabbitmq.user);
  const password = encodeURIComponent(env.rabbitmq.password);
  const vhost = encodeURIComponent(env.rabbitmq.vhost);

  return `amqp://${user}:${password}@${env.rabbitmq.host}:${env.rabbitmq.port}/${vhost}`;
}

async function assertConversionTopology(
  channel: Channel | ConfirmChannel,
): Promise<void> {
  await channel.assertQueue(conversionQueue, {
    durable: true,
  });

  await channel.assertQueue(conversionRetry5SecondsQueue, {
    durable: true,
    arguments: {
      "x-message-ttl": 5_000,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": conversionQueue,
    },
  });

  await channel.assertQueue(conversionRetry30SecondsQueue, {
    durable: true,
    arguments: {
      "x-message-ttl": 30_000,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": conversionQueue,
    },
  });

  await channel.assertQueue(conversionDeadLetterQueue, {
    durable: true,
  });
}

export async function createRabbitMqChannel() {
  const connection = await connect(createRabbitMqUrl());
  const channel = await connection.createChannel();

  await assertConversionTopology(channel);

  return { connection, channel };
}

export async function createRabbitMqConfirmChannel() {
  const connection = await connect(createRabbitMqUrl());

  const channel = await connection.createConfirmChannel();

  await assertConversionTopology(channel);

  return {
    connection,
    channel,
  };
}
