import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import {
  createRabbitMqConfirmChannel,
  notificationDeadLetterQueue,
  notificationQueue,
  notificationRetry5SecondsQueue,
  notificationRetry30SecondsQueue,
} from "../broker/rabbitmq.js";
import {
  claimNotification,
  getNotificationState,
  type ClaimedNotification,
} from "../notifications/claim-notification.js";
import { createConversionCompletedEmail } from "../notifications/conversion-completed-email.js";
import {
  releaseNotificationForRetry,
  markNotificationAsSent,
} from "../notifications/update-notification.js";
import { sendEmail } from "../notifications/smtp.js";
import { createDownloadUrl } from "../storage/download-url.js";

const MAX_NOTIFICATION_ATTEMPTS = 3;

type ConversionCompletedMessage = {
  jobId: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown notification error.";
}

function parseConversionCompletedMessage(
  message: ConsumeMessage,
): ConversionCompletedMessage {
  const payload: unknown = JSON.parse(message.content.toString("utf8"));

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("jobId" in payload) ||
    typeof payload.jobId !== "string"
  ) {
    throw new Error("Invalid notification message.");
  }

  return {
    jobId: payload.jobId,
  };
}

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

async function moveMessageToDeadLetterQueue(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  reason: string,
): Promise<void> {
  await publishWithConfirmation(
    channel,
    notificationDeadLetterQueue,
    message.content,
    reason,
  );

  channel.ack(message);
}

async function retryMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  queueName: string,
  reason: string,
): Promise<void> {
  await publishWithConfirmation(channel, queueName, message.content, reason);

  channel.ack(message);
}

async function processClaimedNotification(
  notification: ClaimedNotification,
): Promise<void> {
  const downloadUrl = await createDownloadUrl(
    notification.resultBucket,
    notification.resultObjectKey,
  );

  const email = createConversionCompletedEmail({
    jobId: notification.jobId,
    downloadUrl,
  });

  await sendEmail({
    to: notification.notifyEmail,
    ...email,
  });

  await markNotificationAsSent({
    jobId: notification.jobId,
    notificationToken: notification.notificationToken,
  });
}

async function handleNotificationFailure(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  notification: ClaimedNotification,
  errorMessage: string,
): Promise<void> {
  await releaseNotificationForRetry({
    jobId: notification.jobId,
    notificationToken: notification.notificationToken,
    errorMessage,
  });

  if (notification.attemptCount < MAX_NOTIFICATION_ATTEMPTS) {
    const retryQueue =
      notification.attemptCount === 1
        ? notificationRetry5SecondsQueue
        : notificationRetry30SecondsQueue;

    await retryMessage(channel, message, retryQueue, errorMessage);

    return;
  }

  await moveMessageToDeadLetterQueue(channel, message, errorMessage);
}

async function handleUnclaimedNotification(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  jobId: string,
): Promise<void> {
  const notificationState = await getNotificationState(jobId);

  if (notificationState === null || notificationState.status === "SENT") {
    channel.ack(message);

    return;
  }

  const retryQueue =
    notificationState.status === "SENDING"
      ? notificationRetry30SecondsQueue
      : notificationRetry5SecondsQueue;

  await retryMessage(
    channel,
    message,
    retryQueue,
    "Notification is not currently available for processing.",
  );
}

async function handleMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
): Promise<void> {
  let event: ConversionCompletedMessage;

  try {
    event = parseConversionCompletedMessage(message);
  } catch (error) {
    await moveMessageToDeadLetterQueue(
      channel,
      message,
      getErrorMessage(error),
    );

    return;
  }

  let notification: ClaimedNotification | null;

  try {
    notification = await claimNotification(event.jobId);
  } catch (error) {
    await retryMessage(
      channel,
      message,
      notificationRetry5SecondsQueue,
      getErrorMessage(error),
    );

    return;
  }

  if (notification === null) {
    await handleUnclaimedNotification(channel, message, event.jobId);

    return;
  }

  try {
    await processClaimedNotification(notification);
  } catch (error) {
    await handleNotificationFailure(
      channel,
      message,
      notification,
      getErrorMessage(error),
    );

    return;
  }

  channel.ack(message);
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

      void handleMessage(channel, message).catch(async (error) => {
        console.error("Notification worker failed.", error);

        await channel.close();
        await connection.close();

        process.exitCode = 1;
      });
    },
    {
      noAck: false,
    },
  );

  console.log("Notification worker is waiting for messages.");
}

void startNotificationWorker().catch((error) => {
  console.error("Could not start notification worker.", error);

  process.exitCode = 1;
});
