import { MOCK_BIDS, type Bid } from "@/lib/mock-data";

let bids = cloneBids(MOCK_BIDS);
let savedBidIds = initialSavedBidIds(bids);

function cloneBids(source: Bid[]) {
  return source.map((bid) => ({ ...bid, attachments: [...bid.attachments], tags: [...bid.tags] }));
}

function initialSavedBidIds(source: Bid[]) {
  return source.filter((bid) => bid.saved).map((bid) => bid.id);
}

function withSavedState(bid: Bid) {
  return { ...bid, saved: savedBidIds.includes(bid.id) };
}

export function listBids() {
  return bids.map(withSavedState);
}

export function getSavedBidIds() {
  return [...savedBidIds];
}

export function replaceSavedBidIds(nextSavedBidIds: string[]) {
  savedBidIds = [...nextSavedBidIds];
}

export function resetBidRepositoryForTests() {
  bids = cloneBids(MOCK_BIDS);
  savedBidIds = initialSavedBidIds(bids);
}
