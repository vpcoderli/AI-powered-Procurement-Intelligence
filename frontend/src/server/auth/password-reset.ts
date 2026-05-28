import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { passwordResetTokens, sessions, users } from "@/server/db/schema";
import { hashPassword } from "./password";
import { AccountDisabledError, WeakPasswordError } from "./service";

const DEFAULT_EXPIRES_IN_MINUTES = 60;

export interface PasswordResetRequestOptions {
  expiresInMinutes?: number;
}

export interface PasswordResetRequestResult {
  ok: true;
  resetToken?: string;
  expiresAt?: string;
}

export class InvalidPasswordResetTokenError extends Error {
  constructor() {
    super("Invalid password reset token");
    this.name = "InvalidPasswordResetTokenError";
  }
}

export class ExpiredPasswordResetTokenError extends Error {
  constructor() {
    super("Password reset token has expired");
    this.name = "ExpiredPasswordResetTokenError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createResetToken() {
  return `reset_${randomBytes(32).toString("base64url")}`;
}

export async function requestPasswordReset(
  db: AppDatabase,
  emailInput: string,
  options: PasswordResetRequestOptions = {},
): Promise<PasswordResetRequestResult> {
  const email = normalizeEmail(emailInput);
  const user = db.select().from(users).where(eq(users.email, email)).limit(1).get();

  if (!user?.id || user.isDisabled === 1) {
    return { ok: true };
  }

  const resetToken = createResetToken();
  const timestamp = nowIso();
  const expiresAt = new Date(
    Date.now() + (options.expiresInMinutes ?? DEFAULT_EXPIRES_IN_MINUTES) * 60 * 1000,
  ).toISOString();

  db.insert(passwordResetTokens)
    .values({
      id: `password_reset_${randomUUID()}`,
      userId: user.id,
      tokenHash: hashResetToken(resetToken),
      expiresAt,
      usedAt: null,
      createdAt: timestamp,
    })
    .run();

  return {
    ok: true,
    resetToken,
    expiresAt,
  };
}

export async function resetPasswordWithToken(
  db: AppDatabase,
  token: string,
  newPassword: string,
) {
  if (newPassword.length < 8) {
    throw new WeakPasswordError();
  }

  const resetToken = token.trim();
  if (!resetToken) {
    throw new InvalidPasswordResetTokenError();
  }

  const row = db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
      isDisabled: users.isDisabled,
    })
    .from(passwordResetTokens)
    .innerJoin(users, eq(passwordResetTokens.userId, users.id))
    .where(eq(passwordResetTokens.tokenHash, hashResetToken(resetToken)))
    .limit(1)
    .get();

  if (!row || row.usedAt) {
    throw new InvalidPasswordResetTokenError();
  }

  if (row.isDisabled === 1) {
    throw new AccountDisabledError();
  }

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new ExpiredPasswordResetTokenError();
  }

  const timestamp = nowIso();
  db.update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      updatedAt: timestamp,
    })
    .where(eq(users.id, row.userId))
    .run();

  db.update(passwordResetTokens)
    .set({ usedAt: timestamp })
    .where(eq(passwordResetTokens.id, row.id))
    .run();

  db.delete(sessions).where(eq(sessions.userId, row.userId)).run();

  return { ok: true as const };
}
