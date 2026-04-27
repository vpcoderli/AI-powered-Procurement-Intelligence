"use client";

import { useMemo } from "react";
import { MOCK_BIDS } from "@/lib/mock-data";
import { BidCard } from "@/components/bids/BidCard";
import { useSavedBids } from "@/context/SavedBidsContext";
import { Bookmark, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function SavedBidsPage() {
  const { savedBidIds } = useSavedBids();

  const savedBids = useMemo(() => {
    return MOCK_BIDS.filter(bid => savedBidIds.includes(bid.id));
  }, [savedBidIds]);

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
        <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
          <Bookmark size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Saved Bids</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            You have {savedBids.length} saved {savedBids.length === 1 ? 'bid' : 'bids'}.
          </p>
        </div>
      </div>

      {savedBids.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
          {savedBids.map(bid => (
            <BidCard key={bid.id} bid={bid} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50/50 mt-4">
          <div className="h-16 w-16 bg-white border border-slate-100 shadow-sm rounded-full flex items-center justify-center text-slate-400 mb-5">
            <Bookmark size={28} />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">No saved bids yet</h2>
          <p className="text-slate-500 font-medium max-w-md mb-8">
            Keep track of interesting opportunities by clicking the save icon on any bid card in the search dashboard.
          </p>
          <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-11">
            <Link href="/">
              <Search className="mr-2 h-4 w-4" /> Browse Bids
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}