import { describe, expect, it, vi } from "vitest";
import { runNotificationWorkerOnce } from "./worker";

describe("notification worker orchestration", () => {
  it("schedules billing dunning reminders before delivering pending notifications", async () => {
    const calls: string[] = [];
    const scheduler = vi.fn(() => {
      calls.push("dunning");
      return {
        checkedInvoices: 2,
        queued: 1,
        skippedAlreadyQueued: 0,
        skippedNotDue: 1,
        skippedResolved: 0,
        skippedNoRecipient: 0,
      };
    });
    const deliverer = vi.fn(async () => {
      calls.push("delivery");
      return { attempted: 1, sent: 1, failed: 0, skipped: 0 };
    });

    const result = await runNotificationWorkerOnce({} as never, {
      now: "2026-05-28T00:00:00.000Z",
      dunningLimit: 50,
      deliveryLimit: 25,
      maxAttempts: 4,
      scheduler,
      deliverer,
    });

    expect(calls).toEqual(["dunning", "delivery"]);
    expect(scheduler).toHaveBeenCalledWith({}, {
      now: "2026-05-28T00:00:00.000Z",
      limit: 50,
    });
    expect(deliverer).toHaveBeenCalledWith({}, undefined, {
      now: "2026-05-28T00:00:00.000Z",
      limit: 25,
      maxAttempts: 4,
    });
    expect(result).toEqual({
      dunning: {
        checkedInvoices: 2,
        queued: 1,
        skippedAlreadyQueued: 0,
        skippedNotDue: 1,
        skippedResolved: 0,
        skippedNoRecipient: 0,
      },
      delivery: { attempted: 1, sent: 1, failed: 0, skipped: 0 },
    });
  });
});
