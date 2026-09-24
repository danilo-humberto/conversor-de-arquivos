import {
  parseConversionRequestedEvent,
  type ConversionSourceType,
  type ConversionRequestedEvent,
} from "../contracts/conversion-events.js";

type InitialConversionRequestedEventInput = {
  eventId: string;
  jobId: string;
  sourceUrl: string;
  sourceType: ConversionSourceType;
  sourceFormat: string;
  targetFormat: string;
  notifyEmail: string;
  requestedAt: string;
};

export function createInitialConversionRequestedEvent(
  input: InitialConversionRequestedEventInput,
): ConversionRequestedEvent {
  return parseConversionRequestedEvent({
    ...input,
    type: "conversion.requested",
    attempt: 1,
  });
}
