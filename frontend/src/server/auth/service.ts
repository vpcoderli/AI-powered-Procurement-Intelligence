import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ensureUserWorkspace, type PublicWorkspace } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import {
  featuresForUser,
  normalizeAccountTier,
  normalizeUserRole,
  type AccountTier,
  type FeatureKey,
  type UserRole,
} from "./entitlements";
import { hashPassword, verifyPassword } from "./password";
import {
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  hashSessionToken,
} from "./session";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  tier: AccountTier;
  features: FeatureKey[];
  workspace?: PublicWorkspace;
}

export interface RegisterUserInput {
  email: string;
  password: string;
  displayName?: string;
}

export interface UpdateUserProfileInput {
  displayName?: string;
}

export interface ChangeUserPasswordInput {
  currentPassword: string;
  newPassword: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("Email is already registered");
    this.name = "DuplicateEmailError";
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class AccountDisabledError extends Error {
  constructor() {
    super("Account is disabled");
    this.name = "AccountDisabledError";
  }
}

export class WeakPasswordError extends Error {
  constructor() {
    super("Password must be at least 8 characters");
    this.name = "WeakPasswordError";
  }
}

export class InvalidAuthInputError extends Error {
  constructor(message = "Invalid auth input") {
    super(message);
    this.name = "InvalidAuthInputError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeDisplayName(displayName: string | undefined) {
  const normalized = displayName?.trim();

  return normalized ? normalized : null;
}

function toPublicUser(row: {
  id: string;
  email: string | null;
  displayName: string | null;
  role?: string | null;
  accountTier?: string | null;
  isDisabled?: number | boolean | null;
}, workspace?: PublicWorkspace): PublicUser {
  if (!row.email) {
    throw new InvalidAuthInputError("Authenticated users must have an email");
  }

  if (row.isDisabled === 1 || row.isDisabled === true) {
    throw new AccountDisabledError();
  }

  const role = normalizeUserRole(row.role);
  const tier = normalizeAccountTier(row.accountTier);

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role,
    tier,
    features: featuresForUser({ role, tier }),
    ...(workspace ? { workspace } : {}),
  };
}

function isUniqueEmailConflict(error: unknown) {
  if (!(error instanceof Error)) return false;

  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return (
    code.includes("SQLITE_CONSTRAINT") ||
    error.message.includes("UNIQUE constraint failed: users.email")
  );
}

async function createSession(db: AppDatabase, userId: string) {
  const sessionToken = createSessionToken();
  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  db.insert(sessions)
    .values({
      id: `session_${randomUUID()}`,
      userId,
      tokenHash: hashSessionToken(sessionToken),
      expiresAt,
      createdAt: timestamp,
      lastSeenAt: timestamp,
    })
    .run();

  return sessionToken;
}

export async function registerUser(db: AppDatabase, input: RegisterUserInput) {
  const email = normalizeEmail(input.email);

  if (!email) {
    throw new InvalidAuthInputError("Email is required");
  }

  if (input.password.length < 8) {
    throw new WeakPasswordError();
  }

  const existing = db.select().from(users).where(eq(users.email, email)).limit(1).get();
  if (existing) {
    throw new DuplicateEmailError();
  }

  const timestamp = nowIso();
  const user = {
    id: `user_${randomUUID()}`,
    email,
    passwordHash: await hashPassword(input.password),
    displayName: normalizeDisplayName(input.displayName),
    role: "user",
    accountTier: "free",
    isDisabled: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    db.insert(users).values(user).run();
  } catch (error) {
    if (isUniqueEmailConflict(error)) {
      throw new DuplicateEmailError();
    }

    throw error;
  }

  return {
    user: toPublicUser(user, ensureUserWorkspace(db, user.id)),
    sessionToken: await createSession(db, user.id),
  };
}

export async function loginUser(db: AppDatabase, emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const user = db.select().from(users).where(eq(users.email, email)).limit(1).get();

  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  if (user.isDisabled === 1) {
    throw new AccountDisabledError();
  }

  db.update(users)
    .set({
      lastLoginAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))
    .run();

  return {
    user: toPublicUser(user, ensureUserWorkspace(db, user.id)),
    sessionToken: await createSession(db, user.id),
  };
}

export async function updateUserProfile(
  db: AppDatabase,
  userId: string,
  input: UpdateUserProfileInput,
) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user) {
    throw new InvalidAuthInputError("User not found");
  }

  const nextValues: Partial<typeof users.$inferInsert> = {
    updatedAt: nowIso(),
  };

  if ("displayName" in input) {
    nextValues.displayName = normalizeDisplayName(input.displayName);
  }

  db.update(users).set(nextValues).where(eq(users.id, userId)).run();

  const updatedUser = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!updatedUser) {
    throw new InvalidAuthInputError("User not found");
  }

  return toPublicUser(updatedUser, ensureUserWorkspace(db, updatedUser.id));
}

export async function changeUserPassword(
  db: AppDatabase,
  userId: string,
  input: ChangeUserPasswordInput,
) {
  if (input.newPassword.length < 8) {
    throw new WeakPasswordError();
  }

  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user?.passwordHash) {
    throw new InvalidCredentialsError();
  }

  if (user.isDisabled === 1) {
    throw new AccountDisabledError();
  }

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  db.update(users)
    .set({
      passwordHash: await hashPassword(input.newPassword),
      updatedAt: nowIso(),
    })
    .where(eq(users.id, userId))
    .run();

  return { ok: true as const };
}

export async function getSessionUser(db: AppDatabase, sessionToken: string) {
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      accountTier: users.accountTier,
      isDisabled: users.isDisabled,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, hashSessionToken(sessionToken)))
    .limit(1)
    .get();

  if (!row) {
    return null;
  }

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    db.delete(sessions).where(eq(sessions.id, row.sessionId)).run();
    return null;
  }

  db.update(sessions)
    .set({ lastSeenAt: nowIso() })
    .where(eq(sessions.id, row.sessionId))
    .run();

  if (!row.email || row.isDisabled === 1) {
    db.delete(sessions).where(eq(sessions.id, row.sessionId)).run();
    return null;
  }

  return toPublicUser(
    {
      id: row.userId,
      email: row.email,
      displayName: row.displayName,
      role: row.role,
      accountTier: row.accountTier,
      isDisabled: row.isDisabled,
    },
    ensureUserWorkspace(db, row.userId),
  );
}

export async function logoutSession(db: AppDatabase, sessionToken: string) {
  db.delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(sessionToken)))
    .run();
}
