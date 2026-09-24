import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

import { minioClient } from "./minio.js";

export async function downloadObjectToFile(
  bucketName: string,
  objectKey: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), {
    recursive: true,
  });

  const objectStream = await minioClient.getObject(bucketName, objectKey);

  await pipeline(objectStream, createWriteStream(destinationPath));
}

export async function downloadUrlToFile(
  sourceUrl: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(dirname(destinationPath), {
    recursive: true,
  });

  const response = await fetch(sourceUrl);

  if (!response.ok || response.body === null) {
    throw new Error(
      `Could not download source file: HTTP ${response.status}.`,
    );
  }

  await pipeline(
    Readable.fromWeb(response.body as never),
    createWriteStream(destinationPath),
  );
}

export async function uploadFileAsObject(
  bucketName: string,
  objectKey: string,
  filePath: string,
): Promise<void> {
  await minioClient.fPutObject(bucketName, objectKey, filePath);
}
