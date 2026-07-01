import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NotificationProviderConfigError,
  createNotificationProvider,
  resolveNotificationProviderConfig,
} from "./provider";

describe("notification provider factory", () => {
  const originalProvider = process.env.NOTIFICATION_PROVIDER;
  const originalOutboxDir = process.env.NOTIFICATION_OUTBOX_DIR;
  const originalHttpEndpoint = process.env.NOTIFICATION_HTTP_ENDPOINT;
  const originalHttpToken = process.env.NOTIFICATION_HTTP_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;
  const fetchMock = vi.fn<typeof fetch>();

  function restoreEnv(key: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  afterEach(() => {
    restoreEnv("NOTIFICATION_PROVIDER", originalProvider);
    restoreEnv("NOTIFICATION_OUTBOX_DIR", originalOutboxDir);
    restoreEnv("NOTIFICATION_HTTP_ENDPOINT", originalHttpEndpoint);
    restoreEnv("NOTIFICATION_HTTP_TOKEN", originalHttpToken);
    restoreEnv("NODE_ENV", originalNodeEnv);
    vi.unstubAllGlobals();
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

  it("uses the http provider when requested", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ providerMessageId: "mail_1" }), {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }));
    process.env.NOTIFICATION_PROVIDER = "http";
    process.env.NOTIFICATION_HTTP_ENDPOINT = "https://mail.example.test/send";
    process.env.NOTIFICATION_HTTP_TOKEN = "secret-token";

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

    expect(result).toEqual({ ok: true, providerMessageId: "mail_1" });
    expect(fetchMock).toHaveBeenCalledWith("https://mail.example.test/send", expect.objectContaining({
      method: "POST",
    }));
  });

  it("rejects unknown provider names instead of silently falling back", () => {
    process.env.NOTIFICATION_PROVIDER = "smtp";

    expect(() => createNotificationProvider()).toThrow(NotificationProviderConfigError);
  });

  it("validates http provider endpoint configuration before sending", () => {
    process.env.NOTIFICATION_PROVIDER = "http";
    delete process.env.NOTIFICATION_HTTP_ENDPOINT;

    expect(() => createNotificationProvider()).toThrow("NOTIFICATION_HTTP_ENDPOINT is required");

    process.env.NOTIFICATION_HTTP_ENDPOINT = "mailto:ops@example.com";

    expect(() => createNotificationProvider()).toThrow("NOTIFICATION_HTTP_ENDPOINT must be an http(s) URL");
  });

  it("reports production fallback providers as explicit warnings", () => {
    delete process.env.NOTIFICATION_PROVIDER;
    process.env.NODE_ENV = "production";

    expect(resolveNotificationProviderConfig()).toEqual({
      provider: "file",
      outputDir: undefined,
      warnings: [
        "NODE_ENV=production is using the file notification provider fallback; set NOTIFICATION_PROVIDER=ses, sendgrid, or http for live email delivery.",
      ],
    });
  });

  it("constructs an SES provider when requested", async () => {
    process.env.NOTIFICATION_PROVIDER = "ses";
    process.env.NOTIFICATION_SES_REGION = "us-east-1";
    process.env.NOTIFICATION_SES_FROM_ADDRESS = "alerts@apsi.example.com";

    try {
      const provider = createNotificationProvider();
      expect(provider).toHaveProperty("send");
    } finally {
      delete process.env.NOTIFICATION_SES_REGION;
      delete process.env.NOTIFICATION_SES_FROM_ADDRESS;
    }
  });

  it("constructs a SendGrid provider when requested", async () => {
    process.env.NOTIFICATION_PROVIDER = "sendgrid";
    process.env.NOTIFICATION_SENDGRID_API_KEY = "SG.test-api-key";
    process.env.NOTIFICATION_SENDGRID_FROM_ADDRESS = "alerts@apsi.example.com";

    try {
      const provider = createNotificationProvider();
      expect(provider).toHaveProperty("send");
    } finally {
      delete process.env.NOTIFICATION_SENDGRID_API_KEY;
      delete process.env.NOTIFICATION_SENDGRID_FROM_ADDRESS;
    }
  });

  it("does not warn in production when ses or sendgrid is the configured provider", () => {
    process.env.NODE_ENV = "production";
    process.env.NOTIFICATION_PROVIDER = "ses";

    expect(resolveNotificationProviderConfig().warnings).toEqual([]);

    process.env.NOTIFICATION_PROVIDER = "sendgrid";

    expect(resolveNotificationProviderConfig().warnings).toEqual([]);
  });
});
