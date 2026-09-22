import {
  convertedBucket,
  ensureStorageBuckets,
  uploadsBucket,
} from "../storage/minio.js";

async function main(): Promise<void> {
  await ensureStorageBuckets();

  console.log(`Bucket confirmado: ${uploadsBucket}`);
  console.log(`Bucket confirmado: ${convertedBucket}`);
}

main().catch((error: unknown) => {
  console.error("Não foi possível conectar ao MinIO.");
  console.error(error);

  process.exitCode = 1;
});
