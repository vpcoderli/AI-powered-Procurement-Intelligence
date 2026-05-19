import { MOCK_BIDS, type Bid } from "@/lib/mock-data";

let bids = cloneBids(MOCK_BIDS);

function cloneBids(source: Bid[]) {
  return source.map((bid) => ({ ...bid, attachments: [...bid.attachments], tags: [...bid.tags] }));
}

export function listBids(savedBidIds: string[] = []) {
  return bids.map((bid) => ({ ...bid, saved: savedBidIds.includes(bid.id) }));
}

export function getBidByIdFromRepository(id: string) {
  return listBids().find((bid) => bid.id === id);
}

export function resetBidRepositoryForTests() {
  bids = cloneBids(MOCK_BIDS);
}
