import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import type { Bid } from "./domain";
import {
  getBidByIdFromRepository,
  listBids,
  listSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";
import {
  getBidById,
  getSavedBids,
  queryBids,
  queryBidsFromDatabase,
  removeSavedBid,
  saveBid,
} from "./service";

vi.mock("./repository", () => ({
  getBidByIdFromRepository: vi.fn(),
  listBids: vi.fn(),
  listSavedBidIds: vi.fn(),
  removeSavedBidId: vi.fn(),
  saveSavedBidId: vi.fn(),
}));

const repositoryListBids = vi.mocked(listBids);
const repositoryGetBidById = vi.mocked(getBidByIdFromRepository);
const repositoryListSavedBidIds = vi.mocked(listSavedBidIds);
const repositorySaveSavedBidId = vi.mocked(saveSavedBidId);
const repositoryRemoveSavedBidId = vi.mocked(removeSavedBidId);

function cloneBids(savedBidIds: string[] = []): Bid[] {
  return MOCK_BIDS.map((bid) => ({
    ...bid,
    attachments: [...bid.attachments],
    tags: [...bid.tags],
    saved: savedBidIds.includes(bid.id),
  }));
}

function bidById(id: string) {
  return cloneBids().find((bid) => bid.id === id);
}

describe("bid service", () => {
  const referenceDate = new Date("2026-05-18T00:00:00");
  const query = (params: Parameters<typeof queryBids>[0]) =>
    queryBids(params, { referenceDate });

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryListBids.mockImplementation(async (_db, savedIds = []) => cloneBids(savedIds));
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
    ]);
    expect(repositoryListBids).toHaveBeenCalledWith(injectedDb);
  });

  it("filters bids by keyword across searchable fields", async () => {
    const result = await query({ q: "cloud" });

    expect(result.bids.map((bid) => bid.title)).toEqual([
      "Enterprise Cloud Migration Services",
    ]);
  });

  it("filters bids by state or federal source id", async () => {
    expect((await query({ states: ["sam"] })).bids.map((bid) => bid.id)).toEqual([
      "1",
    ]);
    expect((await query({ states: ["ca"] })).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
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
});
