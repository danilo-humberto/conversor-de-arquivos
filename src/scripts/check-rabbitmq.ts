import { conversionQueue, createRabbitMqChannel } from "../broker/rabbitmq.js";

async function main(): Promise<void> {
  const { connection, channel } = await createRabbitMqChannel();

  try {
    console.log(`Queue confirmed: ${conversionQueue}`);
  } finally {
    await channel.close();
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error("Failed to connect to RabbitMQ.");
  console.error(error);

  process.exitCode = 1;
});
