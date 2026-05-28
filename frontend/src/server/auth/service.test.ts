import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  acceptWorkspaceInvitation,
  inviteWorkspaceMember,
} from "@/server/account/workspace";
import { organizations, users } from "@/server/db/schema";
import {
  upsertAccountSubscription,
} from "@/server/billing/subscriptions";
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
      workspace: {
        organizationId: expect.stringMatching(/^org_/),
        organizationName: "Buyer One's Workspace",
        role: "owner",
        tier: "free",
      },
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

  it("uses the workspace organization tier for member session entitlements", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    testDb.db.update(organizations)
      .set({ accountTier: "business" })
      .where(eq(organizations.id, owner.user.workspace.organizationId))
      .run();
    testDb.db.update(users)
      .set({ accountTier: "free" })
      .where(eq(users.id, owner.user.id))
      .run();
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    const accepted = await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    const sessionUser = await getSessionUser(testDb.db, accepted.sessionToken);

    expect(sessionUser).toMatchObject({
      email: "member@example.com",
      tier: "business",
      features: expect.arrayContaining(["compliance_manifest"]),
      workspace: {
        organizationId: owner.user.workspace.organizationId,
        tier: "business",
      },
    });
  });

  it("applies organization feature overrides to session entitlements", async () => {
    const registered = await registerUser(testDb.db, {
      email: "beta@example.com",
      password: "strong-password",
    });

    testDb.db.$client.prepare(`
      INSERT INTO organization_feature_overrides (
        organization_id,
        feature_key,
        is_enabled,
        created_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      registered.user.workspace.organizationId,
      "compliance_manifest",
      1,
      registered.user.id,
      "2026-05-28T00:00:00.000Z",
      "2026-05-28T00:00:00.000Z",
    );

    await expect(getSessionUser(testDb.db, registered.sessionToken)).resolves.toMatchObject({
      tier: "free",
      features: expect.arrayContaining(["compliance_manifest"]),
    });
  });

  it("lets organization feature overrides disable tier-default features", async () => {
    const registered = await registerUser(testDb.db, {
      email: "business@example.com",
      password: "strong-password",
    });
    testDb.db.update(organizations)
      .set({ accountTier: "business" })
      .where(eq(organizations.id, registered.user.workspace.organizationId))
      .run();
    testDb.db.$client.prepare(`
      INSERT INTO organization_feature_overrides (
        organization_id,
        feature_key,
        is_enabled,
        created_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      registered.user.workspace.organizationId,
      "compliance_manifest",
      0,
      registered.user.id,
      "2026-05-28T00:00:00.000Z",
      "2026-05-28T00:00:00.000Z",
    );

    const sessionUser = await getSessionUser(testDb.db, registered.sessionToken);

    expect(sessionUser).toMatchObject({ tier: "business" });
    expect(sessionUser?.features).not.toContain("compliance_manifest");
  });

  it("ignores expired organization feature overrides in session entitlements", async () => {
    const registered = await registerUser(testDb.db, {
      email: "expired-beta@example.com",
      password: "strong-password",
    });

    testDb.db.$client.prepare(`
      INSERT INTO organization_feature_overrides (
        organization_id,
        feature_key,
        is_enabled,
        reason,
        expires_at,
        created_by_user_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      registered.user.workspace.organizationId,
      "compliance_manifest",
      1,
      "Expired beta pilot",
      "2020-05-28T00:00:00.000Z",
      registered.user.id,
      "2026-05-28T00:00:00.000Z",
      "2026-05-28T00:00:00.000Z",
    );

    const sessionUser = await getSessionUser(testDb.db, registered.sessionToken);

    expect(sessionUser).toMatchObject({ tier: "free" });
    expect(sessionUser?.features).not.toContain("compliance_manifest");
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

  it("reconciles expired paid subscriptions before returning session entitlements", async () => {
    const result = await registerUser(testDb.db, {
      email: "paid@example.com",
      password: "strong-password",
    });
    upsertAccountSubscription(testDb.db, result.user.id, {
      tier: "pro",
      status: "active",
      source: "local_checkout",
      currentPeriodEnd: "2000-01-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
    });

    await expect(getSessionUser(testDb.db, result.sessionToken)).resolves.toMatchObject({
      id: result.user.id,
      tier: "free",
      features: expect.not.arrayContaining(["submission_guidance"]),
    });
  });

  it("reconciles expired paid subscriptions before returning login entitlements", async () => {
    const registered = await registerUser(testDb.db, {
      email: "paid-login@example.com",
      password: "strong-password",
    });
    upsertAccountSubscription(testDb.db, registered.user.id, {
      tier: "business",
      status: "trialing",
      source: "billing_provider",
      currentPeriodEnd: "2000-01-01T00:00:00.000Z",
    });

    await expect(loginUser(testDb.db, "paid-login@example.com", "strong-password")).resolves.toMatchObject({
      user: {
        id: registered.user.id,
        tier: "free",
        features: expect.not.arrayContaining(["compliance_manifest"]),
      },
    });
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
