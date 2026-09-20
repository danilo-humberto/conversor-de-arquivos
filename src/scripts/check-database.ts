import { database } from "../db/connection.js";

async function main(): Promise<void> {
  try {
    await database.query("SELECT 1");
    console.log("Database connection successful.");
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error("Database connection failed:", error);
  process.exit(1);
});
