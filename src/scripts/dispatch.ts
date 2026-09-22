import { dispatchPendingOutboxEvents } from "../outbox/dispatch.js";

try {
  const dispatchedEvents = await dispatchPendingOutboxEvents();

  console.log(`Outbox events dispatched: ${dispatchedEvents}`);
} catch (error) {
  console.error("Could not dispatch outbox events.", error);

  process.exitCode = 1;
}
