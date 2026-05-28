import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "@/server/auth/service";
import { notificationOutbox, organizationMemberships, organizations, users, workspaceInvitations } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  WorkspaceLastOwnerError,
  WorkspaceEmailExistsError,
  WorkspaceInvitationNotFoundError,
  WorkspacePermissionError,
  acceptWorkspaceInvitation,
  disableWorkspaceMember,
  ensureUserWorkspace,
  getAccountWorkspace,
  inviteWorkspaceMember,
  listWorkspaceMemberUserIds,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  restoreWorkspaceMember,
  revokeWorkspaceInvitation,
  updateOrganizationName,
  updateWorkspaceMemberRole,
} from "./workspace";

describe("workspace account service", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("creates a default organization with owner membership for registered users", async () => {
    const registered = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
      displayName: "Owner One",
    });

    expect(registered.user.workspace).toMatchObject({
      organizationId: expect.stringMatching(/^org_/),
      organizationName: "Owner One's Workspace",
      role: "owner",
    });

    const membership = testDb.db
      .select()
      .from(organizationMemberships)
      .where(eq(organizationMemberships.userId, registered.user.id))
      .limit(1)
      .get();

    expect(membership).toMatchObject({
      organizationId: registered.user.workspace.organizationId,
      role: "owner",
      status: "active",
    });
  });

  it("ensures existing users get one owner workspace without duplicates", async () => {
    testDb.db.insert(users).values({
      id: "user_existing",
      email: "existing@example.com",
      displayName: "Existing Buyer",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    }).run();

    const first = ensureUserWorkspace(testDb.db, "user_existing");
    const second = ensureUserWorkspace(testDb.db, "user_existing");

    expect(first).toEqual(second);
    expect(testDb.db.select().from(organizations).all()).toHaveLength(1);
    expect(testDb.db.select().from(organizationMemberships).all()).toHaveLength(1);
  });

  it("lets organization owners rename their workspace", async () => {
    const registered = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });

    const workspace = updateOrganizationName(testDb.db, registered.user.id, {
      name: "Acme Federal Team",
    });

    expect(workspace.organization.name).toBe("Acme Federal Team");
    expect(workspace.currentUserRole).toBe("owner");
  });

  it("lets owners invite pending members but blocks ordinary members", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });

    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      displayName: "Member One",
      role: "member",
    });

    expect(invite.inviteToken).toMatch(/^invite_/);
    expect(invite.member).toMatchObject({
      email: "member@example.com",
      displayName: "Member One",
      workspaceRole: "member",
      status: "invited",
    });
    expect(getAccountWorkspace(testDb.db, owner.user.id).members.map((member) => member.status)).toContain("invited");
    expect(testDb.db.select().from(notificationOutbox).all()[0]).toMatchObject({
      alertId: expect.stringMatching(/^workspace_invite:/),
      userId: invite.member.userId,
      channel: "email",
      recipient: "member@example.com",
      status: "pending",
    });
    expect(testDb.db.select().from(notificationOutbox).all()[0]?.bodyText).toContain(invite.inviteUrl);

    await expect(
      inviteWorkspaceMember(testDb.db, invite.member.userId, {
        email: "second@example.com",
        role: "member",
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);
  });

  it("lets owners resend pending invitations with a rotated token and notification", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });

    const resent = resendWorkspaceInvitation(testDb.db, owner.user.id, invite.member.userId);

    expect(resent.member).toMatchObject({
      userId: invite.member.userId,
      status: "invited",
    });
    expect(resent.inviteToken).toMatch(/^invite_/);
    expect(resent.inviteToken).not.toBe(invite.inviteToken);
    expect(resent.inviteUrl).toContain(encodeURIComponent(resent.inviteToken));
    expect(testDb.db.select().from(notificationOutbox).all()).toHaveLength(2);
    await expect(
      acceptWorkspaceInvitation(testDb.db, {
        token: invite.inviteToken,
        password: "member-strong-password",
      }),
    ).rejects.toBeInstanceOf(WorkspaceInvitationNotFoundError);
  });

  it("lets owners revoke pending invitations and blocks later acceptance", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });

    const workspace = revokeWorkspaceInvitation(testDb.db, owner.user.id, invite.member.userId);

    expect(workspace.members.map((member) => member.userId)).not.toContain(invite.member.userId);
    expect(testDb.db.select().from(workspaceInvitations).all()[0]).toMatchObject({
      revokedAt: expect.any(String),
    });
    expect(testDb.db.select().from(users).where(eq(users.id, invite.member.userId)).get()).toMatchObject({
      email: null,
      isDisabled: 1,
    });
    await expect(
      acceptWorkspaceInvitation(testDb.db, {
        token: invite.inviteToken,
        password: "member-strong-password",
      }),
    ).rejects.toBeInstanceOf(WorkspaceInvitationNotFoundError);
  });

  it("activates an invited member after accepting the invitation and setting a password", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });

    const result = await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
      displayName: "Member Accepted",
    });

    expect(result.user.email).toBe("member@example.com");
    expect(result.user.displayName).toBe("Member Accepted");
    expect(result.user.workspace).toMatchObject({
      organizationId: owner.user.workspace.organizationId,
      role: "member",
    });
    expect(testDb.db.select().from(workspaceInvitations).all()[0]).toMatchObject({
      acceptedAt: expect.any(String),
    });
  });

  it("returns a workspace summary with members", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    const workspace = getAccountWorkspace(testDb.db, owner.user.id);

    expect(workspace.organization).toMatchObject({
      id: owner.user.workspace.organizationId,
      name: owner.user.workspace.organizationName,
    });
    expect(workspace.currentUserRole).toBe("owner");
    expect(workspace.members.map((member) => member.email)).toEqual([
      "owner@example.com",
      "member@example.com",
    ]);
  });

  it("rejects duplicate invited member emails", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });

    await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });

    await expect(
      inviteWorkspaceMember(testDb.db, owner.user.id, {
        email: "member@example.com",
        role: "member",
      }),
    ).rejects.toBeInstanceOf(WorkspaceEmailExistsError);
  });

  it("lets workspace owners update member roles", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    const workspace = updateWorkspaceMemberRole(testDb.db, owner.user.id, invite.member.userId, {
      role: "owner",
    });

    expect(workspace.members.find((member) => member.userId === invite.member.userId)).toMatchObject({
      workspaceRole: "owner",
    });
  });

  it("blocks non-owners from updating or removing workspace members", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    expect(() =>
      updateWorkspaceMemberRole(testDb.db, invite.member.userId, owner.user.id, { role: "member" }),
    ).toThrow(WorkspacePermissionError);
    expect(() => removeWorkspaceMember(testDb.db, invite.member.userId, owner.user.id)).toThrow(
      WorkspacePermissionError,
    );
  });

  it("keeps at least one active workspace owner", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });

    expect(() =>
      updateWorkspaceMemberRole(testDb.db, owner.user.id, owner.user.id, { role: "member" }),
    ).toThrow(WorkspaceLastOwnerError);
    expect(() => removeWorkspaceMember(testDb.db, owner.user.id, owner.user.id)).toThrow(
      WorkspaceLastOwnerError,
    );
  });

  it("lets owners remove members from shared workspace access", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    const workspace = removeWorkspaceMember(testDb.db, owner.user.id, invite.member.userId);

    expect(workspace.members.map((member) => member.userId)).not.toContain(invite.member.userId);
    expect(listWorkspaceMemberUserIds(testDb.db, owner.user.id)).toEqual([owner.user.id]);
    expect(ensureUserWorkspace(testDb.db, invite.member.userId).organizationId).not.toBe(
      owner.user.workspace.organizationId,
    );
  });

  it("lets owners disable and restore active members without deleting the membership", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: invite.inviteToken,
      password: "member-strong-password",
    });

    const disabled = disableWorkspaceMember(testDb.db, owner.user.id, invite.member.userId);

    expect(disabled.members.find((member) => member.userId === invite.member.userId)).toMatchObject({
      status: "disabled",
    });
    expect(listWorkspaceMemberUserIds(testDb.db, owner.user.id)).toEqual([owner.user.id]);

    const restored = restoreWorkspaceMember(testDb.db, owner.user.id, invite.member.userId);

    expect(restored.members.find((member) => member.userId === invite.member.userId)).toMatchObject({
      status: "active",
    });
    expect(listWorkspaceMemberUserIds(testDb.db, owner.user.id)).toContain(invite.member.userId);
  });
});
