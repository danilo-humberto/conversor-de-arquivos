import {
  conversionQueue,
  notificationQueue,
} from "../broker/queues.js";

export function getOutboxDestinationQueue(eventType: string): string {
  switch (eventType) {
    case "conversion.requested":
      return conversionQueue;

    case "conversion.finished":
      return notificationQueue;

    default:
      throw new Error(`Unsupported outbox event type: ${eventType}`);
  }
}
