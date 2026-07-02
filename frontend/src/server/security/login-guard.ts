import {
  createRateLimiter,
  InMemoryRateLimitStore,
  retryAfterSeconds,
  type RateLimitResult,
  type RateLimitStore,
} from "./rate-limit";

/**
 * Brute-force protection for the login and password-reset flows: IP+account
 * scoped rate limiting plus consecutive-failed-attempt account lockout.
 *
 * LIMITATION: all state (rate limit windows and lockout counters) is
 * in-memory and process-local — see `rate-limit.ts` for the distributed
 * store swap-in point. In a multi-instance deployment, an attacker spread
 * across instances (or behind a load balancer without sticky sessions) can
 * get up to N attempts per instance rather than N total. Acceptable for a
 * single-instance/small-fleet launch; flag for follow-up once a shared store
 * (Redis/Upstash) is available.
 */

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Max consecutive failed login attempts before an account is locked out. */
export const LOGIN_LOCKOUT_MAX_ATTEMPTS = envInt("AUTH_LOGIN_LOCKOUT_MAX_ATTEMPTS", 5);
/** Lockout duration once the threshold above is hit. */
export const LOGIN_LOCKOUT_WINDOW_MS = envInt("AUTH_LOGIN_LOCKOUT_WINDOW_MINUTES", 15) * 60 * 1000;

/** Login attempts allowed per IP address within the window. */
const LOGIN_IP_RATE_LIMIT = envInt("AUTH_LOGIN_RATE_LIMIT_PER_IP", 20);
const LOGIN_IP_RATE_WINDOW_MS = envInt("AUTH_LOGIN_RATE_WINDOW_MINUTES", 15) * 60 * 1000;

/** Login attempts allowed per account identifier within the window (looser than lockout; lockout is the primary defense). */
const LOGIN_ACCOUNT_RATE_LIMIT = envInt("AUTH_LOGIN_RATE_LIMIT_PER_ACCOUNT", 10);
const LOGIN_ACCOUNT_RATE_WINDOW_MS = envInt("AUTH_LOGIN_RATE_WINDOW_MINUTES", 15) * 60 * 1000;

/** Password reset requests allowed per IP within the window. */
const RESET_REQUEST_IP_RATE_LIMIT = envInt("AUTH_RESET_REQUEST_RATE_LIMIT_PER_IP", 10);
const RESET_REQUEST_IP_RATE_WINDOW_MS = envInt("AUTH_RESET_REQUEST_RATE_WINDOW_MINUTES", 15) * 60 * 1000;

/** Password reset requests allowed per account/email within the window. */
const RESET_REQUEST_ACCOUNT_RATE_LIMIT = envInt("AUTH_RESET_REQUEST_RATE_LIMIT_PER_ACCOUNT", 5);
const RESET_REQUEST_ACCOUNT_RATE_WINDOW_MS = envInt("AUTH_RESET_REQUEST_RATE_WINDOW_MINUTES", 15) * 60 * 1000;

/** Password reset confirm (token submission) attempts allowed per IP within the window. */
const RESET_CONFIRM_IP_RATE_LIMIT = envInt("AUTH_RESET_CONFIRM_RATE_LIMIT_PER_IP", 20);
const RESET_CONFIRM_IP_RATE_WINDOW_MS = envInt("AUTH_RESET_CONFIRM_RATE_WINDOW_MINUTES", 15) * 60 * 1000;

interface LockoutEntry {
  failureCount: number;
  lockedUntil: number | null;
}

export interface GuardDependencies {
  now?: () => number;
  /** Injectable so tests (and a future Redis swap-in) can share/replace stores. */
  loginIpStore?: RateLimitStore;
  loginAccountStore?: RateLimitStore;
  resetRequestIpStore?: RateLimitStore;
  resetRequestAccountStore?: RateLimitStore;
  resetConfirmIpStore?: RateLimitStore;
  lockoutStore?: Map<string, LockoutEntry>;
}

export type GuardOutcome =
  | { blocked: false }
  | { blocked: true; reason: "rate_limited" | "account_locked"; retryAfterSeconds: number };

function normalizeAccountKey(identifier: string) {
  return identifier.trim().toLowerCase();
}

function outcomeFromRateLimit(result: RateLimitResult): GuardOutcome {
  if (result.allowed) return { blocked: false };

  return {
    blocked: true,
    reason: "rate_limited",
    retryAfterSeconds: retryAfterSeconds(result.retryAfterMs),
  };
}

/**
 * Creates a set of guard functions bound to a shared clock/store set. A
 * fresh instance with default (process-local) stores is created once below
 * as the module's singleton (`loginGuard`); tests can construct their own
 * instance with injected stores/clock for isolation.
 */
export function createLoginGuard(deps: GuardDependencies = {}) {
  const now = deps.now ?? (() => Date.now());
  const lockoutStore = deps.lockoutStore ?? new Map<string, LockoutEntry>();

  const checkLoginIpRate = createRateLimiter({
    limit: LOGIN_IP_RATE_LIMIT,
    windowMs: LOGIN_IP_RATE_WINDOW_MS,
    store: deps.loginIpStore ?? new InMemoryRateLimitStore(),
    now,
  });
  const checkLoginAccountRate = createRateLimiter({
    limit: LOGIN_ACCOUNT_RATE_LIMIT,
    windowMs: LOGIN_ACCOUNT_RATE_WINDOW_MS,
    store: deps.loginAccountStore ?? new InMemoryRateLimitStore(),
    now,
  });
  const checkResetRequestIpRate = createRateLimiter({
    limit: RESET_REQUEST_IP_RATE_LIMIT,
    windowMs: RESET_REQUEST_IP_RATE_WINDOW_MS,
    store: deps.resetRequestIpStore ?? new InMemoryRateLimitStore(),
    now,
  });
  const checkResetRequestAccountRate = createRateLimiter({
    limit: RESET_REQUEST_ACCOUNT_RATE_LIMIT,
    windowMs: RESET_REQUEST_ACCOUNT_RATE_WINDOW_MS,
    store: deps.resetRequestAccountStore ?? new InMemoryRateLimitStore(),
    now,
  });
  const checkResetConfirmIpRate = createRateLimiter({
    limit: RESET_CONFIRM_IP_RATE_LIMIT,
    windowMs: RESET_CONFIRM_IP_RATE_WINDOW_MS,
    store: deps.resetConfirmIpStore ?? new InMemoryRateLimitStore(),
    now,
  });

  function lockoutStatus(accountKey: string): GuardOutcome {
    const entry = lockoutStore.get(accountKey);
    if (!entry?.lockedUntil) return { blocked: false };

    const currentTime = now();
    if (entry.lockedUntil <= currentTime) {
      lockoutStore.delete(accountKey);
      return { blocked: false };
    }

    return {
      blocked: true,
      reason: "account_locked",
      retryAfterSeconds: retryAfterSeconds(entry.lockedUntil - currentTime),
    };
  }

  /**
   * Call before attempting a login. Checks (without recording) account
   * lockout, then checks-and-records IP and account rate limit hits.
   */
  function checkLoginAllowed(ip: string, accountIdentifier: string): GuardOutcome {
    const accountKey = normalizeAccountKey(accountIdentifier);

    const lockout = lockoutStatus(accountKey);
    if (lockout.blocked) return lockout;

    const ipResult = checkLoginIpRate(`ip:${ip}`);
    if (!ipResult.allowed) return outcomeFromRateLimit(ipResult);

    const accountResult = checkLoginAccountRate(`account:${accountKey}`);
    if (!accountResult.allowed) return outcomeFromRateLimit(accountResult);

    return { blocked: false };
  }

  /** Call after a failed login/password verification to advance the lockout counter. */
  function recordLoginFailure(accountIdentifier: string) {
    const accountKey = normalizeAccountKey(accountIdentifier);
    const entry = lockoutStore.get(accountKey) ?? { failureCount: 0, lockedUntil: null };
    entry.failureCount += 1;

    if (entry.failureCount >= LOGIN_LOCKOUT_MAX_ATTEMPTS) {
      entry.lockedUntil = now() + LOGIN_LOCKOUT_WINDOW_MS;
    }

    lockoutStore.set(accountKey, entry);
  }

  /** Call after a successful login to clear the failure counter/lockout. */
  function recordLoginSuccess(accountIdentifier: string) {
    lockoutStore.delete(normalizeAccountKey(accountIdentifier));
  }

  /** Call before processing a password-reset request (forgot-password) submission. */
  function checkPasswordResetRequestAllowed(ip: string, accountIdentifier: string): GuardOutcome {
    const ipResult = checkResetRequestIpRate(`ip:${ip}`);
    if (!ipResult.allowed) return outcomeFromRateLimit(ipResult);

    const accountResult = checkResetRequestAccountRate(`account:${normalizeAccountKey(accountIdentifier)}`);
    if (!accountResult.allowed) return outcomeFromRateLimit(accountResult);

    return { blocked: false };
  }

  /** Call before processing a password-reset confirm (token + new password) submission. */
  function checkPasswordResetConfirmAllowed(ip: string): GuardOutcome {
    const ipResult = checkResetConfirmIpRate(`ip:${ip}`);
    if (!ipResult.allowed) return outcomeFromRateLimit(ipResult);

    return { blocked: false };
  }

  return {
    checkLoginAllowed,
    recordLoginFailure,
    recordLoginSuccess,
    checkPasswordResetRequestAllowed,
    checkPasswordResetConfirmAllowed,
  };
}

export type LoginGuard = ReturnType<typeof createLoginGuard>;

/** Process-wide singleton used by the auth API routes. */
export const loginGuard = createLoginGuard();
