import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  acceptWorkspaceInvitation,
  inviteWorkspaceMember,
  ensureUserWorkspace,
  listWorkspaceMemberUserIds,
} from "@/server/account/workspace";
import { registerUser } from "@/server/auth/service";
import {
  getBidByIdFromRepository,
  listBids,
  listSavedBidIds,
  mergeSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";

describe("bid repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("lists seeded bids with per-user saved state", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");

    const bids = await listBids(testDb.db, ["1"]);

    expect(bids).toHaveLength(6);
    expect(bids.find((bid) => bid.id === "1")?.saved).toBe(true);
    expect(bids.find((bid) => bid.id === "2")?.saved).toBe(false);
  });

  it("gets a bid with attachments by id", async () => {
    const bid = await getBidByIdFromRepository(testDb.db, "1");

    expect(bid?.title).toBe("Enterprise Cloud Migration Services");
    expect(bid?.tags).toEqual(["IT Services", "Cloud", "Federal"]);
    expect(bid?.attachments.map((attachment) => attachment.name)).toContain(
      "Statement_of_Work_v2.pdf",
    );
  });

  it("persists saved bids per user", async () => {
    await saveSavedBidId(testDb.db, "anon_a", "1");
    await saveSavedBidId(testDb.db, "anon_b", "2");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual(["1"]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);

    await removeSavedBidId(testDb.db, "anon_a", "1");

    expect(await listSavedBidIds(testDb.db, "anon_a")).toEqual([]);
    expect(await listSavedBidIds(testDb.db, "anon_b")).toEqual(["2"]);
  });

  it("shares saved bids across workspace members when a workspace scope is provided", async () => {
    const owner = await registerUser(testDb.db, {
      email: "owner@example.com",
      password: "strong-password",
    });
    const member = await inviteWorkspaceMember(testDb.db, owner.user.id, {
      email: "member@example.com",
      role: "member",
    });
    await acceptWorkspaceInvitation(testDb.db, {
      token: member.inviteToken,
      password: "member-password",
    });
    const memberUserId = member.member.userId;
    const scopeUserIds = listWorkspaceMemberUserIds(testDb.db, owner.user.id);

    await saveSavedBidId(testDb.db, owner.user.id, "1", scopeUserIds);

    expect(await listSavedBidIds(testDb.db, memberUserId, scopeUserIds)).toEqual(["1"]);

    await saveSavedBidId(testDb.db, memberUserId, "1", scopeUserIds);
    expect(await listSavedBidIds(testDb.db, owner.user.id, scopeUserIds)).toEqual(["1"]);

    await removeSavedBidId(testDb.db, memberUserId, "1", scopeUserIds);
    expect(await listSavedBidIds(testDb.db, owner.user.id, scopeUserIds)).toEqual([]);

    expect(ensureUserWorkspace(testDb.db, memberUserId).organizationId).toBe(
      owner.user.workspace?.organizationId,
    );
  });

  it("merges anonymous saved bids into an authenticated user idempotently", async () => {
    await saveSavedBidId(testDb.db, "user_target", "2");
    await saveSavedBidId(testDb.db, "user_target", "3");
    await saveSavedBidId(testDb.db, "anon_source", "1");
    await saveSavedBidId(testDb.db, "anon_source", "2");

    await mergeSavedBidIds(testDb.db, "anon_source", "user_target");
    await mergeSavedBidIds(testDb.db, "anon_source", "user_target");

    expect(await listSavedBidIds(testDb.db, "user_target")).toEqual(["2", "3", "1"]);
    expect(await listSavedBidIds(testDb.db, "anon_source")).toEqual(["1", "2"]);
  });
});
