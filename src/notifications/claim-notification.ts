import { randomUUID } from "node:crypto";

import { database } from "../db/connection.js";

const NOTIFICATION_LEASE_DURATION_MS = 2 * 60 * 1000;

type NotificationRow = {
  job_id: string;
  attempt_count: number;
  notification_token: string;
  notify_email: string;
  result_bucket: string;
  result_object_key: string;
};

export type ClaimedNotification = {
  jobId: string;
  attemptCount: number;
  notificationToken: string;
  notifyEmail: string;
  resultBucket: string;
  resultObjectKey: string;
};

export async function claimNotification(
  jobId: string,
): Promise<ClaimedNotification | null> {
  const client = await database.connect();
  let transactionOpen = false;

  try {
    const processingToken = randomUUID();

    await client.query("BEGIN");
    transactionOpen = true;

    await client.query(
      `
        INSERT INTO notifications (
          job_id,
          status
        )
        VALUES ($1, 'PENDING')
        ON CONFLICT (job_id) DO NOTHING
      `,
      [jobId],
    );

    const result = await client.query<NotificationRow>(
      `
        UPDATE notifications AS notification
        SET
          status = 'SENDING',
          attempt_count = notification.attempt_count + 1,
          notification_token = $2,
          lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
          updated_at = NOW()
        FROM jobs
        WHERE notification.job_id = jobs.id
          AND notification.job_id = $1
          AND jobs.status = 'CONCLUÍDO'
          AND (
            notification.status = 'PENDING'
            OR (
              notification.status = 'SENDING'
              AND notification.lease_expires_at < NOW()
            )
          )
        RETURNING
          notification.job_id,
          notification.attempt_count,
          notification.notification_token,
          jobs.notify_email,
          jobs.result_bucket,
          jobs.result_object_key
      `,
      [jobId, processingToken, NOTIFICATION_LEASE_DURATION_MS],
    );

    await client.query("COMMIT");
    transactionOpen = false;

    const notification = result.rows.at(0);

    if (!notification) {
      return null;
    }

    return {
      jobId: notification.job_id,
      attemptCount: notification.attempt_count,
      notificationToken: notification.notification_token,
      notifyEmail: notification.notify_email,
      resultBucket: notification.result_bucket,
      resultObjectKey: notification.result_object_key,
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

type NotificationStateRow = {
  status: string;
  lease_expires_at: Date | null;
};

export type NotificationState = {
  status: string;
  leaseExpiresAt: Date | null;
};

export async function getNotificationState(
  jobId: string,
): Promise<NotificationState | null> {
  const result = await database.query<NotificationStateRow>(
    `
      SELECT
        status,
        lease_expires_at
      FROM notifications
      WHERE job_id = $1
    `,
    [jobId],
  );

  const notification = result.rows.at(0);

  if (!notification) {
    return null;
  }

  return {
    status: notification.status,
    leaseExpiresAt: notification.lease_expires_at,
  };
}
