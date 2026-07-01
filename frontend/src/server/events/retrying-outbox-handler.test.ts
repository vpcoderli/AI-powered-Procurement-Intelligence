import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetryingEventOutboxHandler } from "./retrying-outbox-handler";
import type { EventOutboxHandler, EventOutboxRow } from "./event-log";

const row: EventOutboxRow = {
  id: "event_outbox_1",
  eventLogId: "event_1",
  destination: "ops-alerts",
  status: "pending",
  attemptCount: 0,
  lastError: null,
  createdAt: "2026-06-01T00:00:00.000Z",
  deliveredAt: null,
};

function immediateSleep() {
  return Promise.resolve();
}

describe("createRetryingEventOutboxHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes through a successful delivery on the first attempt", async () => {
    const inner: EventOutboxHandler = vi.fn().mockResolvedValue({ ok: true });
    const handler = createRetryingEventOutboxHandler(inner, {
      worker: "event-worker",
      sleep: immediateSleep,
    });

    const result = await handler(row);

    expect(result).toEqual({ ok: true });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith(row);
  });

  it("retries a transient failure and returns the eventual success", async () => {
    const inner: EventOutboxHandler = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "ETIMEDOUT" })
      .mockResolvedValueOnce({ ok: true });
    const handler = createRetryingEventOutboxHandler(inner, {
      worker: "event-worker",
      maxAttempts: 3,
      sleep: immediateSleep,
      random: () => 0,
      isRetryable: () => true,
    });

    const result = await handler(row);

    expect(result).toEqual({ ok: true });
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("emits a structured failure alert and returns ok:false once retries are exhausted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const inner: EventOutboxHandler = vi.fn().mockResolvedValue({ ok: false, error: "destination unreachable" });
    const handler = createRetryingEventOutboxHandler(inner, {
      worker: "event-worker",
      maxAttempts: 2,
      sleep: immediateSleep,
      random: () => 0,
      isRetryable: () => true,
    });

    const result = await handler(row);

    expect(result).toEqual({ ok: false, error: "destination unreachable" });
    expect(inner).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);

    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry).toMatchObject({
      worker: "event-worker",
      reason: "event_outbox_delivery_retries_exhausted",
      itemId: "event_outbox_1",
      attempts: 2,
      errorMessage: "destination unreachable",
      eventLogId: "event_1",
      destination: "ops-alerts",
    });
  });

  it("does not retry a non-retryable failure and reports the real attempt count", async () => {
    const inner: EventOutboxHandler = vi.fn().mockResolvedValue({ ok: false, error: "malformed payload" });
    const handler = createRetryingEventOutboxHandler(inner, {
      worker: "event-worker",
      maxAttempts: 4,
      sleep: immediateSleep,
      isRetryable: () => false,
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handler(row);

    expect(result).toEqual({ ok: false, error: "malformed payload" });
    expect(inner).toHaveBeenCalledTimes(1);

    // Regression guard: the alert must report the real number of attempts made (1, since
    // the failure was non-retryable), not the configured maxAttempts (4).
    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry.attempts).toBe(1);
  });
});
