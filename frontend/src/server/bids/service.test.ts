import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "./repository";

const savedIdsByUser = new Map<string, string[]>();

vi.mock("./saved-bids-store", () => ({
  savedBidsStore: {
    getSavedBidIds: vi.fn(async (userId: string) => [...(savedIdsByUser.get(userId) ?? [])]),
    saveBidId: vi.fn(async (userId: string, bidId: string) => {
      const ids = savedIdsByUser.get(userId) ?? [];
      const nextIds = ids.includes(bidId) ? ids : [...ids, bidId];
      savedIdsByUser.set(userId, nextIds);
      return [...nextIds];
    }),
    removeBidId: vi.fn(async (userId: string, bidId: string) => {
      const nextIds = (savedIdsByUser.get(userId) ?? []).filter((id) => id !== bidId);
      savedIdsByUser.set(userId, nextIds);
      return [...nextIds];
    }),
  },
}));

import {
  getBidById,
  getSavedBids,
  queryBids,
  removeSavedBid,
  saveBid,
} from "./service";

describe("bid service", () => {
  const referenceDate = new Date("2026-05-18T00:00:00");
  const query = (params: Parameters<typeof queryBids>[0]) =>
    queryBids(params, { referenceDate });

  beforeEach(() => {
    resetBidRepositoryForTests();
    savedIdsByUser.clear();
  });

  it("returns all active bids by default", () => {
    const result = query({});

    expect(result.total).toBe(6);
    expect(result.bids.every((bid) => bid.isActive)).toBe(true);
  });

  it("filters bids by keyword across searchable fields", () => {
    const result = query({ q: "cloud" });

    expect(result.bids.map((bid) => bid.title)).toEqual([
      "Enterprise Cloud Migration Services",
    ]);
  });

  it("filters bids by state or federal source id", () => {
    expect(query({ states: ["sam"] }).bids.map((bid) => bid.id)).toEqual([
      "1",
    ]);
    expect(query({ states: ["ca"] }).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
  });

  it("filters bids by issuer type", () => {
    const federal = query({ issuerType: "federal" });
    const state = query({ issuerType: "state" });

    expect(federal.bids.map((bid) => bid.id)).toEqual(["1"]);
    expect(state.bids).toHaveLength(5);
  });

  it("filters bids by deadline and published date presets", () => {
    expect(query({ deadline: "next7" }).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
    expect(query({ deadline: "next30" }).bids.map((bid) => bid.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(query({ published: "last24" }).bids.map((bid) => bid.id)).toEqual([
      "2",
    ]);
    expect(query({ published: "last7" }).bids.map((bid) => bid.id)).toEqual([
      "2",
      "5",
      "6",
    ]);
  });

  it("sorts by newest published date and soonest deadline", () => {
    expect(query({ sort: "newest" }).bids.map((bid) => bid.id)).toEqual([
      "2",
      "6",
      "5",
      "4",
      "3",
      "1",
    ]);
    expect(query({ sort: "deadline" }).bids.map((bid) => bid.id)).toEqual([
      "2",
      "3",
      "1",
      "5",
      "6",
      "4",
    ]);
  });

  it("returns a bid by id or undefined", () => {
    expect(getBidById("1")?.title).toBe("Enterprise Cloud Migration Services");
    expect(getBidById("missing")).toBeUndefined();
  });

  it("returns saved bids for one user", async () => {
    await saveBid("anon_a", "1");

    expect((await getSavedBids("anon_a")).savedBidIds).toEqual(["1"]);
    expect((await getSavedBids("anon_b")).savedBidIds).toEqual([]);
  });

  it("saves an existing bid idempotently for one user", async () => {
    const first = await saveBid("anon_a", "1");
    const second = await saveBid("anon_a", "1");

    expect(first.savedBidIds).toEqual(["1"]);
    expect(second.savedBidIds).toEqual(["1"]);
    expect(second.bids.map((bid) => bid.id)).toEqual(["1"]);
  });

  it("rejects saving an unknown bid", async () => {
    await expect(saveBid("anon_a", "missing")).rejects.toThrow("Bid not found");
  });

  it("removes a saved bid idempotently for one user", async () => {
    await saveBid("anon_a", "2");

    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
    expect((await removeSavedBid("anon_a", "2")).savedBidIds).toEqual([]);
  });

});
