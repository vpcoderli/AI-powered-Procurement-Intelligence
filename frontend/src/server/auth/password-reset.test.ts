import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loginUser, registerUser, WeakPasswordError } from "@/server/auth/service";
import { passwordResetTokens, sessions } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  ExpiredPasswordResetTokenError,
  InvalidPasswordResetTokenError,
  requestPasswordReset,
  resetPasswordWithToken,
} from "./password-reset";

describe("password reset service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates a one-time reset token for an enabled registered user", async () => {
    const registered = await registerUser(testDb.db, {
      email: "Buyer@Example.com",
      password: "strong-password",
    });

    const result = await requestPasswordReset(testDb.db, " buyer@example.com ");
    const rows = testDb.db.select().from(passwordResetTokens).all();

    expect(result).toMatchObject({
      ok: true,
      resetToken: expect.stringMatching(/^reset_/),
      expiresAt: expect.any(String),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: registered.user.id,
      tokenHash: expect.not.stringContaining(result.resetToken ?? ""),
      usedAt: null,
    });
  });

  it("does not reveal whether an email address exists", async () => {
    const result = await requestPasswordReset(testDb.db, "missing@example.com");

    expect(result).toEqual({ ok: true });
    expect(testDb.db.select().from(passwordResetTokens).all()).toHaveLength(0);
  });

  it("resets the password, consumes the token, and invalidates existing sessions", async () => {
    const registered = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });
    const login = await loginUser(testDb.db, "buyer@example.com", "strong-password");
    const reset = await requestPasswordReset(testDb.db, "buyer@example.com");

    await expect(
      resetPasswordWithToken(testDb.db, reset.resetToken ?? "", "new-strong-password"),
    ).resolves.toEqual({ ok: true });

    const tokenRow = testDb.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, registered.user.id))
      .limit(1)
      .get();

    expect(tokenRow?.usedAt).toEqual(expect.any(String));
    expect(testDb.db.select().from(sessions).where(eq(sessions.userId, registered.user.id)).all()).toHaveLength(0);
    await expect(loginUser(testDb.db, "buyer@example.com", "strong-password")).rejects.toThrow();
    await expect(loginUser(testDb.db, "buyer@example.com", "new-strong-password")).resolves.toMatchObject({
      user: { email: "buyer@example.com" },
    });
    expect(login.sessionToken).toMatch(/^sess_/);
  });

  it("rejects used, expired, invalid, and weak reset attempts", async () => {
    await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });
    const reset = await requestPasswordReset(testDb.db, "buyer@example.com");

    await expect(resetPasswordWithToken(testDb.db, reset.resetToken ?? "", "short")).rejects.toBeInstanceOf(
      WeakPasswordError,
    );
    await resetPasswordWithToken(testDb.db, reset.resetToken ?? "", "new-strong-password");
    await expect(
      resetPasswordWithToken(testDb.db, reset.resetToken ?? "", "another-strong-password"),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
    await expect(
      resetPasswordWithToken(testDb.db, "reset_missing", "another-strong-password"),
    ).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);

    const expired = await requestPasswordReset(testDb.db, "buyer@example.com", {
      expiresInMinutes: -1,
    });
    await expect(
      resetPasswordWithToken(testDb.db, expired.resetToken ?? "", "another-strong-password"),
    ).rejects.toBeInstanceOf(ExpiredPasswordResetTokenError);
  });
});
