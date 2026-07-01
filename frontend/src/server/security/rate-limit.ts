/**
 * Generic in-memory sliding-window rate limiter.
 *
 * LIMITATION: state lives in a process-local `Map`, so limits are per-instance.
 * In a multi-instance deployment each instance enforces its own independent
 * window, which under-counts the true request rate across the fleet. The
 * `RateLimitStore` interface below exists specifically so this can be swapped
 * for a shared/distributed store (e.g. Redis or Upstash) later without
 * touching call sites — implement the same interface backed by `INCR`/`EXPIRE`
 * or a Lua script and pass it into `createRateLimiter`.
 */

export interface RateLimitHit {
  /** Timestamps (ms epoch) of requests currently inside the window, oldest first. */
  timestamps: number[];
}

export interface RateLimitStore {
  get(key: string): RateLimitHit | undefined;
  set(key: string, hit: RateLimitHit): void;
  delete(key: string): void;
}

/** Default process-local store. Not shared across instances — see module doc. */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly map = new Map<string, RateLimitHit>();

  get(key: string) {
    return this.map.get(key);
  }

  set(key: string, hit: RateLimitHit) {
    this.map.set(key, hit);
  }

  delete(key: string) {
    this.map.delete(key);
  }

  /** Test/ops helper: drop all tracked keys. */
  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}

export interface RateLimitOptions {
  /** Maximum number of requests allowed within `windowMs`. */
  limit: number;
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Injectable store; defaults to a process-local in-memory Map. */
  store?: RateLimitStore;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimitResult {
  /** Whether the request is allowed under the current window. */
  allowed: boolean;
  /** Remaining requests allowed in the current window after this check. */
  remaining: number;
  /** Total requests permitted per window. */
  limit: number;
  /** Milliseconds until the caller should retry (0 when allowed). */
  retryAfterMs: number;
  /** Epoch ms when the current window fully resets. */
  resetAt: number;
}

export type RateLimiter = (key: string) => RateLimitResult;

/**
 * Creates a sliding-window rate limiter. Each call to the returned function
 * both checks and records a hit for `key` (check-and-increment semantics),
 * matching how request middleware typically wants to use it.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs } = options;
  const store = options.store ?? new InMemoryRateLimitStore();
  const now = options.now ?? (() => Date.now());

  return function checkRateLimit(key: string): RateLimitResult {
    const currentTime = now();
    const windowStart = currentTime - windowMs;
    const existing = store.get(key);
    const timestamps = (existing?.timestamps ?? []).filter((timestamp) => timestamp > windowStart);

    if (timestamps.length >= limit) {
      const oldest = timestamps[0];
      const retryAfterMs = Math.max(oldest + windowMs - currentTime, 0);

      store.set(key, { timestamps });

      return {
        allowed: false,
        remaining: 0,
        limit,
        retryAfterMs,
        resetAt: oldest + windowMs,
      };
    }

    timestamps.push(currentTime);
    store.set(key, { timestamps });

    return {
      allowed: true,
      remaining: Math.max(limit - timestamps.length, 0),
      limit,
      retryAfterMs: 0,
      resetAt: timestamps[0] + windowMs,
    };
  };
}

/** Rounds up to whole seconds for the `Retry-After` HTTP header. */
export function retryAfterSeconds(retryAfterMs: number) {
  return Math.max(Math.ceil(retryAfterMs / 1000), 1);
}
