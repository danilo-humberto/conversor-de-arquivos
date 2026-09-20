import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { database } from "./connection.js";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFilePath);
const migrationsDirectory = join(currentDirectory, "./migrations");

async function createMigrationsTable(): Promise<void> {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await database.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations",
  );

  return new Set(result.rows.map((row) => row.filename));
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(migrationsDirectory);

  return files.filter((file) => file.endsWith(".sql")).sort();
}

async function applyMigration(filename: string): Promise<void> {
  const migrationPath = join(migrationsDirectory, filename);
  const sql = await readFile(migrationPath, "utf8");
  const client = await database.connect();

  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    await client.query(sql);

    await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
      filename,
    ]);

    await client.query("COMMIT");

    console.log(`Migration aplicada: ${filename}`);
  } catch (error) {
    if (transactionStarted) {
      await client.query("ROLLBACK");
    }

    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  try {
    await createMigrationsTable();

    const appliedMigrations = await getAppliedMigrations();
    const migrationFiles = await getMigrationFiles();

    const pendingMigrations = migrationFiles.filter(
      (filename) => !appliedMigrations.has(filename),
    );

    if (pendingMigrations.length === 0) {
      console.log("Nenhuma migration pendente.");
      return;
    }

    for (const filename of pendingMigrations) {
      await applyMigration(filename);
    }
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error("Falha ao executar migrations.");
  console.error(error);

  process.exitCode = 1;
});
