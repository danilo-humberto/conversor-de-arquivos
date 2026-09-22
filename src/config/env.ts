import "dotenv/config";

function readRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readPort(name: string, defaultValue: number): number {
  const value = process.env[name] || defaultValue.toString();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port number: ${value}`);
  }
  return port;
}

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  if (value.toLowerCase() === "true") {
    return true;
  }

  if (value.toLowerCase() === "false") {
    return false;
  }

  throw new Error(`Invalid boolean value for environment variable: ${name}`);
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const value = process.env[name] ?? String(defaultValue);
  const numberValue = Number(value);

  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`${name} deve ser um número inteiro positivo.`);
  }

  return numberValue;
}

export const env = {
  port: readPort("PORT", 3000),
  postgres: {
    host: readRequiredEnv("POSTGRES_HOST"),
    port: readPort("POSTGRES_PORT", 5432),
    user: readRequiredEnv("POSTGRES_USER"),
    password: readRequiredEnv("POSTGRES_PASSWORD"),
    database: readRequiredEnv("POSTGRES_DB"),
  },
  rabbitmq: {
    host: readRequiredEnv("RABBITMQ_HOST"),
    port: readPort("RABBITMQ_PORT", 5672),
    user: readRequiredEnv("RABBITMQ_DEFAULT_USER"),
    password: readRequiredEnv("RABBITMQ_DEFAULT_PASS"),
    vhost: readRequiredEnv("RABBITMQ_VHOST"),
  },
  minio: {
    endpoint: readRequiredEnv("MINIO_ENDPOINT"),
    port: readPort("MINIO_PORT", 9000),
    useSSL: readBoolean("MINIO_USE_SSL", false),
    rootUser: readRequiredEnv("MINIO_ROOT_USER"),
    rootPassword: readRequiredEnv("MINIO_ROOT_PASSWORD"),
  },
  maxUploadSizeBytes: readPositiveInteger("MAX_UPLOAD_SIZE_BYTES", 104857600), // 100 MB
};
