"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AdminResourceStatus = "loading" | "error" | "ready";

export interface AdminResourceState<T> {
  status: AdminResourceStatus;
  data: T | null;
  error: unknown;
}

export function resourceLoading<T>(previous: AdminResourceState<T>): AdminResourceState<T> {
  return { status: "loading", data: previous.data, error: null };
}

export function resourceReady<T>(data: T): AdminResourceState<T> {
  return { status: "ready", data, error: null };
}

export function resourceFailed<T>(previous: AdminResourceState<T>, error: unknown): AdminResourceState<T> {
  return { status: "error", data: previous.data, error };
}

/**
 * One admin resource: loads on mount and whenever `load` changes identity (memoize it with
 * useCallback over the filters it reads), keeps the previous data while reloading and after a
 * failure, and drops a response that arrives after a newer request started.
 */
export function useAdminResource<T>(load: () => Promise<T>, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<AdminResourceState<T>>({ status: "loading", data: null, error: null });
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setState((previous) => resourceLoading(previous));
    try {
      const data = await load();
      if (latestRequest.current === request) setState(resourceReady(data));
    } catch (error) {
      if (latestRequest.current === request) setState((previous) => resourceFailed(previous, error));
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => {
      void reload();
    });
  }, [enabled, reload]);

  const setData = useCallback((update: (data: T | null) => T | null) => {
    setState((previous) => ({ ...previous, data: update(previous.data) }));
  }, []);

  return { ...state, reload, setData };
}
