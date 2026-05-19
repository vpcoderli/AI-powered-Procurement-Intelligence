import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDatabase, type AppDatabase } from "./client";
import { runMigrations } from "./migrate";
import { seedDatabase } from "./seed";

export interface TestDatabase {
  db: AppDatabase;
  databasePath: string;
  cleanup: () => Promise<void>;
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "apsi-db-"));
  const databasePath = path.join(directory, "apsi.sqlite");
  const db = createDatabase(databasePath);
  runMigrations(db);

  if (options.seed) {
    await seedDatabase(db);
  }

  return {
    db,
    databasePath,
    cleanup: async () => {
      db.$client.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
