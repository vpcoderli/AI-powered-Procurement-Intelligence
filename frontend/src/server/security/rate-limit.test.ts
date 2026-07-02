import { describe, expect, it } from "vitest";
import { createRateLimiter, InMemoryRateLimitStore, retryAfterSeconds } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit within the window", () => {
    const currentTime = 1_000_000;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => currentTime });

    const first = limiter("key");
    const second = limiter("key");
    const third = limiter("key");

    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("blocks requests once the limit is exceeded and reports retryAfterMs", () => {
    const currentTime = 1_000_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => currentTime });

    limiter("key");
    limiter("key");
    const blocked = limiter("key");

    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBe(60_000);
  });

  it("allows requests again once the window slides past the oldest hit", () => {
    let currentTime = 1_000_000;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => currentTime });

    limiter("key");
    currentTime += 30_000;
    limiter("key");

    currentTime += 30_001;
    const afterSlide = limiter("key");

    expect(afterSlide.allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 1_000_000 });

    const a1 = limiter("a");
    const b1 = limiter("b");
    const a2 = limiter("a");

    expect(a1.allowed).toBe(true);
    expect(b1.allowed).toBe(true);
    expect(a2.allowed).toBe(false);
  });

  it("uses the provided store implementation", () => {
    const store = new InMemoryRateLimitStore();
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, store, now: () => 1_000_000 });

    limiter("key");

    expect(store.size).toBe(1);
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up to whole seconds", () => {
    expect(retryAfterSeconds(1)).toBe(1);
    expect(retryAfterSeconds(999)).toBe(1);
    expect(retryAfterSeconds(1001)).toBe(2);
    expect(retryAfterSeconds(60_000)).toBe(60);
  });

  it("never returns less than 1", () => {
    expect(retryAfterSeconds(0)).toBe(1);
  });
});
