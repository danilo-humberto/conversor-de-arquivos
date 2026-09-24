import { setTimeout as delay } from "node:timers/promises";

import { env } from "../config/env.js";
import { dispatchPendingOutboxEvents } from "../outbox/dispatch.js";
import { runOutboxDispatcher } from "../outbox/outbox-dispatcher-runner.js";

async function startOutboxDispatcher(): Promise<void> {
  const shutdownController = new AbortController();
  const stopDispatcher = () => shutdownController.abort();

  process.once("SIGINT", stopDispatcher);
  process.once("SIGTERM", stopDispatcher);

  console.log("Outbox dispatcher is running.");

  try {
    await runOutboxDispatcher({
      dispatchPendingEvents: dispatchPendingOutboxEvents,
      pollIntervalMs: env.outboxPollIntervalMs,
      delay: async (durationMs) => {
        try {
          await delay(durationMs, undefined, {
            signal: shutdownController.signal,
          });
        } catch (error) {
          if (!shutdownController.signal.aborted) {
            throw error;
          }
        }
      },
      shouldContinue: () => !shutdownController.signal.aborted,
      logger: console,
    });
  } finally {
    process.removeListener("SIGINT", stopDispatcher);
    process.removeListener("SIGTERM", stopDispatcher);
  }
}

void startOutboxDispatcher().catch((error) => {
  console.error("Could not start outbox dispatcher.", error);

  process.exitCode = 1;
});
