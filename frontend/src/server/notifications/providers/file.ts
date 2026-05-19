import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NotificationProvider, NotificationSendPayload } from "../types";

export interface FileNotificationProviderOptions {
  outputDir?: string;
}

function defaultOutputDir() {
  return path.join(process.cwd(), "data", "notification-outbox");
}

function stablePayload(payload: NotificationSendPayload) {
  return {
    id: payload.id,
    channel: payload.channel,
    recipient: payload.recipient,
    subject: payload.subject,
    bodyText: payload.bodyText,
    dedupeKey: payload.dedupeKey,
    matchedBidIds: payload.matchedBidIds,
  };
}

export function createFileNotificationProvider(
  options: FileNotificationProviderOptions = {},
): NotificationProvider {
  const outputDir = options.outputDir ?? process.env.NOTIFICATION_OUTBOX_DIR ?? defaultOutputDir();

  return {
    async send(payload) {
      await mkdir(outputDir, { recursive: true });
      const filename = `${payload.id}.json`;
      await writeFile(
        path.join(outputDir, filename),
        `${JSON.stringify(stablePayload(payload), null, 2)}\n`,
        "utf8",
      );

      return { ok: true, providerMessageId: `file:${filename}` };
    },
  };
}
