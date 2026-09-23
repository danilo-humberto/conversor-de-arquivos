import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "../config/env.js";
import { jobsRouter } from "./routes/jobs.js";
import { errorHandler } from "./error-handler.js";

const app = express();

const port = env.port;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = join(currentDirectory, "public");

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(express.static(publicDirectory));

app.use("/jobs", jobsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Not Found" });
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
