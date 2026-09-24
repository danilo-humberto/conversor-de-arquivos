export type OutboxDispatcherLogger = Pick<Console, "error" | "info">;

export type OutboxDispatcherOptions = {
  dispatchPendingEvents: () => Promise<number>;
  pollIntervalMs: number;
  delay: (durationMs: number) => Promise<void>;
  shouldContinue: () => boolean;
  logger: OutboxDispatcherLogger;
};

export async function runOutboxDispatcher(
  options: OutboxDispatcherOptions,
): Promise<void> {
  while (options.shouldContinue()) {
    try {
      const dispatchedEvents = await options.dispatchPendingEvents();

      if (dispatchedEvents > 0) {
        options.logger.info(`Outbox events dispatched: ${dispatchedEvents}`);
      }
    } catch (error) {
      options.logger.error("Could not dispatch outbox events.", error);
    }

    if (!options.shouldContinue()) {
      return;
    }

    await options.delay(options.pollIntervalMs);
  }
}
