import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationProvider } from "./provider";

describe("notification provider factory", () => {
  const originalProvider = process.env.NOTIFICATION_PROVIDER;
  const originalOutboxDir = process.env.NOTIFICATION_OUTBOX_DIR;

  afterEach(() => {
    process.env.NOTIFICATION_PROVIDER = originalProvider;
    process.env.NOTIFICATION_OUTBOX_DIR = originalOutboxDir;
    vi.restoreAllMocks();
  });

  it("uses a file provider by default with an overridable output directory", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "apsi-provider-"));

    try {
      delete process.env.NOTIFICATION_PROVIDER;
      process.env.NOTIFICATION_OUTBOX_DIR = directory;

      const provider = createNotificationProvider();
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
      expect(await readFile(path.join(directory, "notification_1.json"), "utf8")).toContain(
        "buyer@example.com",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("uses the console provider when requested", async () => {
    process.env.NOTIFICATION_PROVIDER = "console";
    delete process.env.NOTIFICATION_OUTBOX_DIR;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);

    const provider = createNotificationProvider();
    const result = await provider.send({
      id: "notification_1",
      channel: "email",
      recipient: "buyer@example.com",
      subject: "Subject",
      bodyText: "Body",
      dedupeKey: "alert_1:2026-05-19:email",
      matchedBidIds: ["bid_1"],
    });

    expect(result).toEqual({ ok: true, providerMessageId: "console:notification_1" });
    expect(consoleInfo).toHaveBeenCalledWith(
      "[notification]",
      expect.objectContaining({ id: "notification_1", recipient: "buyer@example.com" }),
    );
  });
});
