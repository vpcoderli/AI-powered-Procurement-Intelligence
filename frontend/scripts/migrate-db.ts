import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";

const db = createDatabase();
runMigrations(db);
db.$client.close();
console.log("Database migrated");
