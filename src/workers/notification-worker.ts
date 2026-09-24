import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import {
  createRabbitMqConfirmChannel,
  notificationDeadLetterQueue,
  notificationQueue,
  notificationRetry5SecondsQueue,
  notificationRetry30SecondsQueue,
} from "../broker/rabbitmq.js";
import { parseConversionFinishedEventJson } from "../contracts/conversion-events.js";
import {
  claimNotification,
  getNotificationState,
} from "../notifications/claim-notification.js";
import { sendEmail } from "../notifications/smtp.js";
import {
  markNotificationAsFailed,
  markNotificationAsSent,
  releaseNotificationForRetry,
} from "../notifications/update-notification.js";
import {
  handleNotificationMessage,
  type NotificationMessage,
} from "./handle-notification-message.js";

async function publishWithConfirmation(
  channel: ConfirmChannel,
  queueName: string,
  content: Buffer,
  reason: string,
): Promise<void> {
  channel.sendToQueue(queueName, content, {
    contentType: "application/json",
    headers: {
      "x-error-reason": reason,
      "x-original-queue": notificationQueue,
    },
    persistent: true,
  });

  await channel.waitForConfirms();
}

function toNotificationMessage(message: ConsumeMessage): NotificationMessage {
  return { content: message.content };
}

async function startNotificationWorker(): Promise<void> {
  const { connection, channel } = await createRabbitMqConfirmChannel();

  await channel.prefetch(1);

  await channel.consume(
    notificationQueue,
    (message) => {
      if (message === null) {
        console.warn("Notification consumer was cancelled.");
        return;
      }

      const workerMessage = toNotificationMessage(message);

      void handleNotificationMessage(
        workerMessage,
        {
          parseEvent: parseConversionFinishedEventJson,
          claimNotification,
          getNotificationState,
          sendEmail,
          markNotificationAsSent,
          releaseNotificationForRetry,
          markNotificationAsFailed,
        },
        {
          acknowledge() {
            channel.ack(message);
          },
          async retry(_, queueName, reason) {
            await publishWithConfirmation(
              channel,
              queueName,
              workerMessage.content,
              reason,
            );
            channel.ack(message);
          },
          async deadLetter(_, reason) {
            await publishWithConfirmation(
              channel,
              notificationDeadLetterQueue,
              workerMessage.content,
              reason,
            );
            channel.ack(message);
          },
        },
        {
          retryAfter5Seconds: notificationRetry5SecondsQueue,
          retryAfter30Seconds: notificationRetry30SecondsQueue,
        },
      ).catch(async (error) => {
        console.error("Notification worker failed.", error);

        await channel.close();
        await connection.close();

        process.exitCode = 1;
      });
    },
    { noAck: false },
  );

  console.log("Notification worker is waiting for messages.");
}

void startNotificationWorker().catch((error) => {
  console.error("Could not start notification worker.", error);

  process.exitCode = 1;
});
