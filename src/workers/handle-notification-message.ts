import type { ConversionFinishedEvent } from "../contracts/conversion-events.js";
import type {
  ClaimedNotification,
  NotificationState,
} from "../notifications/claim-notification.js";
import { createConversionCompletedEmail } from "../notifications/conversion-completed-email.js";
import { createConversionFailedEmail } from "../notifications/conversion-failed-email.js";
import { createNotificationMessageId } from "../notifications/message-id.js";

export const MAX_NOTIFICATION_ATTEMPTS = 3;

export type NotificationMessage = {
  content: Buffer;
};

export type NotificationHandlerDependencies = {
  parseEvent(serialized: string): ConversionFinishedEvent;
  claimNotification(jobId: string): Promise<ClaimedNotification | null>;
  getNotificationState(jobId: string): Promise<NotificationState | null>;
  sendEmail(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    messageId: string;
  }): Promise<void>;
  markNotificationAsSent(input: {
    jobId: string;
    notificationToken: string;
  }): Promise<void>;
  releaseNotificationForRetry(input: {
    jobId: string;
    notificationToken: string;
    errorMessage: string;
  }): Promise<void>;
  markNotificationAsFailed(input: {
    jobId: string;
    notificationToken: string;
    errorMessage: string;
  }): Promise<void>;
};

export type NotificationMessageActions = {
  acknowledge(message: NotificationMessage): void;
  retry(
    message: NotificationMessage,
    queueName: string,
    reason: string,
  ): Promise<void>;
  deadLetter(
    message: NotificationMessage,
    reason: string,
  ): Promise<void>;
};

export type NotificationQueues = {
  retryAfter5Seconds: string;
  retryAfter30Seconds: string;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown notification error.";
}

async function sendClaimedNotification(
  notification: ClaimedNotification,
  event: ConversionFinishedEvent,
  dependencies: NotificationHandlerDependencies,
): Promise<void> {
  const email =
    event.status === "CONCLUÍDO"
      ? createConversionCompletedEmail({
          jobId: event.jobId,
          downloadUrl: event.resultUrl,
        })
      : createConversionFailedEmail({
          jobId: event.jobId,
          error: event.error,
        });

  await dependencies.sendEmail({
    to: event.notifyEmail,
    ...email,
    messageId: createNotificationMessageId(event.jobId),
  });

  await dependencies.markNotificationAsSent({
    jobId: notification.jobId,
    notificationToken: notification.notificationToken,
  });
}

async function handleUnclaimedNotification(
  message: NotificationMessage,
  jobId: string,
  dependencies: NotificationHandlerDependencies,
  actions: NotificationMessageActions,
  queues: NotificationQueues,
): Promise<void> {
  const notificationState = await dependencies.getNotificationState(jobId);

  if (notificationState === null || notificationState.status === "SENT") {
    actions.acknowledge(message);
    return;
  }

  if (notificationState.status === "FAILED") {
    await actions.deadLetter(
      message,
      "Notification has already exhausted its delivery attempts.",
    );
    return;
  }

  const retryQueue =
    notificationState.status === "SENDING"
      ? queues.retryAfter30Seconds
      : queues.retryAfter5Seconds;

  await actions.retry(
    message,
    retryQueue,
    "Notification is not currently available for processing.",
  );
}

export async function handleNotificationMessage(
  message: NotificationMessage,
  dependencies: NotificationHandlerDependencies,
  actions: NotificationMessageActions,
  queues: NotificationQueues,
): Promise<void> {
  let event: ConversionFinishedEvent;

  try {
    event = dependencies.parseEvent(message.content.toString("utf8"));
  } catch (error) {
    await actions.deadLetter(message, getErrorMessage(error));
    return;
  }

  let notification: ClaimedNotification | null;

  try {
    notification = await dependencies.claimNotification(event.jobId);
  } catch (error) {
    await actions.retry(
      message,
      queues.retryAfter5Seconds,
      getErrorMessage(error),
    );
    return;
  }

  if (notification === null) {
    await handleUnclaimedNotification(message, event.jobId, dependencies, actions, queues);
    return;
  }

  try {
    await sendClaimedNotification(notification, event, dependencies);
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    if (notification.attemptCount < MAX_NOTIFICATION_ATTEMPTS) {
      await dependencies.releaseNotificationForRetry({
        jobId: notification.jobId,
        notificationToken: notification.notificationToken,
        errorMessage,
      });

      await actions.retry(
        message,
        notification.attemptCount === 1
          ? queues.retryAfter5Seconds
          : queues.retryAfter30Seconds,
        errorMessage,
      );
      return;
    }

    await dependencies.markNotificationAsFailed({
      jobId: notification.jobId,
      notificationToken: notification.notificationToken,
      errorMessage,
    });
    await actions.deadLetter(message, errorMessage);
    return;
  }

  actions.acknowledge(message);
}
