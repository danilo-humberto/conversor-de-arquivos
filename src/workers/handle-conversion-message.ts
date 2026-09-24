import type { ConversionRequestedEvent } from "../contracts/conversion-events.js";
import type { ClaimedConversionJob, ConversionJobState } from "../jobs/claim-conversion-job.js";
import { ConversionJobLeaseLostError } from "../jobs/conversion-job-heartbeat.js";
import { JobCompletionError } from "../jobs/complete-conversion-job.js";

export const MAX_CONVERSION_ATTEMPTS = 3;

export type ConversionMessage = {
  content: Buffer;
};

export type ConversionMessageQueues = {
  retryAfter5Seconds: string;
  retryAfter30Seconds: string;
};

export type ConversionMessageActions = {
  acknowledge(message: ConversionMessage): void;
  retry(input: {
    message: ConversionMessage;
    event: ConversionRequestedEvent;
    queueName: string;
    reason: string;
    attempt: number;
  }): Promise<void>;
  deadLetter(message: ConversionMessage, reason: string): Promise<void>;
};

type ConversionHeartbeat = {
  assertOwnership(): void;
  stop(): Promise<void>;
};

export type ConversionMessageDependencies = {
  parseEvent(serialized: string): ConversionRequestedEvent;
  claimConversionJob(jobId: string): Promise<ClaimedConversionJob | null>;
  getConversionJobState(jobId: string): Promise<ConversionJobState | null>;
  startHeartbeat(jobId: string, processingToken: string): ConversionHeartbeat;
  processClaimedJob(
    job: ClaimedConversionJob,
    event: ConversionRequestedEvent,
    assertProcessingOwnership: () => void,
  ): Promise<void>;
  releaseForRetry(input: {
    jobId: string;
    processingToken: string;
    errorMessage: string;
  }): Promise<void>;
  markAsFailed(input: {
    jobId: string;
    processingToken: string;
    errorMessage: string;
    notifyEmail: string;
  }): Promise<void>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "Unknown conversion error.";
}

async function handleProcessingFailure(
  message: ConversionMessage,
  event: ConversionRequestedEvent,
  job: ClaimedConversionJob,
  errorMessage: string,
  dependencies: ConversionMessageDependencies,
  actions: ConversionMessageActions,
  queues: ConversionMessageQueues,
): Promise<void> {
  const failureInput = {
    jobId: job.id,
    processingToken: job.processingToken,
    errorMessage,
  };

  if (job.attemptCount < MAX_CONVERSION_ATTEMPTS) {
    await dependencies.releaseForRetry(failureInput);
    await actions.retry({
      message,
      event,
      queueName: job.attemptCount === 1
        ? queues.retryAfter5Seconds
        : queues.retryAfter30Seconds,
      reason: errorMessage,
      attempt: job.attemptCount + 1,
    });
    return;
  }

  await dependencies.markAsFailed({
    ...failureInput,
    notifyEmail: event.notifyEmail,
  });
  await actions.deadLetter(message, errorMessage);
}

async function handleUnclaimedJob(
  message: ConversionMessage,
  event: ConversionRequestedEvent,
  dependencies: ConversionMessageDependencies,
  actions: ConversionMessageActions,
  queues: ConversionMessageQueues,
): Promise<void> {
  const jobState = await dependencies.getConversionJobState(event.jobId);

  if (
    jobState === null ||
    jobState.status === "CONCLUÍDO" ||
    jobState.status === "ERRO"
  ) {
    actions.acknowledge(message);
    return;
  }

  await actions.retry({
    message,
    event,
    queueName: jobState.status === "PROCESSANDO"
      ? queues.retryAfter30Seconds
      : queues.retryAfter5Seconds,
    reason: "Job is not currently available for processing.",
    attempt: event.attempt,
  });
}

export async function handleConversionMessage(
  message: ConversionMessage,
  dependencies: ConversionMessageDependencies,
  actions: ConversionMessageActions,
  queues: ConversionMessageQueues,
): Promise<void> {
  let event: ConversionRequestedEvent;

  try {
    event = dependencies.parseEvent(message.content.toString("utf8"));
  } catch (error) {
    await actions.deadLetter(message, getErrorMessage(error));
    return;
  }

  let job: ClaimedConversionJob | null;

  try {
    job = await dependencies.claimConversionJob(event.jobId);
  } catch (error) {
    await actions.retry({
      message,
      event,
      queueName: queues.retryAfter5Seconds,
      reason: getErrorMessage(error),
      attempt: event.attempt,
    });
    return;
  }

  if (job === null) {
    await handleUnclaimedJob(message, event, dependencies, actions, queues);
    return;
  }

  try {
    const heartbeat = dependencies.startHeartbeat(job.id, job.processingToken);
    let processingError: unknown;

    try {
      await dependencies.processClaimedJob(
        job,
        event,
        () => heartbeat.assertOwnership(),
      );
      heartbeat.assertOwnership();
    } catch (error) {
      processingError = error;
    } finally {
      await heartbeat.stop();
    }

    if (processingError !== undefined) {
      heartbeat.assertOwnership();
      throw processingError;
    }
  } catch (error) {
    if (
      error instanceof ConversionJobLeaseLostError ||
      error instanceof JobCompletionError
    ) {
      await actions.retry({
        message,
        event,
        queueName: queues.retryAfter30Seconds,
        reason: getErrorMessage(error),
        attempt: event.attempt,
      });
      return;
    }

    await handleProcessingFailure(
      message,
      event,
      job,
      getErrorMessage(error),
      dependencies,
      actions,
      queues,
    );
    return;
  }

  actions.acknowledge(message);
}
