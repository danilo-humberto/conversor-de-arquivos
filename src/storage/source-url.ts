type PresignedGetObjectClient = {
  presignedGetObject(
    bucketName: string,
    objectName: string,
    expires?: number,
  ): Promise<string>;
};

export async function createInternalSourceUrl(
  client: PresignedGetObjectClient,
  bucketName: string,
  objectKey: string,
  expiresInSeconds: number,
): Promise<string> {
  return client.presignedGetObject(bucketName, objectKey, expiresInSeconds);
}
