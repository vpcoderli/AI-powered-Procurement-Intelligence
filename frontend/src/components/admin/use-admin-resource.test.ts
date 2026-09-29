import { describe, expect, it } from "vitest";
import { resourceFailed, resourceLoading, resourceReady } from "./use-admin-resource";

describe("admin resource transitions", () => {
  it("keeps the previous data while loading and after a failure", () => {
    const ready = resourceReady([1, 2]);
    expect(ready).toEqual({ status: "ready", data: [1, 2], error: null });
    expect(resourceLoading(ready)).toEqual({ status: "loading", data: [1, 2], error: null });
    const boom = new Error("boom");
    expect(resourceFailed(ready, boom)).toEqual({ status: "error", data: [1, 2], error: boom });
    expect(resourceFailed({ status: "loading", data: null, error: null }, boom).data).toBeNull();
  });
});
