"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  fetchSavedBids,
  removeSavedBid,
  saveBid as saveBidRequest,
} from "@/lib/api/bids";
import { useAuth } from "@/context/AuthContext";
import type { Bid } from "@/lib/mock-data";

interface SavedBidsContextType {
  savedBidIds: string[];
  savedBids: Bid[];
  isLoading: boolean;
  error: string | null;
  toggleSaveBid: (id: string) => Promise<void>;
  isSaved: (id: string) => boolean;
}

const SavedBidsContext = createContext<SavedBidsContextType | undefined>(undefined);

export function SavedBidsProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [savedBidIds, setSavedBidIds] = useState<string[]>([]);
  const [savedBids, setSavedBids] = useState<Bid[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(false);
  const operationQueueRef = useRef(Promise.resolve());
  const savedBidIdsRef = useRef<string[]>([]);
  const pendingBidIdsRef = useRef<Set<string>>(new Set());

  const applySavedBidsResponse = useCallback((response: { savedBidIds: string[]; bids: Bid[] }) => {
    savedBidIdsRef.current = response.savedBidIds;

    if (!isMountedRef.current) {
      return;
    }

    setSavedBidIds(response.savedBidIds);
    setSavedBids(response.bids);
    setError(null);
  }, []);

  const enqueueOperation = useCallback((operation: () => Promise<void>) => {
    const nextOperation = operationQueueRef.current.then(operation, operation);
    operationQueueRef.current = nextOperation.catch(() => undefined);

    return nextOperation;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (isAuthLoading) {
      return () => {
        isMountedRef.current = false;
      };
    }

    if (!user) {
      savedBidIdsRef.current = [];
      return () => {
        isMountedRef.current = false;
      };
    }

    enqueueOperation(async () => {
      if (isMountedRef.current) {
        setIsLoading(true);
      }

      try {
        const response = await fetchSavedBids();
        applySavedBidsResponse(response);
      } catch (err) {
        if (isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load saved bids");
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [applySavedBidsResponse, enqueueOperation, isAuthLoading, user]);

  const toggleSaveBid = useCallback(
    async (id: string) => {
      if (!user) {
        setError("Sign in to save bids");
        return;
      }

      if (pendingBidIdsRef.current.has(id)) {
        return;
      }

      pendingBidIdsRef.current.add(id);

      await enqueueOperation(async () => {
        try {
          const response = savedBidIdsRef.current.includes(id)
            ? await removeSavedBid(id)
            : await saveBidRequest(id);

          applySavedBidsResponse(response);
        } catch (err) {
          if (isMountedRef.current) {
            setError(err instanceof Error ? err.message : "Failed to update saved bids");
          }
        } finally {
          pendingBidIdsRef.current.delete(id);
        }
      }).catch(() => undefined);
    },
    [applySavedBidsResponse, enqueueOperation, user],
  );

  const isSaved = useCallback((id: string) => savedBidIds.includes(id), [savedBidIds]);
  const exposedSavedBidIds = user ? savedBidIds : [];
  const exposedSavedBids = user ? savedBids : [];
  const exposedIsLoading = isAuthLoading || (user ? isLoading : false);
  const exposedError = user ? error : null;
  const exposedIsSaved = useCallback(
    (id: string) => (user ? isSaved(id) : false),
    [isSaved, user],
  );

  return (
    <SavedBidsContext.Provider
      value={{
        savedBidIds: exposedSavedBidIds,
        savedBids: exposedSavedBids,
        isLoading: exposedIsLoading,
        error: exposedError,
        toggleSaveBid,
        isSaved: exposedIsSaved,
      }}
    >
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
