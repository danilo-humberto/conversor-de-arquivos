import { Router } from "express";

import { createJob, JobValidationError } from "../../jobs/create-jobs.js";
import { upload } from "../upload.js";
import { getJobStatus } from "../../jobs/get-job-status.js";

export const jobsRouter = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

jobsRouter.post("/", upload.single("file"), async (request, response, next) => {
  try {
    if (!request.file) {
      throw new JobValidationError("file is required.");
    }

    const job = await createJob({
      file: request.file,
      targetFormat: request.body.targetFormat,
      notifyEmail: request.body.notifyEmail,
    });

    response.status(202).json(job);
  } catch (error) {
    next(error);
  }
});

jobsRouter.get("/:jobId", async (request, response, next) => {
  if (!isUuid(request.params.jobId)) {
    response.status(400).json({
      error: "Invalid job ID.",
    });

    return;
  }
  try {
    const job = await getJobStatus(request.params.jobId);

    if (job === null) {
      response.status(404).json({
        error: "Job not found.",
      });

      return;
    }

    response.status(200).json(job);
  } catch (error) {
    next(error);
  }
});
