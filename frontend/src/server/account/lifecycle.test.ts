import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inviteWorkspaceMember, updateWorkspaceMemberRole } from "@/server/account/workspace";
import { getSessionUser, loginUser, registerUser } from "@/server/auth/service";
import { alerts, organizationMemberships, savedBids, sessions, supplierProfiles, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  AccountDeletionRequiresOwnerTransferError,
  exportAccountData,
  softDeleteAccount,
  transferWorkspaceOwnership,
} from "./lifecycle";

describe("account lifecycle service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("exports the current user's account, workspace, profile, saved bids, and alerts", async () => {
    const registered = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
      displayName: "Buyer One",
    });

    testDb.db.insert(savedBids).values({
      userId: registered.user.id,
      bidId: "1",
      createdAt: "2026-05-28T00:00:00.000Z",
    }).run();
    testDb.db.insert(supplierProfiles).values({
      userId: registered.user.id,
      companyName: "Acme Supply",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();
    testDb.db.insert(alerts).values({
      id: "alert_1",
      userId: registered.user.id,
      name: "CA IT",
      query: "software",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();

    const exportData = exportAccountData(testDb.db, registered.user.id);

    expect(exportData.generatedAt).toEqual(expect.any(String));
    expect(exportData.account).toMatchObject({
      id: registered.user.id,
      email: "buyer@example.com",
      displayName: "Buyer One",
      role: "user",
      tier: "free",
      isDisabled: false,
    });
    expect(exportData.workspace?.organization.name).toBe("Buyer One's Workspace");
    expect(exportData.savedBids).toHaveLength(1);
    expect(exportData.supplierProfile?.companyName).toBe("Acme Supply");
    expect(exportData.searchAlerts).toHaveLength(1);
  });

  it("soft-deletes a member account, clears sessions, and removes active workspace access", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    const memberLogin = await loginUser(testDb.db, "member@example.com", invite.temporaryPassword);

    const result = softDeleteAccount(testDb.db, invite.member.userId);

    expect(result).toEqual({ ok: true });
    expect(testDb.db.select().from(sessions).where(eq(sessions.userId, invite.member.userId)).all()).toHaveLength(0);
    expect(await getSessionUser(testDb.db, memberLogin.sessionToken)).toBeNull();
    expect(testDb.db.select().from(users).where(eq(users.id, invite.member.userId)).limit(1).get()).toMatchObject({
      isDisabled: 1,
    });
    expect(
      testDb.db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, invite.member.userId)).all(),
    ).toEqual([]);
  });

  it("requires a sole owner to transfer ownership before deleting when other active members remain", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });

    expect(() => softDeleteAccount(testDb.db, owner.user.id)).toThrow(AccountDeletionRequiresOwnerTransferError);
  });

  it("transfers workspace ownership to another active member and demotes the actor to member", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    updateWorkspaceMemberRole(testDb.db, owner.user.id, owner.user.id, { role: "owner" });

    const workspace = transferWorkspaceOwnership(testDb.db, owner.user.id, invite.member.userId);

    expect(workspace.currentUserRole).toBe("member");
    expect(workspace.members.find((member) => member.userId === owner.user.id)).toMatchObject({
      workspaceRole: "member",
    });
    expect(workspace.members.find((member) => member.userId === invite.member.userId)).toMatchObject({
      workspaceRole: "owner",
    });
  });
});
