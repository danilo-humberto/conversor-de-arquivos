import assert from "node:assert/strict";
import test from "node:test";

import {
  conversionQueue,
  notificationQueue,
} from "../broker/queues.js";
import { getOutboxDestinationQueue } from "./event-routing.js";

test("roteia os eventos dos contratos para as filas corretas", () => {
  assert.equal(getOutboxDestinationQueue("conversion.requested"), conversionQueue);
  assert.equal(getOutboxDestinationQueue("conversion.finished"), notificationQueue);
});

test("rejeita eventos de outbox sem contrato de roteamento", () => {
  assert.throws(() => getOutboxDestinationQueue("conversion.completed"));
});
