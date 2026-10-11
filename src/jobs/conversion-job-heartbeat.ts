import {
  CONVERSION_JOB_LEASE_DURATION_MS,
  renewConversionJobLease,
} from "./claim-conversion-job.js";

export const CONVERSION_JOB_HEARTBEAT_INTERVAL_MS = 30 * 1000;

export class ConversionJobLeaseLostError extends Error {
  constructor() {
    super("Conversion job processing lease was lost.");

    this.name = "ConversionJobLeaseLostError";
  }
}

type IntervalHandle = ReturnType<typeof setInterval>;

type ConversionJobHeartbeatDependencies = {
  renewLease(jobId: string, processingToken: string): Promise<boolean>;
  setInterval(callback: () => void, delayMs: number): IntervalHandle;
  clearInterval(interval: IntervalHandle): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void;
};

export type ConversionJobHeartbeat = {
  signal: AbortSignal;
  assertOwnership(): void;
  stop(): Promise<void>;
};

const defaultDependencies: ConversionJobHeartbeatDependencies = {
  renewLease: renewConversionJobLease,
  setInterval,
  clearInterval,
  now: () => performance.now(),
  setTimeout,
  clearTimeout,
};

export function startConversionJobHeartbeat(
  jobId: string,
  processingToken: string,
  overrides: Partial<ConversionJobHeartbeatDependencies> = {},
): ConversionJobHeartbeat {
  const dependencies = { ...defaultDependencies, ...overrides };
  const controller = new AbortController();
  let stopped = false;
  let renewalInFlight: Promise<void> | undefined;
  let leaseDeadline = dependencies.now() + CONVERSION_JOB_LEASE_DURATION_MS;
  let expiryTimer: ReturnType<typeof setTimeout>;

  const loseOwnership = (): void => {
    controller.abort(new ConversionJobLeaseLostError());
  };

  const scheduleExpiry = (): void => {
    expiryTimer = dependencies.setTimeout(
      loseOwnership,
      Math.max(0, leaseDeadline - dependencies.now()),
    );
  };

  scheduleExpiry();

  const renew = (): void => {
    if (stopped || controller.signal.aborted || renewalInFlight) {
      return;
    }

    if (dependencies.now() >= leaseDeadline) {
      loseOwnership();
      return;
    }

    const renewalStartedAt = dependencies.now();

    renewalInFlight = dependencies
      .renewLease(jobId, processingToken)
      .then((renewed) => {
        if (!renewed || dependencies.now() >= leaseDeadline) {
          loseOwnership();
        } else if (!controller.signal.aborted) {
          leaseDeadline = renewalStartedAt + CONVERSION_JOB_LEASE_DURATION_MS;
          dependencies.clearTimeout(expiryTimer);
          scheduleExpiry();
        }
      })
      .catch(() => {
        loseOwnership();
      })
      .finally(() => {
        renewalInFlight = undefined;
      });
  };

  const interval = dependencies.setInterval(
    renew,
    CONVERSION_JOB_HEARTBEAT_INTERVAL_MS,
  );

  return {
    signal: controller.signal,
    assertOwnership(): void {
      if (dependencies.now() >= leaseDeadline) {
        loseOwnership();
      }
      controller.signal.throwIfAborted();
    },
    async stop(): Promise<void> {
      stopped = true;
      dependencies.clearInterval(interval);
      let onAbort: (() => void) | undefined;
      try {
        if (!controller.signal.aborted && renewalInFlight) {
          await Promise.race([
            renewalInFlight,
            new Promise<void>((resolve) => {
              onAbort = resolve;
              controller.signal.addEventListener("abort", onAbort, { once: true });
            }),
          ]);
        }
      } finally {
        if (onAbort) controller.signal.removeEventListener("abort", onAbort);
        dependencies.clearTimeout(expiryTimer);
      }
    },
  };
}
