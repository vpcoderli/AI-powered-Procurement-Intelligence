import { describe, expect, it, vi } from "vitest";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import {
  DEFAULT_PLATFORM_MIN_INTERVAL_MS,
  PlatformDeferralTracker,
  isPlatformThrottleSignature,
  platformDeferredResult,
  platformMinIntervalMs,
} from "./platform-deferral";

function failure(errorCode: string | null, errorMessage = ""): RunCrawlerSourceOnceResult {
  return {
    ok: false,
    source: "bidnet_co_denver",
    status: "failure",
    runner: {
      ok: false,
      source: "bidnet_co_denver",
      status: "failure",
      stdout: "",
      stderr: errorMessage,
      errorCode,
    },
  };
}

const success: RunCrawlerSourceOnceResult = {
  ok: true,
  source: "bidnet_co_denver",
  status: "success",
  runner: { ok: true, source: "bidnet_co_denver", status: "success", stdout: "", stderr: "" },
  alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] },
  notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
};

describe("platformMinIntervalMs", () => {
  it("defaults to 5s and ignores unusable values", () => {
    expect(platformMinIntervalMs({})).toBe(DEFAULT_PLATFORM_MIN_INTERVAL_MS);
    expect(platformMinIntervalMs({ CRAWLER_PLATFORM_MIN_INTERVAL_MS: "" })).toBe(DEFAULT_PLATFORM_MIN_INTERVAL_MS);
    expect(platformMinIntervalMs({ CRAWLER_PLATFORM_MIN_INTERVAL_MS: "abc" })).toBe(DEFAULT_PLATFORM_MIN_INTERVAL_MS);
    expect(platformMinIntervalMs({ CRAWLER_PLATFORM_MIN_INTERVAL_MS: "-1" })).toBe(DEFAULT_PLATFORM_MIN_INTERVAL_MS);
    expect(platformMinIntervalMs({ CRAWLER_PLATFORM_MIN_INTERVAL_MS: "250" })).toBe(250);
    expect(platformMinIntervalMs({ CRAWLER_PLATFORM_MIN_INTERVAL_MS: "0" })).toBe(0);
  });
});

describe("isPlatformThrottleSignature", () => {
  it("recognises platform challenge errors", () => {
    expect(isPlatformThrottleSignature(failure("BidNetChallengeError", "challenge page"))).toBe(true);
    expect(isPlatformThrottleSignature(failure("SomeOtherChallengeError"))).toBe(true);
  });

  it("recognises throttling HTTP statuses reported through HtmlPageError", () => {
    expect(isPlatformThrottleSignature(failure("HtmlPageError", "unexpected status 403 for https://x"))).toBe(true);
    expect(isPlatformThrottleSignature(failure("HtmlPageError", "HTTP 429 Too Many Requests"))).toBe(true);
    expect(isPlatformThrottleSignature(failure("HtmlPageError", "status_code=202"))).toBe(true);
  });

  it("leaves ordinary failures and successes alone", () => {
    expect(isPlatformThrottleSignature(failure("HtmlPageError", "unexpected status 404 for https://x"))).toBe(false);
    expect(isPlatformThrottleSignature(failure("HtmlPageError", "bid 403 has no title"))).toBe(false);
    expect(isPlatformThrottleSignature(failure("CoBidnetError", "page did not contain open solicitations"))).toBe(false);
    expect(isPlatformThrottleSignature(success)).toBe(false);
    expect(isPlatformThrottleSignature({ ok: false, source: "x", status: "disabled" })).toBe(false);
  });
});

describe("PlatformDeferralTracker", () => {
  const denver = { id: "bidnet_co_denver", providerFamily: "bidnet" };
  const erie = { id: "bidnet_ny_erie", providerFamily: "bidnet" };
  const dedicated = { id: "tx_esbd", providerFamily: null };

  it("defers the rest of a platform after a throttle signature", () => {
    const tracker = new PlatformDeferralTracker({ minIntervalMs: 0 });

    expect(tracker.deferredBy(erie)).toBeNull();
    tracker.observe(denver, failure("BidNetChallengeError"));

    expect(tracker.deferredBy(erie)).toBe("bidnet_co_denver");
    expect(tracker.deferredBy(dedicated)).toBeNull();
    expect(platformDeferredResult("bidnet_ny_erie", "bidnet_co_denver")).toEqual({
      ok: false,
      source: "bidnet_ny_erie",
      status: "deferred",
      reason: "platform_throttled:bidnet_co_denver",
    });
  });

  it("keeps the first throttling source as the reason", () => {
    const tracker = new PlatformDeferralTracker({ minIntervalMs: 0 });
    tracker.observe(denver, failure("BidNetChallengeError"));
    tracker.observe(erie, failure("BidNetChallengeError"));

    expect(tracker.deferredBy({ id: "bidnet_oh_franklin", providerFamily: "bidnet" })).toBe("bidnet_co_denver");
  });

  it("does not defer on ordinary failures", () => {
    const tracker = new PlatformDeferralTracker({ minIntervalMs: 0 });
    tracker.observe(denver, failure("CoBidnetError", "page did not contain open solicitations"));

    expect(tracker.deferredBy(erie)).toBeNull();
  });

  it("spaces two sources of the same platform by the configured interval", async () => {
    const sleep = vi.fn(async () => {});
    let clock = 0;
    const tracker = new PlatformDeferralTracker({ minIntervalMs: 5_000, sleep, now: () => clock });

    await tracker.waitForPlatformSlot(denver);
    expect(sleep).not.toHaveBeenCalled();

    clock = 1_000;
    await tracker.waitForPlatformSlot(erie);
    expect(sleep).toHaveBeenCalledWith(4_000);

    // A dedicated (family-less) source never waits.
    sleep.mockClear();
    await tracker.waitForPlatformSlot(dedicated);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not wait when the interval has already elapsed or is disabled", async () => {
    const sleep = vi.fn(async () => {});
    let clock = 0;
    const tracker = new PlatformDeferralTracker({ minIntervalMs: 5_000, sleep, now: () => clock });

    await tracker.waitForPlatformSlot(denver);
    clock = 9_000;
    await tracker.waitForPlatformSlot(erie);
    expect(sleep).not.toHaveBeenCalled();

    const disabled = new PlatformDeferralTracker({ minIntervalMs: 0, sleep });
    await disabled.waitForPlatformSlot(denver);
    await disabled.waitForPlatformSlot(erie);
    expect(sleep).not.toHaveBeenCalled();
  });
});
