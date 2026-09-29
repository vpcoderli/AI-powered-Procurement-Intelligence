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
 * A local write (`setData`): applies `update` to the data. A write means the section just succeeded
 * at something, so it also clears a stale refresh failure (error becomes ready); a reload in flight
 * stays loading and a ready resource stays ready.
 */
export function resourceUpdated<T>(
  previous: AdminResourceState<T>,
  update: (data: T | null) => T | null,
): AdminResourceState<T> {
  const data = update(previous.data);
  if (previous.status === "error") return { status: "ready", data, error: null };
  return { ...previous, data };
}

/**
 * One admin resource: loads on mount and whenever `load` changes identity (memoize it with
 * useCallback over the filters it reads), keeps the previous data while reloading and after a
 * failure, and drops a response that arrives after a newer request started.
 *
 * `reload` has a stable identity and always runs the newest `load`, so a mutation handler that
 * captured it at click time still reloads with the filters as they are when it runs.
 */
export function useAdminResource<T>(load: () => Promise<T>, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<AdminResourceState<T>>({ status: "loading", data: null, error: null });
  const latestRequest = useRef(0);
  const loadRef = useRef(load);

  // Refs are written in an effect, never during render. This one is declared ahead of the effect
  // that starts a load, so a changed `load` is in the ref before that load runs.
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const reload = useCallback(async () => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setState((previous) => resourceLoading(previous));
    try {
      const data = await loadRef.current();
      if (latestRequest.current === request) setState(resourceReady(data));
    } catch (error) {
      if (latestRequest.current === request) setState((previous) => resourceFailed(previous, error));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => {
      void reload();
    });
  }, [enabled, load, reload]);

  const setData = useCallback((update: (data: T | null) => T | null) => {
    setState((previous) => resourceUpdated(previous, update));
  }, []);

  return { ...state, reload, setData };
}
