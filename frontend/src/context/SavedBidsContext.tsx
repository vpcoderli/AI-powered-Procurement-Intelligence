"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { MOCK_BIDS } from "@/lib/mock-data";

interface SavedBidsContextType {
  savedBidIds: string[];
  toggleSaveBid: (id: string) => void;
  isSaved: (id: string) => boolean;
}

const SavedBidsContext = createContext<SavedBidsContextType | undefined>(undefined);

export function SavedBidsProvider({ children }: { children: ReactNode }) {
  // Initialize from MOCK_BIDS that are already saved
  const [savedBidIds, setSavedBidIds] = useState<string[]>([]);

  useEffect(() => {
    // Only run on client side to avoid hydration mismatch if we were using localStorage
    const initialSaved = MOCK_BIDS.filter(bid => bid.saved).map(bid => bid.id);
    setSavedBidIds(initialSaved);
  }, []);

  const toggleSaveBid = (id: string) => {
    setSavedBidIds(prev => 
      prev.includes(id) ? prev.filter(bidId => bidId !== id) : [...prev, id]
    );
  };

  const isSaved = (id: string) => savedBidIds.includes(id);

  return (
    <SavedBidsContext.Provider value={{ savedBidIds, toggleSaveBid, isSaved }}>
      {children}
    </SavedBidsContext.Provider>
  );
}

export function useSavedBids() {
  const context = useContext(SavedBidsContext);
  if (context === undefined) {
    throw new Error("useSavedBids must be used within a SavedBidsProvider");
  }
  return context;
}