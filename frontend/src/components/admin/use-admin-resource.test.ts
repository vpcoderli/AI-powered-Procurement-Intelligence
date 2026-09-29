import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resourceFailed,
  resourceLoading,
  resourceReady,
  resourceUpdated,
  type AdminResourceState,
} from "./use-admin-resource";

describe("admin resource transitions", () => {
  it("keeps the previous data while loading and after a failure", () => {
    const ready = resourceReady([1, 2]);
    expect(ready).toEqual({ status: "ready", data: [1, 2], error: null });
    expect(resourceLoading(ready)).toEqual({ status: "loading", data: [1, 2], error: null });
    const boom = new Error("boom");
    expect(resourceFailed(ready, boom)).toEqual({ status: "error", data: [1, 2], error: boom });
    expect(resourceFailed({ status: "loading", data: null, error: null }, boom).data).toBeNull();
  });

  describe("resourceUpdated", () => {
    const append = (data: number[] | null) => [...(data ?? []), 3];

    it("clears a stale refresh failure when a write lands (error becomes ready)", () => {
      const failed = resourceFailed(resourceReady([1, 2]), new Error("boom"));
      expect(resourceUpdated(failed, append)).toEqual({ status: "ready", data: [1, 2, 3], error: null });
    });

    it("keeps a reload that is in flight as loading, with the written data", () => {
      const loading = resourceLoading(resourceReady([1, 2]));
      expect(resourceUpdated(loading, append)).toEqual({ status: "loading", data: [1, 2, 3], error: null });
    });

    it("keeps a ready resource ready", () => {
      expect(resourceUpdated(resourceReady([1, 2]), append)).toEqual({ status: "ready", data: [1, 2, 3], error: null });
    });

    it("hands the previous data to the update, null included, and keeps a null result", () => {
      const seen: Array<number[] | null> = [];
      const empty: AdminResourceState<number[]> = { status: "loading", data: null, error: null };
      expect(
        resourceUpdated(empty, (data) => {
          seen.push(data);
          return null;
        }),
      ).toEqual({ status: "loading", data: null, error: null });
      expect(seen).toEqual([null]);
    });

    it("does not mutate the previous state", () => {
      const failed = resourceFailed(resourceReady([1, 2]), new Error("boom"));
      const snapshot = { ...failed };
      resourceUpdated(failed, append);
      expect(failed).toEqual(snapshot);
    });
  });
});

describe("useAdminResource source", () => {
  const source = readFileSync(new URL("use-admin-resource.ts", import.meta.url), "utf8");

  // `reload` runs from a handler that captured it at click time, so it must read the newest loader
  // (and therefore the newest filters) from a ref instead of closing over the render's `load`.
  function reloadCallbackSource() {
    const start = source.indexOf("const reload = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("useEffect(", start);
    expect(end).toBeGreaterThan(start);
    return source.slice(start, end).trimEnd();
  }

  it("reloads with the latest loader and keeps reload's identity stable", () => {
    const reload = reloadCallbackSource();
    expect(reload).toContain("await loadRef.current()");
    // Never the loader captured by the render that created this callback.
    expect(reload).not.toMatch(/(?<![.\w])load\(/);
    // `}, []);` is the end of reload's own useCallback: an empty dependency list.
    expect(reload).toMatch(/\}, \[\]\);$/);
  });

  it("writes the loader ref only inside an effect, on every `load` change", () => {
    expect(source).toMatch(/useEffect\(\(\) => \{\s*loadRef\.current = load;\s*\}, \[load\]\);/);
  });

  it("starts a load on mount and whenever `load` changes, deferred to a microtask", () => {
    expect(source).toContain("}, [load, reload]);");
    expect(source).toContain("queueMicrotask(");
    // No option can hold the first load back (an `enabled: false` resource stayed "loading" forever).
    expect(source).toContain("export function useAdminResource<T>(load: () => Promise<T>) {");
    expect(source).not.toContain("enabled");
  });

  it("clears a stale failure through resourceUpdated when data is written", () => {
    expect(source).toContain("setState((previous) => resourceUpdated(previous, update))");
  });
});
