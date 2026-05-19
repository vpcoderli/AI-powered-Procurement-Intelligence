import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
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
}

export interface RegisterUserInput {
  email: string;
  password: string;
  displayName?: string;
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
}): PublicUser {
  if (!row.email) {
    throw new InvalidAuthInputError("Authenticated users must have an email");
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
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
    user: toPublicUser(user),
    sessionToken: await createSession(db, user.id),
  };
}

export async function loginUser(db: AppDatabase, emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const user = db.select().from(users).where(eq(users.email, email)).limit(1).get();

  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new InvalidCredentialsError();
  }

  db.update(users)
    .set({
      lastLoginAt: nowIso(),
      updatedAt: nowIso(),
    })
    .where(eq(users.id, user.id))
    .run();

  return {
    user: toPublicUser(user),
    sessionToken: await createSession(db, user.id),
  };
}

export async function getSessionUser(db: AppDatabase, sessionToken: string) {
  const row = db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
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

  if (!row.email) {
    return null;
  }

  return {
    id: row.userId,
    email: row.email,
    displayName: row.displayName,
  } satisfies PublicUser;
}

export async function logoutSession(db: AppDatabase, sessionToken: string) {
  db.delete(sessions)
    .where(eq(sessions.tokenHash, hashSessionToken(sessionToken)))
    .run();
}
