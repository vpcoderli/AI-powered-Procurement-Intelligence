import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
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

interface MysqlPasswordResetReader {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[]] | [unknown[], unknown]>;
}

async function executePasswordResetWrite(mysql: MysqlPasswordResetReader, sql: string, values: unknown[]) {
  const executable = mysql as MysqlPasswordResetReader & {
    execute?: (sql: string, values?: unknown[]) => Promise<unknown>;
  };

  if (executable.execute) {
    await executable.execute(sql, values);
    return;
  }

  await mysql.query(sql, values);
}

export async function requestPasswordReset(
  db: AppDatabase,
  emailInput: string,
  options: PasswordResetRequestOptions = {},
): Promise<PasswordResetRequestResult> {
  if (isMysqlDatabaseUrlConfigured()) {
    return requestPasswordResetFromMysql(resolveMysqlPool(), emailInput, options);
  }

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

export async function requestPasswordResetFromMysql(
  mysql: MysqlPasswordResetReader,
  emailInput: string,
  options: PasswordResetRequestOptions = {},
): Promise<PasswordResetRequestResult> {
  const email = normalizeEmail(emailInput);
  const [userRows] = await mysql.query(
    "SELECT id, is_disabled AS isDisabled FROM users WHERE email = ? LIMIT 1",
    [email],
  );
  const user = (userRows as Array<{ id: string; isDisabled: number | string }>)[0];

  if (!user?.id || user.isDisabled === 1 || user.isDisabled === "1") {
    return { ok: true };
  }

  const resetToken = createResetToken();
  const timestamp = nowIso();
  const expiresAt = new Date(
    Date.now() + (options.expiresInMinutes ?? DEFAULT_EXPIRES_IN_MINUTES) * 60 * 1000,
  ).toISOString();

  await executePasswordResetWrite(
    mysql,
    `
      INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [`password_reset_${randomUUID()}`, user.id, hashResetToken(resetToken), expiresAt, null, timestamp],
  );

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
  if (isMysqlDatabaseUrlConfigured()) {
    return resetPasswordWithTokenFromMysql(resolveMysqlPool(), token, newPassword);
  }

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

export async function resetPasswordWithTokenFromMysql(
  mysql: MysqlPasswordResetReader,
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

  const [rows] = await mysql.query(
    `
      SELECT
        password_reset_tokens.id AS id,
        password_reset_tokens.user_id AS userId,
        password_reset_tokens.expires_at AS expiresAt,
        password_reset_tokens.used_at AS usedAt,
        users.is_disabled AS isDisabled
      FROM password_reset_tokens
      INNER JOIN users ON password_reset_tokens.user_id = users.id
      WHERE password_reset_tokens.token_hash = ?
      LIMIT 1
    `,
    [hashResetToken(resetToken)],
  );
  const row = (rows as Array<{
    id: string;
    userId: string;
    expiresAt: string;
    usedAt: string | null;
    isDisabled: number | string;
  }>)[0];

  if (!row || row.usedAt) {
    throw new InvalidPasswordResetTokenError();
  }

  if (row.isDisabled === 1 || row.isDisabled === "1") {
    throw new AccountDisabledError();
  }

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new ExpiredPasswordResetTokenError();
  }

  const timestamp = nowIso();
  await executePasswordResetWrite(mysql, "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [
    await hashPassword(newPassword),
    timestamp,
    row.userId,
  ]);
  await executePasswordResetWrite(mysql, "UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", [
    timestamp,
    row.id,
  ]);
  await executePasswordResetWrite(mysql, "DELETE FROM sessions WHERE user_id = ?", [row.userId]);

  return { ok: true as const };
}
