import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileNotificationProvider } from "./file";

describe("file notification provider", () => {
  it("writes a stable JSON notification payload to the output directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apsi-notifications-"));

    try {
      const provider = createFileNotificationProvider({ outputDir: directory });
      const result = await provider.send({
        id: "notification_1",
        channel: "email",
        recipient: "buyer@example.com",
        subject: "Subject",
        bodyText: "Body",
        dedupeKey: "alert_1:2026-05-19:email",
        matchedBidIds: ["bid_1"],
      });

      expect(result.ok).toBe(true);
      expect(result.providerMessageId).toBe("file:notification_1.json");

      const payload = JSON.parse(await readFile(path.join(directory, "notification_1.json"), "utf8"));
      expect(payload).toEqual({
        id: "notification_1",
        channel: "email",
        recipient: "buyer@example.com",
        subject: "Subject",
        bodyText: "Body",
        dedupeKey: "alert_1:2026-05-19:email",
        matchedBidIds: ["bid_1"],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
