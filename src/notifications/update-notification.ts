import { database } from "../db/connection.js";

type NotificationUpdateInput = {
  jobId: string;
  notificationToken: string;
  errorMessage?: string;
};

export class NotificationUpdateError extends Error {
  constructor(message: string) {
    super(message);

    this.name = "NotificationUpdateError";
  }
}

export async function markNotificationAsSent(
  input: NotificationUpdateInput,
): Promise<void> {
  const result = await database.query(
    `
      UPDATE notifications
      SET
        status = 'SENT',
        notification_token = NULL,
        lease_expires_at = NULL,
        sent_at = NOW(),
        updated_at = NOW()
      WHERE job_id = $1
        AND status = 'SENDING'
        AND notification_token = $2
    `,
    [input.jobId, input.notificationToken],
  );

  if (result.rowCount !== 1) {
    throw new NotificationUpdateError(
      "Notification could not be marked as sent because its lease is no longer valid.",
    );
  }
}

export async function releaseNotificationForRetry(
  input: NotificationUpdateInput,
): Promise<void> {
  const result = await database.query(
    `
      UPDATE notifications
      SET
        status = 'PENDING',
        notification_token = NULL,
        lease_expires_at = NULL,
        last_error = $3,
        updated_at = NOW()
      WHERE job_id = $1
        AND status = 'SENDING'
        AND notification_token = $2
    `,
    [
      input.jobId,
      input.notificationToken,
      input.errorMessage ?? "Unknown notification error.",
    ],
  );

  if (result.rowCount !== 1) {
    throw new NotificationUpdateError(
      "Notification could not be released for retry because its lease is no longer valid.",
    );
  }
}

export async function markNotificationAsFailed(
  input: NotificationUpdateInput,
): Promise<void> {
  const result = await database.query(
    `
      UPDATE notifications
      SET
        status = 'FAILED',
        notification_token = NULL,
        lease_expires_at = NULL,
        last_error = $3,
        updated_at = NOW()
      WHERE job_id = $1
        AND status = 'SENDING'
        AND notification_token = $2
    `,
    [
      input.jobId,
      input.notificationToken,
      input.errorMessage ?? "Unknown notification error.",
    ],
  );

  if (result.rowCount !== 1) {
    throw new NotificationUpdateError(
      "Notification could not be marked as failed because its lease is no longer valid.",
    );
  }
}
