import amqp from "amqplib";
import { env } from "../config/env.js";

export const conversionQueue = "conversion.jobs";

function createRabbitMqUrl(): string {
  const user = encodeURIComponent(env.rabbitmq.user);
  const password = encodeURIComponent(env.rabbitmq.password);
  const vhost = encodeURIComponent(env.rabbitmq.vhost);

  return `amqp://${user}:${password}@${env.rabbitmq.host}:${env.rabbitmq.port}/${vhost}`;
}

export async function createRabbitMqChannel() {
  const connection = await amqp.connect(createRabbitMqUrl());
  const channel = await connection.createChannel();

  await channel.assertQueue(conversionQueue, { durable: true });

  return { connection, channel };
}
