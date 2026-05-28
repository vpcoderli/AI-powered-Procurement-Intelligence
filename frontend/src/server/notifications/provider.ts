import type { NotificationProvider } from "./types";
import { createConsoleNotificationProvider } from "./providers/console";
import { createFileNotificationProvider } from "./providers/file";
import { createHttpNotificationProvider } from "./providers/http";

export function createNotificationProvider(): NotificationProvider {
  if (process.env.NOTIFICATION_PROVIDER === "http") {
    return createHttpNotificationProvider({
      endpoint: process.env.NOTIFICATION_HTTP_ENDPOINT,
      token: process.env.NOTIFICATION_HTTP_TOKEN,
    });
  }

  if (process.env.NOTIFICATION_PROVIDER === "console") {
    return createConsoleNotificationProvider();
  }

  return createFileNotificationProvider({
    outputDir: process.env.NOTIFICATION_OUTBOX_DIR,
  });
}
