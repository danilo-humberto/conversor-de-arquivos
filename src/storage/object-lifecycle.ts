export type ObjectStorageClient = {
  statObject(bucketName: string, objectKey: string): Promise<unknown>;
  bucketExists(bucketName: string): Promise<boolean>;
  removeObject(bucketName: string, objectKey: string): Promise<void>;
};

export class ObjectRemovalError extends Error {
  constructor(bucketName: string, objectKey: string, cause: unknown) {
    super(`Could not remove source object ${bucketName}/${objectKey}.`, { cause });
    this.name = "ObjectRemovalError";
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  return typeof error.code === "string" ? error.code : undefined;
}

async function objectIsMissing(
  client: ObjectStorageClient,
  bucketName: string,
  error: unknown,
): Promise<boolean> {
  const code = errorCode(error);

  if (code === "NoSuchKey") {
    return true;
  }

  // MinIO can return a bare NotFound for HEAD; confirm that the bucket exists.
  return code === "NotFound" && await client.bucketExists(bucketName);
}

export async function objectExists(
  client: ObjectStorageClient,
  bucketName: string,
  objectKey: string,
): Promise<boolean> {
  try {
    await client.statObject(bucketName, objectKey);
    return true;
  } catch (error) {
    if (await objectIsMissing(client, bucketName, error)) {
      return false;
    }

    throw error;
  }
}

export async function removeObjectIfExists(
  client: ObjectStorageClient,
  bucketName: string,
  objectKey: string,
): Promise<void> {
  try {
    // S3 DELETE is idempotent, including when the object is already absent.
    await client.removeObject(bucketName, objectKey);
  } catch (error) {
    if (await objectIsMissing(client, bucketName, error)) {
      return;
    }

    throw new ObjectRemovalError(bucketName, objectKey, error);
  }
}
