import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "@/server/auth/service";
import { organizationMemberships, organizations, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  WorkspaceEmailExistsError,
  WorkspacePermissionError,
  ensureUserWorkspace,
  getAccountWorkspace,
  inviteWorkspaceMember,
  updateOrganizationName,
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

  it("lets owners invite members but blocks ordinary members", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });

    const invite = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      displayName: "Member One",
      role: "member",
    });

    expect(invite.temporaryPassword).toMatch(/^Temp-/);
    expect(invite.member).toMatchObject({
      email: "member@example.com",
      displayName: "Member One",
      workspaceRole: "member",
      status: "active",
    });

    await expect(
      inviteWorkspaceMember(testDb.db, invite.member.userId, {
        email: "second@example.com",
        role: "member",
      }),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);
  });

  it("returns a workspace summary with members", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
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
});
