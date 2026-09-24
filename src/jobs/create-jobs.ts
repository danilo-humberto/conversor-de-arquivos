import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { extname } from "node:path";

import {
  serializeConversionRequestedEvent,
  type ConversionSourceType,
} from "../contracts/conversion-events.js";
import { database } from "../db/connection.js";
import { env } from "../config/env.js";
import { createInitialConversionRequestedEvent } from "../outbox/conversion-requested-payload.js";
import {
  ensureStorageBuckets,
  minioClient,
  uploadsBucket,
} from "../storage/minio.js";
import { createInternalSourceUrl } from "../storage/source-url.js";

export class JobValidationError extends Error {}

interface CreateJobInput {
  file: Express.Multer.File;
  targetFormat: unknown;
  notifyEmail: unknown;
}

interface CreatedJob {
  jobId: string;
  status: "PENDENTE";
}

function getSourceType(mimeType: string): ConversionSourceType {
  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  throw new JobValidationError("Must be a video or audio file.");
}

function getSourceFormat(originalName: string): string {
  const format = extname(originalName).slice(1).toLowerCase();

  if (!/^[a-z0-9]+$/.test(format)) {
    throw new JobValidationError("Could not identify the file format.");
  }

  return format;
}

function getTargetFormat(
  value: unknown,
  sourceType: ConversionSourceType,
): string {
  if (typeof value !== "string") {
    throw new JobValidationError("targetFormat is required.");
  }

  const targetFormat = value.trim().toLowerCase();

  const allowedFormats: Record<ConversionSourceType, string[]> = {
    video: ["mp4", "webm"],
    audio: ["mp3", "wav"],
  };

  if (!allowedFormats[sourceType].includes(targetFormat)) {
    throw new JobValidationError(
      `Invalid output format for ${sourceType}: ${targetFormat}.`,
    );
  }

  return targetFormat;
}

function getNotifyEmail(value: unknown): string {
  if (typeof value !== "string") {
    throw new JobValidationError("notifyEmail is required.");
  }

  const email = value.trim().toLowerCase();
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isValidEmail) {
    throw new JobValidationError("notifyEmail must be a valid email address.");
  }

  return email;
}

export async function createJob(input: CreateJobInput): Promise<CreatedJob> {
  try {
    const jobId = randomUUID();
    const sourceType = getSourceType(input.file.mimetype);
    const sourceFormat = getSourceFormat(input.file.originalname);
    const targetFormat = getTargetFormat(input.targetFormat, sourceType);
    const notifyEmail = getNotifyEmail(input.notifyEmail);
    const requestedAt = new Date().toISOString();
    const sourceObjectKey = `${jobId}/source.${sourceFormat}`;

    await ensureStorageBuckets();

    await minioClient.fPutObject(
      uploadsBucket,
      sourceObjectKey,
      input.file.path,
      {
        "Content-Type": input.file.mimetype,
      },
    );

    const client = await database.connect();

    try {
      await client.query("BEGIN");

      const sourceUrl = await createInternalSourceUrl(
        minioClient,
        uploadsBucket,
        sourceObjectKey,
        env.minio.sourceUrlExpirySeconds,
      );

      await client.query(
        `
          INSERT INTO jobs (
            id,
            status,
            source_bucket,
            source_object_key,
            source_type,
            source_format,
            target_format,
            notify_email
          )
          VALUES ($1, 'PENDENTE', $2, $3, $4, $5, $6, $7)
        `,
        [
          jobId,
          uploadsBucket,
          sourceObjectKey,
          sourceType,
          sourceFormat,
          targetFormat,
          notifyEmail,
        ],
      );

      const eventId = randomUUID();

      await client.query(
        `
          INSERT INTO outbox_events (
            id,
            job_id,
            event_type,
            payload,
            status
          )
          VALUES ($1, $2, 'conversion.requested', $3, 'PENDING')
        `,
        [
          eventId,
          jobId,
          serializeConversionRequestedEvent(createInitialConversionRequestedEvent({
            eventId,
            jobId,
            sourceUrl,
            sourceType,
            sourceFormat,
            targetFormat,
            notifyEmail,
            requestedAt,
          })),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");

      await minioClient.removeObject(uploadsBucket, sourceObjectKey);

      throw error;
    } finally {
      client.release();
    }

    return {
      jobId,
      status: "PENDENTE",
    };
  } finally {
    await rm(input.file.path, { force: true });
  }
}
