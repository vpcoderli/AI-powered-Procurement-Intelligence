import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids } from "@/server/db/schema";
import { getBidByIdFromMysql, getBidByIdFromRepository, listBids, listBidsFromMysql } from "./repository";
import { queryBidsFromDatabase, queryBidsFromMysql } from "./service";
import { getBidUsability } from "@/lib/bid-usability";

describe("public bid usability gates", () => {
  let testDb: TestDatabase;
  beforeEach(async () => { testDb = await createTestDatabase({ seed: true }); });
  afterEach(async () => { await testDb.cleanup(); });

  it.each([
    { title: "Untitled opportunity" },
    { issuerName: "Unknown issuer" },
    { issuerType: "unknown" },
    { issuerType: "city", stateCode: "US" },
    { stateCode: "ZZ" },
    { sourceUrl: "" },
    { sourceUrl: "https://user:secret@agency.example.gov/opp/1" },
    { sourceUrl: "javascript:alert(1)" },
  ])("withholds malformed legacy core records from list, saved-state retrieval and direct detail: %j", async (patch) => {
    testDb.db.update(bids).set(patch).where(eq(bids.id, "1")).run();
    expect((await listBids(testDb.db, ["1"])).map((bid) => bid.id)).not.toContain("1");
    expect(await getBidByIdFromRepository(testDb.db, "1")).toBeUndefined();
    expect((await queryBidsFromDatabase(testDb.db, {})).bids.map((bid) => bid.id)).not.toContain("1");
  });

  it("applies the same legacy gate to MySQL list, saved-state and detail reads", async () => {
    const bad = { ...testDb.db.select().from(bids).where(eq(bids.id, "1")).get()!, title: "Untitled" };
    const mysql = { async query(sql: string) { return [sql.includes("FROM bid_attachments") ? [] : [bad]] as [typeof bad[]]; } };
    expect(await listBidsFromMysql(mysql, [bad.id])).toEqual([]);
    expect(await getBidByIdFromMysql(mysql, bad.id)).toBeUndefined();
    expect((await queryBidsFromMysql(mysql, {})).total).toBe(0);
  });

  it("keeps a core-valid opportunity searchable when its body, deadline or contact is missing", async () => {
    testDb.db.update(bids).set({ description: "", fullDescription: null, deadlineDate: null, contactName: null })
      .where(eq(bids.id, "1")).run();
    expect((await queryBidsFromDatabase(testDb.db, {})).bids.map((bid) => bid.id)).toContain("1");
    expect(await getBidByIdFromRepository(testDb.db, "1")).toBeDefined();
  });

  it("ignores invalid body noise in keyword search", async () => {
    testDb.db.update(bids).set({ description: "Please log in to view the solicitation details.", fullDescription: null })
      .where(eq(bids.id, "1")).run();
    expect((await queryBidsFromDatabase(testDb.db, { q: "log in" })).total).toBe(0);
  });

  it("does not render legacy contact metadata as a contact person", async () => {
    testDb.db.update(bids).set({ contactName: "Purchase Method: Open Market" }).where(eq(bids.id, "1")).run();
    const bid = await getBidByIdFromRepository(testDb.db, "1");
    expect(bid).toBeDefined();
    expect(bid?.contactName).toBe("");
  });

  it("keeps real source identity and retained body verification available to actual consumers", async () => {
    const verifiedAt = "2026-09-01T00:00:00Z";
    testDb.db.update(bids).set({ sourceUrl: "https://agency.example.gov/", updatedAt: "2026-10-01T00:00:00Z", rawPayload: JSON.stringify({
      source_bid_id: "PUMP-1", data_quality: {
        schemaVersion: 1, checkedAt: "2026-10-01T00:00:00Z", coreValid: true, coreIssues: [],
        capabilities: { discovery: true, analysis: true, attachments: false },
        body: { valid: true, reason: "valid_body", verifiedAt, reused: true },
        attachments: { discovered: 2, archived: 0, verified: 0 },
      },
    }) }).where(eq(bids.id, "1")).run();
    const bid = await getBidByIdFromRepository(testDb.db, "1");
    expect(bid).toBeDefined();
    expect(getBidUsability(bid!)).toMatchObject({ analysis: true, bodyVerifiedAt: verifiedAt, bodyReused: true });
  });

  it("uses normalized database source identity when the raw portal payload has no normalized fields", async () => {
    testDb.db.update(bids).set({ sourceUrl: "https://agency.example.gov/", sourceBidId: "PUMP-1", rawPayload: null })
      .where(eq(bids.id, "1")).run();
    const bid = await getBidByIdFromRepository(testDb.db, "1");
    expect(bid).toBeDefined();
    expect(bid?.sourceBidId).toBe("PUMP-1");
    expect(getBidUsability(bid!)).toMatchObject({ analysis: true });
  });
});
