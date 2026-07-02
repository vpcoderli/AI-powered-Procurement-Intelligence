import { afterEach, describe, expect, it, vi } from "vitest";
import { emitWorkerFailureAlert } from "./failure-alerts";

describe("emitWorkerFailureAlert", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a structured JSON alert with worker/reason/itemId/attempts/error", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitWorkerFailureAlert({
      worker: "notification-worker",
      reason: "notification_send_retries_exhausted",
      itemId: "notification_1",
      attempts: 3,
      error: new Error("provider unavailable"),
      context: { recipient: "buyer@example.com" },
    });

    expect(consoleError).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);

    expect(entry).toMatchObject({
      level: "error",
      alert: true,
      worker: "notification-worker",
      reason: "notification_send_retries_exhausted",
      itemId: "notification_1",
      attempts: 3,
      errorMessage: "provider unavailable",
      errorName: "Error",
      recipient: "buyer@example.com",
    });
    expect(typeof entry.timestamp).toBe("string");
    expect(new Date(entry.timestamp).toString()).not.toBe("Invalid Date");
    expect(typeof entry.errorStack).toBe("string");
  });

  it("handles non-Error error values", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitWorkerFailureAlert({
      worker: "event-worker",
      reason: "event_outbox_delivery_retries_exhausted",
      itemId: "event_outbox_1",
      attempts: 5,
      error: "plain string failure",
    });

    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry.errorMessage).toBe("plain string failure");
    expect(entry.errorName).toBeUndefined();
  });

  it("defaults itemId to null when not provided", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    emitWorkerFailureAlert({
      worker: "crawler-worker",
      reason: "crawler_source_retries_exhausted",
      attempts: 1,
      error: new Error("boom"),
    });

    const entry = JSON.parse(consoleError.mock.calls[0][0] as string);
    expect(entry.itemId).toBeNull();
  });

  it("never throws even if console.error throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("stdout closed");
    });

    expect(() =>
      emitWorkerFailureAlert({
        worker: "notification-worker",
        reason: "notification_send_retries_exhausted",
        attempts: 3,
        error: new Error("boom"),
      }),
    ).not.toThrow();
  });
});
