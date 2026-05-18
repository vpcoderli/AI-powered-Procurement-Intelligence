import { STATE_FILTERS, type Bid } from "@/lib/mock-data";
import { getSavedBidIds, listBids, replaceSavedBidIds } from "./repository";
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

function savedBidsResponse(): SavedBidsResponse {
  const savedIds = getSavedBidIds();
  const savedIdSet = new Set(savedIds);

  return {
    savedBidIds: savedIds,
    bids: listBids().filter((bid) => savedIdSet.has(bid.id)),
  };
}

export function queryBids(query: BidQuery, options: BidQueryOptions = {}): BidListResponse {
  const filters = normalizeQuery(query);
  const referenceDate = startOfDay(options.referenceDate ?? new Date());
  const filteredBids = listBids().filter(
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

export function getBidById(id: string) {
  return listBids().find((bid) => bid.id === id);
}

export function getSavedBids() {
  return savedBidsResponse();
}

export function saveBid(id: string) {
  if (!getBidById(id)) {
    throw new BidNotFoundError();
  }

  const savedIds = getSavedBidIds();

  if (!savedIds.includes(id)) {
    replaceSavedBidIds([...savedIds, id]);
  }

  return savedBidsResponse();
}

export function removeSavedBid(id: string) {
  replaceSavedBidIds(getSavedBidIds().filter((savedId) => savedId !== id));

  return savedBidsResponse();
}
