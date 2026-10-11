import type { ConversionFinishedEvent } from "../contracts/conversion-events.js";
import type {
  ClaimedNotification,
  NotificationState,
} from "../notifications/claim-notification.js";
import { createConversionCompletedEmail } from "../notifications/conversion-completed-email.js";
import { createConversionFailedEmail } from "../notifications/conversion-failed-email.js";
import { createNotificationMessageId } from "../notifications/message-id.js";
import { MAX_NOTIFICATION_ATTEMPTS } from "../contracts/processing-policy.js";

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

}

function definitelyNotAccepted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const smtpError = error as Error & { code?: string; command?: string; responseCode?: number };
  // Connection/authentication/envelope failures precede message acceptance.
  // A timeout or disconnect during DATA is ambiguous and must not trigger resend.
  return smtpError.command === "CONN" || smtpError.command === "AUTH" ||
    smtpError.command === "MAIL FROM" || smtpError.command === "RCPT TO" ||
    smtpError.code === "EAUTH" || smtpError.code === "EENVELOPE" ||
    (typeof smtpError.responseCode === "number" && smtpError.responseCode >= 400);
}

async function quarantineDelivery(
  message: NotificationMessage,
  notification: ClaimedNotification,
  reason: string,
  dependencies: NotificationHandlerDependencies,
  actions: NotificationMessageActions,
): Promise<void> {
  await dependencies.markNotificationAsFailed({
    jobId: notification.jobId,
    notificationToken: notification.notificationToken,
    errorMessage: reason,
  });
  await actions.deadLetter(message, reason);
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
      "Notification requires review or has exhausted its delivery attempts.",
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

  if (notification.deliveryUncertain) {
    await quarantineDelivery(message, notification,
      "Delivery outcome uncertain: previous sending lease expired; automatic resend disabled.",
      dependencies, actions);
    return;
  }

  if (notification.attemptsExhausted) {
    const reason = "Notification has exhausted its delivery attempts.";
    await dependencies.markNotificationAsFailed({
      jobId: notification.jobId,
      notificationToken: notification.notificationToken,
      errorMessage: reason,
    });
    await actions.deadLetter(message, reason);
    return;
  }

  try {
    await sendClaimedNotification(event, dependencies);
  } catch (error) {
    const errorMessage = getErrorMessage(error);

    if (!definitelyNotAccepted(error)) {
      await quarantineDelivery(message, notification,
        `Delivery outcome uncertain: ${errorMessage}; automatic resend disabled.`,
        dependencies, actions);
      return;
    }

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

  try {
    await dependencies.markNotificationAsSent({
      jobId: notification.jobId,
      notificationToken: notification.notificationToken,
    });
  } catch (error) {
    // SMTP already accepted the message. A database failure must never release
    // it to PENDING. If quarantine also fails, SENDING remains for safe recovery.
    await quarantineDelivery(message, notification,
      `SMTP accepted; SENT persistence failed: ${getErrorMessage(error)}; automatic resend disabled.`,
      dependencies, actions);
    return;
  }
  actions.acknowledge(message);
}
