import { Router } from "express";

import { createJob, JobValidationError } from "../../jobs/create-jobs.js";
import { upload } from "../upload.js";

export const jobsRouter = Router();

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
