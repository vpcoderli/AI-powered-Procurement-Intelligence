import { describe, expect, it, vi } from "vitest";
import {
  SendgridNotificationProviderConfigError,
  createSendgridNotificationProvider,
} from "./sendgrid";

const baseEnv = {
  NOTIFICATION_SENDGRID_API_KEY: "SG.test-api-key",
  NOTIFICATION_SENDGRID_FROM_ADDRESS: "alerts@apsi.example.com",
};

const payload = {
  id: "notification_1",
  channel: "email" as const,
  recipient: "buyer@example.com",
  subject: "APSi daily bid matches",
  bodyText: "1 matching bid",
  dedupeKey: "alert_1:2026-05-19:email",
  matchedBidIds: ["bid_1"],
};

function fakeSendgridClient(handler: (data: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    setApiKey: vi.fn(),
    send: vi.fn(async (data: Record<string, unknown>) => {
      calls.push(data);
      return [handler(data), undefined] as [{ headers?: Record<string, string> }, unknown];
    }),
  };
  return { client, calls };
}

describe("SendGrid notification provider (@sendgrid/mail)", () => {
  it("requires NOTIFICATION_SENDGRID_API_KEY to construct the provider", () => {
    expect(() =>
      createSendgridNotificationProvider({ env: { ...baseEnv, NOTIFICATION_SENDGRID_API_KEY: "" } }),
    ).toThrow(SendgridNotificationProviderConfigError);
  });

  it("requires NOTIFICATION_SENDGRID_FROM_ADDRESS to construct the provider", () => {
    expect(() =>
      createSendgridNotificationProvider({ env: { ...baseEnv, NOTIFICATION_SENDGRID_FROM_ADDRESS: "" } }),
    ).toThrow(SendgridNotificationProviderConfigError);
  });

  it("sends an email and tags it with the notification id for webhook correlation", async () => {
    const { client, calls } = fakeSendgridClient(() => ({ headers: { "x-message-id": "sg-message-id-1" } }));
    const provider = createSendgridNotificationProvider({ env: baseEnv, client });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: true, providerMessageId: "sg-message-id-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: "buyer@example.com",
      from: "alerts@apsi.example.com",
      subject: "APSi daily bid matches",
      text: "1 matching bid",
      customArgs: { apsi_notification_id: "notification_1" },
    });
  });

  it("returns a structured failure instead of throwing when send rejects", async () => {
    const client = {
      setApiKey: vi.fn(),
      send: vi.fn(async () => {
        throw new Error("403 Forbidden: sender identity not verified");
      }),
    };
    const provider = createSendgridNotificationProvider({ env: baseEnv, client });

    const result = await provider.send(payload);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("sender identity not verified");
  });
});
