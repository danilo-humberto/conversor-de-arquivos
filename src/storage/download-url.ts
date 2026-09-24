import { minioPublicClient } from "./minio.js";

const DOWNLOAD_URL_EXPIRY_SECONDS = 24 * 60 * 60;

export async function createDownloadUrl(
  bucketName: string,
  objectKey: string,
): Promise<string> {
  return minioPublicClient.presignedGetObject(
    bucketName,
    objectKey,
    DOWNLOAD_URL_EXPIRY_SECONDS,
  );
}
