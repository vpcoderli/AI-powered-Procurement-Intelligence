import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  AccountDisabledError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidAuthInputError,
  WeakPasswordError,
  changeUserPassword,
  getSessionUser,
  loginUser,
  logoutSession,
  registerUser,
  updateUserProfile,
} from "./service";

describe("auth service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("registers a user and creates a session", async () => {
    const result = await registerUser(testDb.db, {
      email: "Buyer@Example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    expect(result.user).toEqual({
      id: expect.stringMatching(/^user_/),
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search", "supplier_profile"]),
    });
    expect(result.sessionToken).toMatch(/^sess_/);
    expect(await getSessionUser(testDb.db, result.sessionToken)).toMatchObject({
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search"]),
    });
  });

  it("rejects duplicate normalized email addresses", async () => {
    await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    await expect(
      registerUser(testDb.db, {
        email: " Buyer@Example.com ",
        password: "another-password",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("maps database unique email conflicts to duplicate email errors", async () => {
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => ({
              get: () => undefined,
            }),
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          run: () => {
            throw new Error("UNIQUE constraint failed: users.email");
          },
        }),
      }),
    } as unknown as AppDatabase;

    await expect(
      registerUser(fakeDb, {
        email: "buyer@example.com",
        password: "strong-password",
      }),
    ).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it("rejects weak passwords", async () => {
    await expect(
      registerUser(testDb.db, {
        email: "buyer@example.com",
        password: "short",
      }),
    ).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it("logs in with the correct password and rejects the wrong password", async () => {
    await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    await expect(loginUser(testDb.db, "buyer@example.com", "wrong-password")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(loginUser(testDb.db, " Buyer@Example.com ", "strong-password")).resolves.toMatchObject({
      user: { email: "buyer@example.com" },
      sessionToken: expect.stringMatching(/^sess_/),
    });
  });

  it("logs out by deleting the session", async () => {
    const result = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    await logoutSession(testDb.db, result.sessionToken);

    expect(await getSessionUser(testDb.db, result.sessionToken)).toBeNull();
  });

  it("does not authenticate disabled accounts", async () => {
    const result = await registerUser(testDb.db, {
      email: "disabled@example.com",
      password: "strong-password",
    });

    testDb.db.$client
      .prepare("UPDATE users SET is_disabled = 1 WHERE id = ?")
      .run(result.user.id);

    await expect(loginUser(testDb.db, "disabled@example.com", "strong-password")).rejects.toBeInstanceOf(
      AccountDisabledError,
    );
    await expect(getSessionUser(testDb.db, result.sessionToken)).resolves.toBeNull();
  });

  it("updates a user's display name and returns the refreshed public user", async () => {
    const result = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    await expect(
      updateUserProfile(testDb.db, result.user.id, { displayName: "  Buyer Two  " }),
    ).resolves.toMatchObject({
      id: result.user.id,
      email: "buyer@example.com",
      displayName: "Buyer Two",
      role: "user",
      tier: "free",
    });
  });

  it("rejects missing users when updating a profile", async () => {
    await expect(
      updateUserProfile(testDb.db, "missing_user", { displayName: "Buyer" }),
    ).rejects.toBeInstanceOf(InvalidAuthInputError);
  });

  it("changes a password after validating the current password", async () => {
    await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });
    const login = await loginUser(testDb.db, "buyer@example.com", "strong-password");

    await expect(
      changeUserPassword(testDb.db, login.user.id, {
        currentPassword: "wrong-password",
        newPassword: "new-strong-password",
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    await expect(
      changeUserPassword(testDb.db, login.user.id, {
        currentPassword: "strong-password",
        newPassword: "new-strong-password",
      }),
    ).resolves.toEqual({ ok: true });

    await expect(loginUser(testDb.db, "buyer@example.com", "strong-password")).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(loginUser(testDb.db, "buyer@example.com", "new-strong-password")).resolves.toMatchObject({
      user: { email: "buyer@example.com" },
    });
  });

  it("rejects weak new passwords", async () => {
    const result = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });

    await expect(
      changeUserPassword(testDb.db, result.user.id, {
        currentPassword: "strong-password",
        newPassword: "short",
      }),
    ).rejects.toBeInstanceOf(WeakPasswordError);
  });
});
