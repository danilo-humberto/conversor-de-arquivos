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
} from "../contracts/conversion-events.js";
import {
  claimConversionJob,
  getConversionJobState,
} from "../jobs/claim-conversion-job.js";
import {
  startConversionJobHeartbeat,
} from "../jobs/conversion-job-heartbeat.js";
import {
  markConversionJobAsFailed,
  releaseConversionJobForRetry,
} from "../jobs/fail-conversion-job.js";
import { convertMedia } from "../conversion/ffmpeg.js";
import {
  completeConversionJob,
} from "../jobs/complete-conversion-job.js";
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
import { handleConversionMessage } from "./handle-conversion-message.js";

const processingDependencies = {
  resultBucket: convertedBucket,
  assertProcessingOwnership: () => undefined,
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

async function handleMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
): Promise<void> {
  await handleConversionMessage(
    { content: message.content },
    {
      parseEvent: (serialized) => parseConversionRequestedEventJson(serialized),
      claimConversionJob,
      getConversionJobState,
      startHeartbeat: startConversionJobHeartbeat,
      processClaimedJob: (job, event, assertProcessingOwnership) =>
        processClaimedConversionJob(job, event, {
          ...processingDependencies,
          assertProcessingOwnership,
        }),
      releaseForRetry: releaseConversionJobForRetry,
      markAsFailed: markConversionJobAsFailed,
    },
    {
      acknowledge() {
        channel.ack(message);
      },
      async retry({ event, queueName, reason, attempt }) {
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
      },
      async deadLetter(_, reason) {
        await moveMessageToDeadLetterQueue(channel, message, reason);
      },
    },
    {
      retryAfter5Seconds: conversionRetry5SecondsQueue,
      retryAfter30Seconds: conversionRetry30SecondsQueue,
    },
  );
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
