import type { NotificationProvider } from "./types";
import { createConsoleNotificationProvider } from "./providers/console";
import { createFileNotificationProvider } from "./providers/file";

export function createNotificationProvider(): NotificationProvider {
  if (process.env.NOTIFICATION_PROVIDER === "console") {
    return createConsoleNotificationProvider();
  }

  return createFileNotificationProvider({
    outputDir: process.env.NOTIFICATION_OUTBOX_DIR,
  });
}
