import { createDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { runNotificationWorkerOnce } from "../src/server/notifications/worker";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

function positiveIntegerEnv(name: string) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function intervalMs() {
  const value = positiveIntegerEnv("NOTIFICATION_WORKER_INTERVAL_MS");
  return value ?? DEFAULT_INTERVAL_MS;
}

function runOnce() {
  return process.env.NOTIFICATION_WORKER_RUN_ONCE === "1" ||
    process.env.NOTIFICATION_WORKER_RUN_ONCE === "true";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLoop() {
  const db = createDatabase();
  runMigrations(db);

  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    do {
      const result = await runNotificationWorkerOnce(db, {
        dunningLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DUNNING_LIMIT"),
        deliveryLimit: positiveIntegerEnv("NOTIFICATION_WORKER_DELIVERY_LIMIT"),
        maxAttempts: positiveIntegerEnv("NOTIFICATION_WORKER_MAX_ATTEMPTS"),
      });
      console.log(JSON.stringify(result, null, 2));

      if (runOnce()) {
        break;
      }

      if (!stopping) {
        await sleep(intervalMs());
      }
    } while (!stopping);
  } finally {
    db.$client.close();
  }
}

void runLoop().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
