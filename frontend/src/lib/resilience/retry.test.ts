import { describe, expect, it, vi } from "vitest";
import {
  RetryExhaustedError,
  isLikelyTransientError,
  retryResultWithBackoff,
  retryWithBackoff,
} from "./retry";

function immediateSleep() {
  return Promise.resolve();
}

describe("isLikelyTransientError", () => {
  it("treats network/timeout error codes as retryable", () => {
    expect(isLikelyTransientError(Object.assign(new Error("boom"), { code: "ECONNRESET" }))).toBe(true);
    expect(isLikelyTransientError(Object.assign(new Error("boom"), { code: "ETIMEDOUT" }))).toBe(true);
  });

  it("treats 5xx and 429 HTTP-shaped errors as retryable", () => {
    expect(isLikelyTransientError({ status: 500 })).toBe(true);
    expect(isLikelyTransientError({ status: 503 })).toBe(true);
    expect(isLikelyTransientError({ status: 429 })).toBe(true);
  });

  it("treats other 4xx HTTP-shaped errors as non-retryable", () => {
    expect(isLikelyTransientError({ status: 400 })).toBe(false);
    expect(isLikelyTransientError({ status: 404 })).toBe(false);
    expect(isLikelyTransientError({ statusCode: 422 })).toBe(false);
  });

  it("treats validation-shaped errors as non-retryable", () => {
    class ValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ValidationError";
      }
    }

    expect(isLikelyTransientError(new ValidationError("bad input"))).toBe(false);
  });

  it("treats timeout/network-named errors as retryable", () => {
    expect(isLikelyTransientError(new Error("request timeout"))).toBe(true);
    expect(isLikelyTransientError(new Error("fetch failed"))).toBe(true);
  });

  it("defaults unknown-shaped errors to retryable", () => {
    expect(isLikelyTransientError("a plain string error")).toBe(true);
    expect(isLikelyTransientError(null)).toBe(true);
  });
});

describe("retryWithBackoff", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await retryWithBackoff(fn, { sleep: immediateSleep });

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries retryable failures up to maxAttempts, then throws RetryExhaustedError", async () => {
    const error = Object.assign(new Error("network blip"), { code: "ECONNRESET" });
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, { maxAttempts: 3, sleep: immediateSleep, random: () => 0 }),
    ).rejects.toThrow(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("succeeds after a transient failure on a later attempt", async () => {
    const error = Object.assign(new Error("network blip"), { code: "ECONNRESET" });
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("recovered");

    const result = await retryWithBackoff(fn, { maxAttempts: 3, sleep: immediateSleep, random: () => 0 });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable errors and rejects immediately", async () => {
    class ValidationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ValidationError";
      }
    }
    const fn = vi.fn().mockRejectedValue(new ValidationError("bad input"));

    await expect(retryWithBackoff(fn, { maxAttempts: 5, sleep: immediateSleep })).rejects.toThrow(
      "bad input",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("honors a custom isRetryable classifier", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("custom failure"));

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 4,
        sleep: immediateSleep,
        isRetryable: () => false,
      }),
    ).rejects.toThrow("custom failure");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls onAttemptFailure with attempt metadata for each failed attempt", async () => {
    const error = Object.assign(new Error("network blip"), { code: "ECONNRESET" });
    const fn = vi.fn().mockRejectedValue(error);
    const onAttemptFailure = vi.fn();

    await expect(
      retryWithBackoff(fn, { maxAttempts: 2, sleep: immediateSleep, random: () => 0, onAttemptFailure }),
    ).rejects.toThrow(RetryExhaustedError);

    expect(onAttemptFailure).toHaveBeenCalledTimes(2);
    expect(onAttemptFailure).toHaveBeenNthCalledWith(1, {
      attempt: 1,
      maxAttempts: 2,
      error,
      retryable: true,
      delayMs: 0,
    });
    expect(onAttemptFailure).toHaveBeenNthCalledWith(2, {
      attempt: 2,
      maxAttempts: 2,
      error,
      retryable: true,
      delayMs: null,
    });
  });

  it("never sleeps longer than maxDelayMs even at high attempt counts", async () => {
    const error = Object.assign(new Error("network blip"), { code: "ECONNRESET" });
    const fn = vi.fn().mockRejectedValue(error);
    const delays: number[] = [];
    const sleep = vi.fn((ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    });

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 6,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        sleep,
        random: () => 1, // full jitter upper bound
      }),
    ).rejects.toThrow(RetryExhaustedError);

    expect(delays.every((delay) => delay <= 2000)).toBe(true);
  });
});

describe("retryResultWithBackoff", () => {
  it("returns the first ok result without retrying", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: true, value: 1 });

    const result = await retryResultWithBackoff(fn, {
      sleep: immediateSleep,
      isOk: (r) => r.ok,
      toError: () => new Error("unused"),
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries ok:false results classified as retryable, then returns the last result", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "still down" });

    const result = await retryResultWithBackoff(fn, {
      maxAttempts: 3,
      sleep: immediateSleep,
      random: () => 0,
      isOk: (r) => r.ok,
      toError: (r) => new Error(r.ok ? "unreachable" : r.error),
      isRetryable: () => true,
    });

    expect(result).toEqual({ ok: false, error: "still down" });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns the failed result immediately when classified as non-retryable", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "validation failed" });

    const result = await retryResultWithBackoff(fn, {
      maxAttempts: 5,
      sleep: immediateSleep,
      isOk: (r) => r.ok,
      toError: (r) => new Error(r.ok ? "unreachable" : r.error),
      isRetryable: () => false,
    });

    expect(result).toEqual({ ok: false, error: "validation failed" });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stops retrying once a later attempt succeeds", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "blip" })
      .mockResolvedValueOnce({ ok: true, value: 42 });

    const result = await retryResultWithBackoff(fn, {
      maxAttempts: 4,
      sleep: immediateSleep,
      random: () => 0,
      isOk: (r) => r.ok,
      toError: (r) => new Error(r.ok ? "unreachable" : r.error),
      isRetryable: () => true,
    });

    expect(result).toEqual({ ok: true, value: 42 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("invokes onAttemptFailure for each retried result", async () => {
    const fn = vi.fn().mockResolvedValue({ ok: false, error: "still down" });
    const onAttemptFailure = vi.fn();

    await retryResultWithBackoff(fn, {
      maxAttempts: 2,
      sleep: immediateSleep,
      random: () => 0,
      isOk: (r) => r.ok,
      toError: (r) => new Error(r.ok ? "unreachable" : r.error),
      isRetryable: () => true,
      onAttemptFailure,
    });

    expect(onAttemptFailure).toHaveBeenCalledTimes(2);
  });
});
