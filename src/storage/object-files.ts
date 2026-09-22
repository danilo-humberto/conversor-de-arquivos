import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";

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

export async function uploadFileAsObject(
  bucketName: string,
  objectKey: string,
  filePath: string,
): Promise<void> {
  await minioClient.fPutObject(bucketName, objectKey, filePath);
}
