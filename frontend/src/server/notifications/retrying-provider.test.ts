import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryingNotificationProvider } from "./retrying-provider";
import type { NotificationProvider, NotificationSendPayload } from "./types";

const payload: NotificationSendPayload = {
  id: "notification_1",
  channel: "email",
  recipient: "buyer@example.com",
  subject: "Subject",
  bodyText: "Body",
  dedupeKey: "alert_1:2026-05-19:email",
  matchedBidIds: ["bid_1"],
};

function immediateSleep() {
  return Promise.resolve();
}

describe("createRetryingNotificationProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through a successful send on the first attempt", async () => {
    const inner: NotificationProvider = { send: vi.fn().mockResolvedValue({ ok: true, providerMessageId: "mail_1" }) };
    const provider = createRetryingNotificationProvider(inner, {
      worker: "notification-worker",
      sleep: immediateSleep,
    });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: true, providerMessageId: "mail_1" });
    expect(inner.send).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and returns the eventual success", async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "ECONNRESET" })
      .mockResolvedValueOnce({ ok: true, providerMessageId: "mail_2" });
    const inner: NotificationProvider = { send };
    const provider = createRetryingNotificationProvider(inner, {
      worker: "notification-worker",
      maxAttempts: 3,
      sleep: immediateSleep,
      random: () => 0,
      isRetryable: () => true,
    });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: true, providerMessageId: "mail_2" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("emits a structured failure alert and returns ok:false once retries are exhausted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const inner: NotificationProvider = { send: vi.fn().mockResolvedValue({ ok: false, error: "still down" }) };
    const provider = createRetryingNotificationProvider(inner, {
      worker: "notification-worker",
      maxAttempts: 2,
      sleep: immediateSleep,
      random: () => 0,
      isRetryable: () => true,
    });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: false, error: "still down" });
    expect(inner.send).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);

    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      worker: "notification-worker",
      reason: "notification_send_retries_exhausted",
      itemId: "notification_1",
      attempts: 2,
      errorMessage: "still down",
      recipient: "buyer@example.com",
      dedupeKey: "alert_1:2026-05-19:email",
    });
  });

  it("does not retry a non-retryable failure and still emits an alert with the real attempt count", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const inner: NotificationProvider = { send: vi.fn().mockResolvedValue({ ok: false, error: "invalid recipient" }) };
    const provider = createRetryingNotificationProvider(inner, {
      worker: "notification-worker",
      maxAttempts: 3,
      sleep: immediateSleep,
      isRetryable: () => false,
    });

    const result = await provider.send(payload);

    expect(result).toEqual({ ok: false, error: "invalid recipient" });
    expect(inner.send).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledTimes(1);

    // Regression guard: the alert must report the real number of attempts made (1, since
    // the failure was non-retryable), not the configured maxAttempts (3).
    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry.attempts).toBe(1);
  });
});
