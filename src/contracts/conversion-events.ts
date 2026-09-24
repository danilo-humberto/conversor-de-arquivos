export type ConversionSourceType = "audio" | "video";

export type ConversionRequestedEvent = {
  eventId: string;
  type: "conversion.requested";
  jobId: string;
  sourceUrl: string;
  sourceType: ConversionSourceType;
  sourceFormat: string;
  targetFormat: string;
  notifyEmail: string;
  requestedAt: string;
  attempt: number;
};

type ConversionFinishedEventBase = {
  eventId: string;
  type: "conversion.finished";
  jobId: string;
  notifyEmail: string;
  occurredAt: string;
};

export type ConversionFinishedEvent =
  | (ConversionFinishedEventBase & {
      status: "CONCLUÍDO";
      resultUrl: string;
      error: null;
    })
  | (ConversionFinishedEventBase & {
      status: "ERRO";
      resultUrl: null;
      error: string;
    });

export class ConversionEventValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversionEventValidationError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMAT_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function asRecord(value: unknown, eventName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ConversionEventValidationError(
      `${eventName} must be a JSON object.`,
    );
  }

  return value as Record<string, unknown>;
}

function assertExactKeys(
  payload: Record<string, unknown>,
  keys: readonly string[],
  eventName: string,
): void {
  const receivedKeys = Object.keys(payload);

  if (
    receivedKeys.length !== keys.length ||
    receivedKeys.some((key) => !keys.includes(key))
  ) {
    throw new ConversionEventValidationError(
      `${eventName} has unexpected or missing fields.`,
    );
  }
}

function readString(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = payload[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new ConversionEventValidationError(
      `${eventName}.${field} must be a non-empty string.`,
    );
  }

  return value;
}

function readUuid(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = readString(payload, field, eventName);

  if (!UUID_PATTERN.test(value)) {
    throw new ConversionEventValidationError(
      `${eventName}.${field} must be a UUID.`,
    );
  }

  return value;
}

function readHttpUrl(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = readString(payload, field, eventName);

  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported URL protocol.");
    }
  } catch {
    throw new ConversionEventValidationError(
      `${eventName}.${field} must be an HTTP(S) URL.`,
    );
  }

  return value;
}

function readPresignedMinioUrl(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = readHttpUrl(payload, field, eventName);
  const url = new URL(value);
  const requiredSignatureFields = [
    "X-Amz-Algorithm",
    "X-Amz-Credential",
    "X-Amz-Date",
    "X-Amz-Expires",
    "X-Amz-SignedHeaders",
    "X-Amz-Signature",
  ];

  if (
    requiredSignatureFields.some(
      (signatureField) => !url.searchParams.has(signatureField),
    )
  ) {
    throw new ConversionEventValidationError(
      `${eventName}.${field} must be a presigned MinIO URL.`,
    );
  }

  return value;
}

function readTimestamp(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = readString(payload, field, eventName);

  if (!ISO_8601_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ConversionEventValidationError(
      `${eventName}.${field} must be an ISO-8601 timestamp.`,
    );
  }

  return value;
}

function readFormat(
  payload: Record<string, unknown>,
  field: string,
  eventName: string,
): string {
  const value = readString(payload, field, eventName);

  if (!FORMAT_PATTERN.test(value)) {
    throw new ConversionEventValidationError(
      `${eventName}.${field} has an invalid format identifier.`,
    );
  }

  return value;
}

function readNotifyEmail(
  payload: Record<string, unknown>,
  eventName: string,
): string {
  const value = readString(payload, "notifyEmail", eventName);

  if (!EMAIL_PATTERN.test(value)) {
    throw new ConversionEventValidationError(
      `${eventName}.notifyEmail must be a valid email address.`,
    );
  }

  return value;
}

function parseJson(serialized: string, eventName: string): unknown {
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new ConversionEventValidationError(`${eventName} is not valid JSON.`);
  }
}

export function parseConversionRequestedEvent(
  value: unknown,
): ConversionRequestedEvent {
  const eventName = "conversion.requested";
  const payload = asRecord(value, eventName);

  assertExactKeys(
    payload,
    [
      "eventId",
      "type",
      "jobId",
      "sourceUrl",
      "sourceType",
      "sourceFormat",
      "targetFormat",
      "notifyEmail",
      "requestedAt",
      "attempt",
    ],
    eventName,
  );

  if (payload.type !== eventName) {
    throw new ConversionEventValidationError(`${eventName}.type is invalid.`);
  }

  const sourceType = payload.sourceType;

  if (sourceType !== "audio" && sourceType !== "video") {
    throw new ConversionEventValidationError(
      `${eventName}.sourceType must be audio or video.`,
    );
  }

  const attempt = payload.attempt;

  if (
    typeof attempt !== "number" ||
    !Number.isInteger(attempt) ||
    attempt <= 0
  ) {
    throw new ConversionEventValidationError(
      `${eventName}.attempt must be a positive integer.`,
    );
  }

  return {
    eventId: readUuid(payload, "eventId", eventName),
    type: eventName,
    jobId: readUuid(payload, "jobId", eventName),
    sourceUrl: readPresignedMinioUrl(payload, "sourceUrl", eventName),
    sourceType,
    sourceFormat: readFormat(payload, "sourceFormat", eventName),
    targetFormat: readFormat(payload, "targetFormat", eventName),
    notifyEmail: readNotifyEmail(payload, eventName),
    requestedAt: readTimestamp(payload, "requestedAt", eventName),
    attempt,
  };
}

export function parseConversionRequestedEventJson(
  serialized: string,
): ConversionRequestedEvent {
  return parseConversionRequestedEvent(
    parseJson(serialized, "conversion.requested"),
  );
}

export function createConversionRequestedRetryEvent(
  event: ConversionRequestedEvent,
  attempt: number,
): ConversionRequestedEvent {
  return parseConversionRequestedEvent({
    ...event,
    attempt,
  });
}

export function parseConversionFinishedEvent(
  value: unknown,
): ConversionFinishedEvent {
  const eventName = "conversion.finished";
  const payload = asRecord(value, eventName);

  assertExactKeys(
    payload,
    [
      "eventId",
      "type",
      "jobId",
      "notifyEmail",
      "status",
      "resultUrl",
      "error",
      "occurredAt",
    ],
    eventName,
  );

  if (payload.type !== eventName) {
    throw new ConversionEventValidationError(`${eventName}.type is invalid.`);
  }

  const common: ConversionFinishedEventBase = {
    eventId: readUuid(payload, "eventId", eventName),
    type: "conversion.finished",
    jobId: readUuid(payload, "jobId", eventName),
    notifyEmail: readNotifyEmail(payload, eventName),
    occurredAt: readTimestamp(payload, "occurredAt", eventName),
  };

  if (payload.status === "CONCLUÍDO") {
    if (payload.error !== null) {
      throw new ConversionEventValidationError(
        `${eventName}.error must be null for a completed conversion.`,
      );
    }

    return {
      ...common,
      status: "CONCLUÍDO",
      resultUrl: readHttpUrl(payload, "resultUrl", eventName),
      error: null,
    };
  }

  if (payload.status === "ERRO") {
    if (payload.resultUrl !== null) {
      throw new ConversionEventValidationError(
        `${eventName}.resultUrl must be null for a failed conversion.`,
      );
    }

    return {
      ...common,
      status: "ERRO",
      resultUrl: null,
      error: readString(payload, "error", eventName),
    };
  }

  throw new ConversionEventValidationError(
    `${eventName}.status must be CONCLUÍDO or ERRO.`,
  );
}

export function parseConversionFinishedEventJson(
  serialized: string,
): ConversionFinishedEvent {
  return parseConversionFinishedEvent(parseJson(serialized, "conversion.finished"));
}

export function serializeConversionRequestedEvent(
  event: ConversionRequestedEvent,
): string {
  return JSON.stringify(parseConversionRequestedEvent(event));
}

export function serializeConversionFinishedEvent(
  event: ConversionFinishedEvent,
): string {
  return JSON.stringify(parseConversionFinishedEvent(event));
}
