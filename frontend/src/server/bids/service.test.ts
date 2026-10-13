import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import type { Bid } from "./domain";
import {
  getBidByIdFromRepository,
  listBids,
  listBidsFromMysql,
  listSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";
import { toServerBidFixture } from "./test-fixtures";
import {
  getBidById,
  getSavedBids,
  queryBids,
  queryBidsFromDatabase,
  queryBidsFromMysql,
  removeSavedBid,
  saveBid,
} from "./service";

vi.mock("./repository", () => ({
  getBidByIdFromRepository: vi.fn(),
  listBids: vi.fn(),
  listBidsFromMysql: vi.fn(),
  listSavedBidIds: vi.fn(),
  removeSavedBidId: vi.fn(),
  saveSavedBidId: vi.fn(),
}));

// The saved-bid scope is the user's workspace, which `savedBidScope` reads through the process-wide `db`. In a fresh
// checkout that is an empty, unmigrated file with no `users` table, so these tests would only pass where a developer
// happens to have a migrated database. They are about the saved ids handed to the repository, not about workspaces
// (account/workspace.test.ts covers those), so an anonymous user's scope is the user alone.
vi.mock("@/server/account/workspace", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/account/workspace")>()),
  listWorkspaceMemberUserIds: vi.fn((_database: unknown, userId: string) => [userId]),
}));

const repositoryListBids = vi.mocked(listBids);
const repositoryListBidsFromMysql = vi.mocked(listBidsFromMysql);
const repositoryGetBidById = vi.mocked(getBidByIdFromRepository);
const repositoryListSavedBidIds = vi.mocked(listSavedBidIds);
const repositorySaveSavedBidId = vi.mocked(saveSavedBidId);
const repositoryRemoveSavedBidId = vi.mocked(removeSavedBidId);

function cloneBids(savedBidIds: string[] = []): Bid[] {
  return MOCK_BIDS.map((bid) =>
    toServerBidFixture({
      ...bid,
      attachments: [...bid.attachments],
      tags: [...bid.tags],
      saved: savedBidIds.includes(bid.id),
    }),
  );
}

function bidById(id: string) {
  return cloneBids().find((bid) => bid.id === id);
}

describe("bid service", () => {
  it.each(["sqlite", "mysql"])("filters DC local bids without accepting another state's District source in %s", async (database) => {
    const fixture = toServerBidFixture(MOCK_BIDS[0]);
    const bids: Bid[] = [
      { ...fixture, id: "dc_local", issuerType: "county", stateCode: "DC", source: "District of Columbia procurement" },
      { ...fixture, id: "ca_district", issuerType: "county", stateCode: "CA", source: "California School District procurement" },
    ];
    repositoryListBids.mockResolvedValue(bids);
    repositoryListBidsFromMysql.mockResolvedValue(bids);
    const result = database === "sqlite"
      ? await queryBidsFromDatabase({} as never, { states: ["DC"], issuerType: "county" })
      : await queryBidsFromMysql({} as never, { states: ["DC"], issuerType: "county" });
    expect(result.bids.map((bid) => bid.id)).toEqual(["dc_local"]);
  });

  it.each(["sqlite", "mysql"])("uses registered geography over an agency name mentioning a different state in %s", async (database) => {
    const fixture = toServerBidFixture(MOCK_BIDS[0]);
    const bids: Bid[] = [{ ...fixture, id: "ny_local", issuerType: "city", stateCode: "NY", source: "California City Procurement" }];
    repositoryListBids.mockResolvedValue(bids);
    repositoryListBidsFromMysql.mockResolvedValue(bids);
    const result = database === "sqlite"
      ? await queryBidsFromDatabase({} as never, { states: ["CA"], issuerType: "city" })
      : await queryBidsFromMysql({} as never, { states: ["CA"], issuerType: "city" });
    expect(result.bids).toHaveLength(0);
  });

  const referenceDate = new Date("2026-05-18T00:00:00");
  const query = (params: Parameters<typeof queryBids>[0]) =>
    queryBids(params, { referenceDate });

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryListBids.mockImplementation(async (_db, savedIds = []) => cloneBids(savedIds));
    repositoryListBidsFromMysql.mockImplementation(async (_mysql, savedIds = []) => cloneBids(savedIds));
    repositoryGetBidById.mockImplementation(async (_db, id) => bidById(id));
    repositoryListSavedBidIds.mockResolvedValue([]);
    repositorySaveSavedBidId.mockResolvedValue([]);
    repositoryRemoveSavedBidId.mockResolvedValue([]);
  });

  it("returns all active bids by default", async () => {
    const result = await query({});

    expect(result.total).toBe(6);
    expect(result.bids.every((bid) => bid.isActive)).toBe(true);
  });

  it("queries bids from an injected database", async () => {
    const injectedDb = { injected: true } as never;

    const result = await queryBidsFromDatabase(injectedDb, { q: "cloud" }, { referenceDate });

    expect(result.bids.map((bid) => bid.title)).toEqual([
      "Enterprise Cloud Migration Services",
      "Healthcare Data Analytics Platform",
    ]);
    expect(repositoryListBids).toHaveBeenCalledWith(injectedDb);
  });

  it("queries bids from an injected MySQL reader", async () => {
    const mysql = { query: vi.fn() };

    const result = await queryBidsFromMysql(mysql, { q: "cloud" }, { referenceDate });

    expect(result.bids.map((bid) => bid.title)).toEqual([
      "Enterprise Cloud Migration Services",
      "Healthcare Data Analytics Platform",
    ]);
    expect(repositoryListBidsFromMysql).toHaveBeenCalledWith(mysql);
  });

  it("filters bids by keyword across searchable fields", async () => {
    const result = await query({ q: "cloud" });

    expect(result.bids.map((bid) => bid.title)).toEqual([
      "Enterprise Cloud Migration Services",
      "Healthcare Data Analytics Platform",
    ]);
  });

  it("matches keywords that only appear in the full description", async () => {
    const fullDescriptionOnlyBid: Bid = {
      ...cloneBids()[0],
      id: "full-desc-only",
      title: "Unrelated Title",
      description: "Short lead text that does not mention the term.",
      fullDescription: "Deep within the verbatim detail text is the phrase zephyrgrove-compliance.",
      tags: [],
    };
    repositoryListBids.mockImplementation(async () => [fullDescriptionOnlyBid]);
    repositoryListBidsFromMysql.mockImplementation(async () => [fullDescriptionOnlyBid]);

    const result = await query({ q: "zephyrgrove-compliance" });

    expect(result.bids.map((bid) => bid.id)).toEqual(["full-desc-only"]);
  });

  it("filters bids by state or federal source id", async () => {
    expect((await query({ states: ["sam"] })).bids.map((bid) => bid.id)).toEqual([
      "1",
    ]);
    expect((await query({ states: ["ca"] })).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
    expect((await query({ states: ["CA"] })).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
  });

  it.each(["county", "city", "township", "special_district"] as const)("filters %s precisely while retaining state geography in both database paths", async (issuerType) => {
    const fixture = toServerBidFixture(MOCK_BIDS[1]);
    const localBids: Bid[] = [
      { ...fixture, id: "local_ca", source: "local_portal", issuerType, stateCode: "CA" },
      { ...fixture, id: "local_ny", source: "local_portal", issuerType, stateCode: "NY" },
      { ...fixture, id: "state_ca", source: "local_portal", issuerType: "state", stateCode: "CA" },
    ];
    repositoryListBids.mockResolvedValue(localBids);
    repositoryListBidsFromMysql.mockResolvedValue(localBids);

    for (const result of [
      await queryBidsFromDatabase({} as never, { states: ["CA"], issuerType }),
      await queryBidsFromMysql({ query: vi.fn() }, { states: ["CA"], issuerType }),
    ]) {
      expect(result.bids.map((bid) => bid.id)).toEqual(["local_ca"]);
      expect(result.filters).toMatchObject({ states: ["ca"], issuerType });
    }
    expect((await query({ states: ["CA"], issuerType: "all" })).bids.map((bid) => bid.id)).toEqual(["local_ca", "state_ca"]);
    expect((await query({ states: ["CA"], issuerType: "state" })).bids.map((bid) => bid.id)).toEqual(["state_ca"]);
  });

  it("filters bids by issuer type", async () => {
    const federal = await query({ issuerType: "federal" });
    const state = await query({ issuerType: "state" });

    expect(federal.bids.map((bid) => bid.id)).toEqual(["1"]);
    expect(state.bids).toHaveLength(5);
  });

  it("filters bids by deadline and published date presets", async () => {
    expect((await query({ deadline: "next7" })).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
    expect((await query({ deadline: "next30" })).bids.map((bid) => bid.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect((await query({ published: "last24" })).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
    expect((await query({ published: "last7" })).bids.map((bid) => bid.id)).toEqual([
      "2",
      "5",
      "6",
    ]);
  });

  it("sorts by newest published date and soonest deadline", async () => {
    expect((await query({ sort: "newest" })).bids.map((bid) => bid.id)).toEqual([
      "2",
      "6",
      "5",
      "4",
      "3",
      "1",
    ]);
    expect((await query({ sort: "deadline" })).bids.map((bid) => bid.id)).toEqual([
      "2",
      "3",
      "1",
      "5",
      "6",
      "4",
    ]);
  });

  it("returns a bid by id or undefined", async () => {
    await expect(getBidById("1")).resolves.toMatchObject({
      title: "Enterprise Cloud Migration Services",
    });
    await expect(getBidById("missing")).resolves.toBeUndefined();
  });

  it("returns saved bids for one user", async () => {
    repositoryListSavedBidIds.mockImplementation(async (_db, userId) =>
      userId === "anon_a" ? ["1"] : [],
    );

    expect((await getSavedBids("anon_a")).savedBidIds).toEqual(["1"]);
    expect((await getSavedBids("anon_b")).savedBidIds).toEqual([]);
  });

  it("saves an existing bid idempotently for one user", async () => {
    repositorySaveSavedBidId.mockResolvedValue(["1"]);
    repositoryListSavedBidIds.mockResolvedValue(["1"]);

    const first = await saveBid("anon_a", "1");
    const second = await saveBid("anon_a", "1");

    expect(repositorySaveSavedBidId).toHaveBeenCalledWith(
      expect.anything(),
      "anon_a",
      "1",
      ["anon_a"],
    );
    expect(first.savedBidIds).toEqual(["1"]);
    expect(second.savedBidIds).toEqual(["1"]);
    expect(second.bids.map((bid) => bid.id)).toEqual(["1"]);
  });

  it("rejects saving an unknown bid", async () => {
    await expect(saveBid("anon_a", "missing")).rejects.toThrow("Bid not found");
    expect(repositorySaveSavedBidId).not.toHaveBeenCalled();
  });

  it("removes a saved bid idempotently for one user", async () => {
    repositoryListSavedBidIds.mockResolvedValue([]);

    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
    expect(repositoryRemoveSavedBidId).toHaveBeenCalledWith(
      expect.anything(),
      "anon_a",
      "2",
      ["anon_a"],
    );
  });

  it("removes a saved bid for one user without affecting another user", async () => {
    repositoryListSavedBidIds.mockImplementation(async (_db, userId) =>
      userId === "anon_b" ? ["2"] : [],
    );

    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
    expect((await getSavedBids("anon_b")).savedBidIds).toEqual(["2"]);
  });

  it("finds a bid by its solicitation number", async () => {
    repositoryListBids.mockImplementationOnce(async () => [
      { ...cloneBids()[0], id: "bidnet_co_denver:0000435942", title: "Jail and Courthouse Security Systems", solicitationNumber: "1049A-2026" } as Bid,
    ]);

    const result = await queryBidsFromDatabase({ injected: true } as never, { q: "1049a-2026" }, { referenceDate });

    expect(result.bids.map((bid) => bid.id)).toEqual(["bidnet_co_denver:0000435942"]);
  });
});
