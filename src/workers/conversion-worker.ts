import type { ConfirmChannel, ConsumeMessage } from "amqplib";

import {
  conversionDeadLetterQueue,
  conversionQueue,
  conversionRetry5SecondsQueue,
  conversionRetry30SecondsQueue,
  createRabbitMqConfirmChannel,
} from "../broker/rabbitmq.js";
import {
  claimConversionJob,
  getConversionJobState,
  type ClaimedConversionJob,
} from "../jobs/claim-conversion-job.js";
import {
  markConversionJobAsFailed,
  releaseConversionJobForRetry,
} from "../jobs/fail-conversion-job.js";
import { ensureStorageBuckets } from "../storage/minio.js";
import { processClaimedConversionJob } from "./process-claimed-conversion-job.js";

const MAX_CONVERSION_ATTEMPTS = 3;

type ConversionRequestedMessage = {
  jobId: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown conversion error.";
}

function parseConversionRequestedMessage(
  message: ConsumeMessage,
): ConversionRequestedMessage {
  const payload: unknown = JSON.parse(message.content.toString("utf8"));

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("jobId" in payload) ||
    typeof payload.jobId !== "string"
  ) {
    throw new Error("Invalid conversion message.");
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

async function retryMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  queueName: string,
  reason: string,
): Promise<void> {
  await publishWithConfirmation(channel, queueName, message.content, reason);

  channel.ack(message);
}

async function handleProcessingFailure(
  channel: ConfirmChannel,
  message: ConsumeMessage,
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

    await retryMessage(channel, message, retryQueue, errorMessage);

    return;
  }

  await markConversionJobAsFailed(failureInput);

  await moveMessageToDeadLetterQueue(channel, message, errorMessage);
}

async function handleUnclaimedJob(
  channel: ConfirmChannel,
  message: ConsumeMessage,
  jobId: string,
): Promise<void> {
  const jobState = await getConversionJobState(jobId);

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

  await retryMessage(
    channel,
    message,
    retryQueue,
    "Job is not currently available for processing.",
  );
}

async function handleMessage(
  channel: ConfirmChannel,
  message: ConsumeMessage,
): Promise<void> {
  let event: ConversionRequestedMessage;

  try {
    event = parseConversionRequestedMessage(message);
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
    await retryMessage(
      channel,
      message,
      conversionRetry5SecondsQueue,
      getErrorMessage(error),
    );

    return;
  }

  if (job === null) {
    await handleUnclaimedJob(channel, message, event.jobId);

    return;
  }

  try {
    await processClaimedConversionJob(job);
  } catch (error) {
    await handleProcessingFailure(
      channel,
      message,
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
