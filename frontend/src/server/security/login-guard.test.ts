import { describe, expect, it } from "vitest";
import {
  createLoginGuard,
  LOGIN_LOCKOUT_MAX_ATTEMPTS,
  LOGIN_LOCKOUT_WINDOW_MS,
} from "./login-guard";

describe("createLoginGuard - account lockout", () => {
  it("allows login attempts before the failure threshold is reached", () => {
    const currentTime = 1_000_000;
    const guard = createLoginGuard({ now: () => currentTime });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS - 1; attempt += 1) {
      const outcome = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");
      expect(outcome.blocked).toBe(false);
      guard.recordLoginFailure("buyer@example.com");
    }

    const stillAllowed = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");
    expect(stillAllowed.blocked).toBe(false);
  });

  it("locks the account out after the configured number of consecutive failures", () => {
    const currentTime = 1_000_000;
    const guard = createLoginGuard({ now: () => currentTime });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS; attempt += 1) {
      guard.recordLoginFailure("buyer@example.com");
    }

    const outcome = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");

    expect(outcome.blocked).toBe(true);
    if (outcome.blocked) {
      expect(outcome.reason).toBe("account_locked");
      expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
      expect(outcome.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_LOCKOUT_WINDOW_MS / 1000);
    }
  });

  it("is scoped per account so other accounts are unaffected", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS; attempt += 1) {
      guard.recordLoginFailure("buyer@example.com");
    }

    const lockedOut = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");
    const otherAccount = guard.checkLoginAllowed("1.1.1.1", "someone-else@example.com");

    expect(lockedOut.blocked).toBe(true);
    expect(otherAccount.blocked).toBe(false);
  });

  it("normalizes account identifiers by trimming and lowercasing", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS; attempt += 1) {
      guard.recordLoginFailure("  Buyer@Example.com  ");
    }

    const outcome = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");

    expect(outcome.blocked).toBe(true);
  });

  it("clears the lockout after a successful login", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS - 1; attempt += 1) {
      guard.recordLoginFailure("buyer@example.com");
    }
    guard.recordLoginSuccess("buyer@example.com");

    guard.recordLoginFailure("buyer@example.com");
    const outcome = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");

    expect(outcome.blocked).toBe(false);
  });

  it("unlocks the account again once the lockout window elapses", () => {
    let currentTime = 1_000_000;
    const guard = createLoginGuard({ now: () => currentTime });

    for (let attempt = 0; attempt < LOGIN_LOCKOUT_MAX_ATTEMPTS; attempt += 1) {
      guard.recordLoginFailure("buyer@example.com");
    }

    currentTime += LOGIN_LOCKOUT_WINDOW_MS + 1;
    const outcome = guard.checkLoginAllowed("1.1.1.1", "buyer@example.com");

    expect(outcome.blocked).toBe(false);
  });
});

describe("createLoginGuard - IP and account rate limiting", () => {
  it("blocks further login attempts from an IP once its rate limit is exceeded", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    let lastOutcome: ReturnType<typeof guard.checkLoginAllowed> | undefined;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      lastOutcome = guard.checkLoginAllowed("9.9.9.9", `user-${attempt}@example.com`);
    }

    expect(lastOutcome?.blocked).toBe(true);
    if (lastOutcome?.blocked) {
      expect(lastOutcome.reason).toBe("rate_limited");
      expect(lastOutcome.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("blocks further login attempts against a single account across different IPs", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    let lastOutcome: ReturnType<typeof guard.checkLoginAllowed> | undefined;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      lastOutcome = guard.checkLoginAllowed(`10.0.0.${attempt}`, "shared@example.com");
    }

    expect(lastOutcome?.blocked).toBe(true);
  });
});

describe("createLoginGuard - password reset request rate limiting", () => {
  it("allows password reset requests below the limit", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    const outcome = guard.checkPasswordResetRequestAllowed("2.2.2.2", "buyer@example.com");

    expect(outcome.blocked).toBe(false);
  });

  it("blocks password reset requests once the per-account limit is exceeded", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    let lastOutcome: ReturnType<typeof guard.checkPasswordResetRequestAllowed> | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      lastOutcome = guard.checkPasswordResetRequestAllowed(`3.3.3.${attempt}`, "buyer@example.com");
    }

    expect(lastOutcome?.blocked).toBe(true);
    if (lastOutcome?.blocked) {
      expect(lastOutcome.reason).toBe("rate_limited");
    }
  });

  it("blocks password reset requests once the per-IP limit is exceeded", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    let lastOutcome: ReturnType<typeof guard.checkPasswordResetRequestAllowed> | undefined;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      lastOutcome = guard.checkPasswordResetRequestAllowed("4.4.4.4", `user-${attempt}@example.com`);
    }

    expect(lastOutcome?.blocked).toBe(true);
  });
});

describe("createLoginGuard - password reset confirm rate limiting", () => {
  it("allows confirm attempts below the per-IP limit", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    const outcome = guard.checkPasswordResetConfirmAllowed("5.5.5.5");

    expect(outcome.blocked).toBe(false);
  });

  it("blocks confirm attempts once the per-IP limit is exceeded", () => {
    const guard = createLoginGuard({ now: () => 1_000_000 });

    let lastOutcome: ReturnType<typeof guard.checkPasswordResetConfirmAllowed> | undefined;
    for (let attempt = 0; attempt < 25; attempt += 1) {
      lastOutcome = guard.checkPasswordResetConfirmAllowed("6.6.6.6");
    }

    expect(lastOutcome?.blocked).toBe(true);
    if (lastOutcome?.blocked) {
      expect(lastOutcome.reason).toBe("rate_limited");
    }
  });
});
