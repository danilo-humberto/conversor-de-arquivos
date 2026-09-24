import { renewConversionJobLease } from "./claim-conversion-job.js";

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
};

export type ConversionJobHeartbeat = {
  assertOwnership(): void;
  stop(): Promise<void>;
};

const defaultDependencies: ConversionJobHeartbeatDependencies = {
  renewLease: renewConversionJobLease,
  setInterval,
  clearInterval,
};

export function startConversionJobHeartbeat(
  jobId: string,
  processingToken: string,
  dependencies: ConversionJobHeartbeatDependencies = defaultDependencies,
): ConversionJobHeartbeat {
  let ownershipLost = false;
  let stopped = false;
  let renewalInFlight: Promise<void> | undefined;

  const renew = (): void => {
    if (stopped || ownershipLost || renewalInFlight) {
      return;
    }

    renewalInFlight = dependencies
      .renewLease(jobId, processingToken)
      .then((renewed) => {
        if (!renewed) {
          ownershipLost = true;
        }
      })
      .catch(() => {
        ownershipLost = true;
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
    assertOwnership(): void {
      if (ownershipLost) {
        throw new ConversionJobLeaseLostError();
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      dependencies.clearInterval(interval);
      await renewalInFlight;
    },
  };
}
