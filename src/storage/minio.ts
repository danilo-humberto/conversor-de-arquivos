import * as Minio from "minio";

import { env } from "../config/env.js";

export const uploadsBucket = "uploads";
export const convertedBucket = "converted";

export const minioClient = new Minio.Client({
  endPoint: env.minio.endpoint,
  port: env.minio.port,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.rootUser,
  secretKey: env.minio.rootPassword,
  pathStyle: true,
});

export const minioPublicClient = new Minio.Client({
  endPoint: env.minio.publicEndpoint,
  port: env.minio.publicPort,
  useSSL: env.minio.publicUseSSL,
  accessKey: env.minio.rootUser,
  secretKey: env.minio.rootPassword,
  pathStyle: true,
  region: "us-east-1",
});

async function ensureBucketExists(bucketName: string): Promise<void> {
  const exists = await minioClient.bucketExists(bucketName);

  if (exists) {
    return;
  }

  try {
    await minioClient.makeBucket(bucketName, "us-east-1");
  } catch (error) {
    const bucketWasCreatedInParallel =
      await minioClient.bucketExists(bucketName);

    if (!bucketWasCreatedInParallel) {
      throw error;
    }
  }
}

export async function ensureStorageBuckets(): Promise<void> {
  await ensureBucketExists(uploadsBucket);
  await ensureBucketExists(convertedBucket);
}
