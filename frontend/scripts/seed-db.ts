import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { seedDatabase } from "../src/server/db/seed";

async function main() {
  const db = createDatabase();
  runMigrations(db);
  await seedDatabase(db);
  db.$client.close();
  console.log("Database seeded");
}

void main();
