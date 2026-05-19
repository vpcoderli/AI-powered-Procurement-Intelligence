import { STATE_FILTERS } from "@/lib/mock-data";
import { db } from "@/server/db/client";
import type { Bid } from "./domain";
import {
  getBidByIdFromRepository,
  listBids,
  listSavedBidIds,
  removeSavedBidId,
  saveSavedBidId,
} from "./repository";
import {
  BidNotFoundError,
  type BidListResponse,
  type BidQuery,
  type BidQueryOptions,
  type DeadlinePreset,
  type NormalizedBidQuery,
  type PublishedPreset,
  type SavedBidsResponse,
} from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeQuery(query: BidQuery): NormalizedBidQuery {
  return {
    q: query.q?.trim().toLowerCase() ?? "",
    states: query.states ?? [],
    issuerType: query.issuerType ?? "all",
    deadline: query.deadline ?? "any",
    published: query.published ?? "any",
    sort: query.sort ?? "relevance",
  };
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function daysBetween(fromDate: Date, toDate: Date) {
  return Math.round((toDate.getTime() - fromDate.getTime()) / MS_PER_DAY);
}

function matchesKeyword(bid: Bid, q: string) {
  if (q === "") return true;

  return [bid.title, bid.description, bid.issuerName, bid.originalCategory, ...bid.tags]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

function matchesStates(bid: Bid, states: string[]) {
  if (states.length === 0) return true;

  const selectedFilters = STATE_FILTERS.filter((state) => states.includes(state.id));

  return selectedFilters.some(
    (filter) =>
      filter.stateCode === bid.stateCode ||
      filter.label === bid.source ||
      bid.source.includes(filter.stateCode) ||
      bid.source.includes(filter.label.split(" ")[0]),
  );
}

function matchesDeadline(dateString: string, preset: DeadlinePreset, referenceDate: Date) {
  if (preset === "any") return true;

  const days = daysBetween(referenceDate, startOfDay(new Date(dateString)));

  if (preset === "next7") return days >= 0 && days <= 7;
  if (preset === "next30") return days >= 0 && days <= 30;
  return true;
}

function matchesPublished(dateString: string, preset: PublishedPreset, referenceDate: Date) {
  if (preset === "any") return true;

  const days = daysBetween(startOfDay(new Date(dateString)), referenceDate);

  if (preset === "last24") return days >= 0 && days <= 1;
  if (preset === "last7") return days >= 0 && days <= 7;
  return true;
}

function sortBids(bids: Bid[], sort: NormalizedBidQuery["sort"]) {
  if (sort === "deadline") {
    return [...bids].sort(
      (a, b) => new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime(),
    );
  }

  if (sort === "newest") {
    return [...bids].sort(
      (a, b) => new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime(),
    );
  }

  return bids;
}

async function savedBidsResponse(userId: string): Promise<SavedBidsResponse> {
  const savedIds = await listSavedBidIds(db, userId);
  const savedIdSet = new Set(savedIds);
  const bids = await listBids(db, savedIds);

  return {
    savedBidIds: savedIds,
    bids: bids.filter((bid) => savedIdSet.has(bid.id)),
  };
}

export async function queryBids(
  query: BidQuery,
  options: BidQueryOptions = {},
): Promise<BidListResponse> {
  const filters = normalizeQuery(query);
  const referenceDate = startOfDay(options.referenceDate ?? new Date());
  const allBids = await listBids(db);
  const filteredBids = allBids.filter(
    (bid) =>
      bid.isActive &&
      matchesKeyword(bid, filters.q) &&
      matchesStates(bid, filters.states) &&
      (filters.issuerType === "all" || bid.issuerType === filters.issuerType) &&
      matchesDeadline(bid.deadlineDate, filters.deadline, referenceDate) &&
      matchesPublished(bid.publishedDate, filters.published, referenceDate),
  );
  const bids = sortBids(filteredBids, filters.sort);

  return {
    bids,
    total: bids.length,
    filters,
  };
}

export async function getBidById(id: string): Promise<Bid | undefined> {
  return getBidByIdFromRepository(db, id);
}

export async function getSavedBids(userId: string): Promise<SavedBidsResponse> {
  return savedBidsResponse(userId);
}

export async function saveBid(userId: string, id: string): Promise<SavedBidsResponse> {
  if (!(await getBidById(id))) {
    throw new BidNotFoundError();
  }

  await saveSavedBidId(db, userId, id);

  return savedBidsResponse(userId);
}

export async function removeSavedBid(userId: string, id: string): Promise<SavedBidsResponse> {
  await removeSavedBidId(db, userId, id);

  return savedBidsResponse(userId);
}
