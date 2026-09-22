import type { NextFunction, Request, Response } from "express";
import multer from "multer";

import { JobValidationError } from "../jobs/create-jobs.js";

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
): void {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({
      message: "File too large.",
    });

    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(400).json({
      message: error.message,
    });

    return;
  }

  if (error instanceof JobValidationError) {
    response.status(400).json({
      message: error.message,
    });

    return;
  }

  console.error("No handler for error:", error);

  response.status(500).json({
    message: "Internal server error.",
  });
}
