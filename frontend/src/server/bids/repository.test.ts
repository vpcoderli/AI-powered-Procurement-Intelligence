import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bidAttachments, bids as bidRows, organizations, users } from "@/server/db/schema";
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
  listBidsFromMysql,
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

  it("maps MySQL bid rows with attachments into public bid objects", async () => {
    const queryCalls: string[] = [];
    const mysql = {
      async query(sql: string) {
        queryCalls.push(sql);

        if (sql.includes("FROM bid_attachments")) {
          return [
            [
              {
                id: "attachment_1",
                bidId: "mysql_bid_1",
                name: "Solicitation.pdf",
                url: "https://agency.example.gov/solicitation.pdf",
                originalUrl: "https://agency.example.gov/solicitation.pdf",
                storagePath: "data/attachments/mysql/solicitation.pdf",
                byteSize: 4096,
                contentType: "application/pdf",
                checksumSha256: "sha256-value",
                fetchedAt: "2026-05-20T00:00:00.000Z",
                archiveStatus: "archived",
                archiveError: null,
                sizeLabel: "4 KB",
                mimeType: null,
                sortOrder: 1,
              },
            ],
          ];
        }

        return [
          [
            {
              id: "mysql_bid_1",
              title: "MySQL Cloud Services",
              source: "SAM.gov",
              sourceUrl: "https://sam.gov/opp/mysql_bid_1",
              issuerName: "Federal Cloud Agency",
              issuerType: "federal",
              stateCode: "US",
              originalCategory: "IT Services",
              description: "Cloud migration services",
              fullDescription: "Full cloud migration scope",
              amount: "$100,000",
              publishedDate: "2026-05-19",
              deadlineDate: "2026-06-01",
              contactName: "Jane Buyer",
              contactEmail: "jane@example.gov",
              contactPhone: "555-0100",
              rawPayload: JSON.stringify({ tags: ["Cloud", "Federal"] }),
              sourceConfidence: "high",
              qualityFlagsJson: JSON.stringify(["detail_archived"]),
              adminReviewStatus: "reviewed",
              detailArchiveStatus: "archived",
              detailArchivePath: "data/attachments/details/mysql_bid_1.html",
              detailFetchedAt: "2026-05-20T00:00:00.000Z",
              detailChecksumSha256: "detail-sha",
              detailArchiveError: null,
              isActive: 1,
              updatedAt: "2026-05-20T00:00:00.000Z",
            },
          ],
        ];
      },
    };

    await expect(listBidsFromMysql(mysql, ["mysql_bid_1"])).resolves.toEqual([
      expect.objectContaining({
        id: "mysql_bid_1",
        title: "MySQL Cloud Services",
        saved: true,
        tags: ["Cloud", "Federal"],
        qualityFlags: ["detail_archived"],
        attachments: [
          expect.objectContaining({
            name: "Solicitation.pdf",
            url: "/api/bids/mysql_bid_1/attachments/attachment_1",
            originalUrl: "https://agency.example.gov/solicitation.pdf",
            archiveStatus: "archived",
          }),
        ],
      }),
    ]);
    expect(queryCalls[0]).toContain("display_status <> 'suppressed'");
    expect(queryCalls[1]).toContain("FROM bid_attachments");
  });

  it("gets a bid with attachments by id", async () => {
    const bid = await getBidByIdFromRepository(testDb.db, "1");

    expect(bid?.title).toBe("Enterprise Cloud Migration Services");
    expect(bid?.tags).toEqual(["IT Services", "Cloud", "Federal"]);
    expect(bid?.attachments.map((attachment) => attachment.name)).toContain(
      "Statement_of_Work_v2.pdf",
    );
  });

  it("excludes suppressed bids from public list and detail reads", async () => {
    testDb.db.update(bidRows)
      .set({ displayStatus: "suppressed" })
      .where(eq(bidRows.id, "1"))
      .run();

    const bids = await listBids(testDb.db, []);
    const bid = await getBidByIdFromRepository(testDb.db, "1");

    expect(bids.map((item) => item.id)).not.toContain("1");
    expect(bid).toBeUndefined();
  });

  it("routes all attachments through the download API and preserves original external URLs", async () => {
    const timestamp = "2026-05-28T00:00:00.000Z";
    testDb.db.insert(bidAttachments)
      .values([
        {
          id: "external_attachment",
          bidId: "1",
          name: "External.pdf",
          url: "https://example.gov/files/external.pdf",
          sizeLabel: "1 MB",
          sortOrder: 100,
          createdAt: timestamp,
        },
        {
          id: "local_attachment",
          bidId: "1",
          name: "Local.pdf",
          url: "data/attachments/local.pdf",
          sizeLabel: "2 MB",
          sortOrder: 101,
          createdAt: timestamp,
        },
      ])
      .run();

    const bid = await getBidByIdFromRepository(testDb.db, "1");

    const external = bid?.attachments.find((attachment) => attachment.name === "External.pdf");

    expect(external?.url).toBe("/api/bids/1/attachments/external_attachment");
    expect(external?.originalUrl).toBe("https://example.gov/files/external.pdf");
    expect(bid?.attachments.find((attachment) => attachment.name === "Local.pdf")?.url).toBe(
      "/api/bids/1/attachments/local_attachment",
    );
  });

  it("prefers archived local attachment paths and exposes archive metadata", async () => {
    const timestamp = "2026-05-28T00:00:00.000Z";
    testDb.db.insert(bidAttachments)
      .values({
        id: "archived_attachment",
        bidId: "1",
        name: "Archived Solicitation.pdf",
        url: "https://agency.example.gov/files/solicitation.pdf",
        originalUrl: "https://agency.example.gov/files/solicitation.pdf",
        storagePath: "data/attachments/agency/solicitation.pdf",
        byteSize: 4096,
        contentType: "application/pdf",
        checksumSha256: "sha256-value",
        fetchedAt: timestamp,
        archiveStatus: "archived",
        sizeLabel: "4 KB",
        sortOrder: 102,
        createdAt: timestamp,
      })
      .run();
    testDb.db.update(bidRows)
      .set({
        sourceConfidence: "high",
        qualityFlagsJson: JSON.stringify(["missing_deadline"]),
        adminReviewStatus: "needs_review",
        detailArchiveStatus: "archived",
        detailArchivePath: "data/attachments/details/bid-1.html",
        detailFetchedAt: timestamp,
        detailChecksumSha256: "detail-sha256",
      })
      .where(eq(bidRows.id, "1"))
      .run();

    const bid = await getBidByIdFromRepository(testDb.db, "1");
    const attachment = bid?.attachments.find((item) => item.name === "Archived Solicitation.pdf");

    expect(attachment).toMatchObject({
      url: "/api/bids/1/attachments/archived_attachment",
      originalUrl: "https://agency.example.gov/files/solicitation.pdf",
      archiveStatus: "archived",
      storagePath: "data/attachments/agency/solicitation.pdf",
      byteSize: 4096,
        contentType: "application/pdf",
        checksumSha256: "sha256-value",
        fetchedAt: timestamp,
        archiveError: "",
      });
    expect(bid).toMatchObject({
      sourceConfidence: "high",
      qualityFlags: ["missing_deadline"],
      adminReviewStatus: "needs_review",
      detailArchiveStatus: "archived",
      detailArchivePath: "data/attachments/details/bid-1.html",
      detailFetchedAt: timestamp,
      detailChecksumSha256: "detail-sha256",
      detailArchiveError: "",
    });
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
    testDb.db.update(users)
      .set({ accountTier: "business" })
      .where(eq(users.id, owner.user.id))
      .run();
    expect(owner.user.workspace).toBeDefined();
    testDb.db.update(organizations)
      .set({ accountTier: "business" })
      .where(eq(organizations.id, owner.user.workspace!.organizationId))
      .run();
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
