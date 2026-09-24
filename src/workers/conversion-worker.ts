import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import {
  conversionDeadLetterQueue,
  conversionQueue,
  conversionRetry5SecondsQueue,
  conversionRetry30SecondsQueue,
  createRabbitMqConfirmChannel,
} from "../broker/rabbitmq.js";
import {
  createConversionRequestedRetryEvent,
  parseConversionRequestedEventJson,
  serializeConversionRequestedEvent,
  type ConversionRequestedEvent,
} from "../contracts/conversion-events.js";
import {
  claimConversionJob,
  getConversionJobState,
  type ClaimedConversionJob,
} from "../jobs/claim-conversion-job.js";
import {
  markConversionJobAsFailed,
  releaseConversionJobForRetry,
} from "../jobs/fail-conversion-job.js";
import { convertMedia } from "../conversion/ffmpeg.js";
import { completeConversionJob } from "../jobs/complete-conversion-job.js";
import { createDownloadUrl } from "../storage/download-url.js";
import {
  convertedBucket,
  ensureStorageBuckets,
  minioClient,
} from "../storage/minio.js";
import {
  objectExists,
  removeObjectIfExists,
} from "../storage/object-lifecycle.js";
import { downloadUrlToFile, uploadFileAsObject } from "../storage/object-files.js";
import { processClaimedConversionJob } from "./process-claimed-conversion-job.js";

const MAX_CONVERSION_ATTEMPTS = 3;

const processingDependencies = {
  resultBucket: convertedBucket,
  objectExists: (bucketName: string, objectKey: string) =>
    objectExists(minioClient, bucketName, objectKey),
  removeObjectIfExists: (bucketName: string, objectKey: string) =>
    removeObjectIfExists(minioClient, bucketName, objectKey),
  downloadUrlToFile,
  convertMedia,
  uploadFileAsObject,
  createDownloadUrl,
  completeConversionJob,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "Unknown conversion error.";
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
      "x-original-queue": conversionQueue,
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
    conversionDeadLetterQueue,
    message.content,
    reason,
  );

  channel.ack(message);
}

async function retryConversionMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  event: ConversionRequestedEvent,
  queueName: string,
  reason: string,
  attempt: number,
): Promise<void> {
  const retryEvent = createConversionRequestedRetryEvent(event, attempt);

  channel.sendToQueue(
    queueName,
    Buffer.from(serializeConversionRequestedEvent(retryEvent)),
    {
      contentType: "application/json",
      headers: {
        "x-error-reason": reason,
        "x-original-queue": conversionQueue,
      },
      messageId: event.eventId,
      persistent: true,
      type: event.type,
    },
  );

  await channel.waitForConfirms();
  channel.ack(message);
}

async function handleProcessingFailure(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  event: ConversionRequestedEvent,
  job: ClaimedConversionJob,
  errorMessage: string,
): Promise<void> {
  const failureInput = {
    jobId: job.id,
    processingToken: job.processingToken,
    errorMessage,
  };

  if (job.attemptCount < MAX_CONVERSION_ATTEMPTS) {
    await releaseConversionJobForRetry(failureInput);

    const retryQueue =
      job.attemptCount === 1
        ? conversionRetry5SecondsQueue
        : conversionRetry30SecondsQueue;

    await retryConversionMessage(
      channel,
      message,
      event,
      retryQueue,
      errorMessage,
      job.attemptCount + 1,
    );

    return;
  }

  await markConversionJobAsFailed({
    ...failureInput,
    notifyEmail: event.notifyEmail,
  });

  await moveMessageToDeadLetterQueue(channel, message, errorMessage);
}

async function handleUnclaimedJob(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  event: ConversionRequestedEvent,
): Promise<void> {
  const jobState = await getConversionJobState(event.jobId);

  if (
    jobState === null ||
    jobState.status === "CONCLUÍDO" ||
    jobState.status === "ERRO"
  ) {
    channel.ack(message);

    return;
  }

  const retryQueue =
    jobState.status === "PROCESSANDO"
      ? conversionRetry30SecondsQueue
      : conversionRetry5SecondsQueue;

  await retryConversionMessage(
    channel,
    message,
    event,
    retryQueue,
    "Job is not currently available for processing.",
    event.attempt,
  );
}

async function handleMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
): Promise<void> {
  let event: ConversionRequestedEvent;

  try {
    event = parseConversionRequestedEventJson(message.content.toString("utf8"));
  } catch (error) {
    await moveMessageToDeadLetterQueue(
      channel,
      message,
      getErrorMessage(error),
    );

    return;
  }

  let job: ClaimedConversionJob | null;

  try {
    job = await claimConversionJob(event.jobId);
  } catch (error) {
    await retryConversionMessage(
      channel,
      message,
      event,
      conversionRetry5SecondsQueue,
      getErrorMessage(error),
      event.attempt,
    );

    return;
  }

  if (job === null) {
    await handleUnclaimedJob(channel, message, event);

    return;
  }

  try {
    await processClaimedConversionJob(job, event, processingDependencies);
  } catch (error) {
    await handleProcessingFailure(
      channel,
      message,
      event,
      job,
      getErrorMessage(error),
    );

    return;
  }

  channel.ack(message);
}

async function startConversionWorker(): Promise<void> {
  await ensureStorageBuckets();

  const { connection, channel } = await createRabbitMqConfirmChannel();

  await channel.prefetch(1);

  await channel.consume(
    conversionQueue,
    (message) => {
      if (message === null) {
        console.warn("Conversion consumer was cancelled.");

        return;
      }

      void handleMessage(channel, message).catch(async (error) => {
        console.error("Conversion worker failed.", error);

        await channel.close();
        await connection.close();

        process.exitCode = 1;
      });
    },
    {
      noAck: false,
    },
  );

  console.log("Conversion worker is waiting for messages.");
}

void startConversionWorker().catch((error) => {
  console.error("Could not start conversion worker.", error);

  process.exitCode = 1;
});
