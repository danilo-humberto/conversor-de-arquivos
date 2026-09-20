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

export const env = {
  port: readPort("PORT", 3000),
  postgres: {
    host: readRequiredEnv("POSTGRES_HOST"),
    port: readPort("POSTGRES_PORT", 5432),
    user: readRequiredEnv("POSTGRES_USER"),
    password: readRequiredEnv("POSTGRES_PASSWORD"),
    database: readRequiredEnv("POSTGRES_DB"),
  },
};
