import { describe, expect, it } from "vitest";
import { PRECHECK_REQUEST_CHUNK, RUN_NOW_LIMIT, runTargets, summarizeRunResults } from "./source-bulk-actions";

describe("source bulk actions", () => {
  it("resolves crawler run ids and reports the rows without one", () => {
    expect(
      runTargets([
        { id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null },
        { id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null },
        { id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      ]),
    ).toEqual({ runIds: ["bidnet_co_denver", "ca_caleprocure"], skippedIds: ["sam_gov"] });
    expect(RUN_NOW_LIMIT).toBe(20);
  });

  it("summarises a run response", () => {
    expect(
      summarizeRunResults({
        ok: false,
        status: "completed_with_failures",
        results: [
          { source: "a", ok: true, status: "success" },
          { source: "b", ok: false, status: "failure" },
          { source: "c", ok: false, status: "blocked" },
          { source: "d", ok: false, status: "deferred" },
        ],
        errors: [{ source: "e", code: "UNKNOWN_SOURCE", message: "unknown" }],
      }),
    ).toEqual({ ok: 1, failed: 2, skipped: 2 });
  });
});

describe("source bulk actions, edge cases", () => {
  it("keeps the spec limits: 500 ids per precheck request, 20 sources per run", () => {
    expect(PRECHECK_REQUEST_CHUNK).toBe(500);
    expect(RUN_NOW_LIMIT).toBe(20);
  });

  it("runs a crawler id once when two selected rows resolve to it", () => {
    expect(
      runTargets([
        { id: "a", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
        { id: "b", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      ]),
    ).toEqual({ runIds: ["ca_caleprocure"], skippedIds: [] });
  });

  it("has nothing to run and nothing to report for an empty selection", () => {
    expect(runTargets([])).toEqual({ runIds: [], skippedIds: [] });
  });

  it("counts every non-success, non-failure status as skipped and a run with no errors field as clean", () => {
    expect(
      summarizeRunResults({
        ok: true,
        status: "completed",
        results: [
          { source: "a", ok: true, status: "success" },
          { source: "b", ok: false, status: "locked" },
          { source: "c", ok: false, status: "disabled" },
          { source: "d", ok: false, status: "something_new" },
        ],
      }),
    ).toEqual({ ok: 1, failed: 0, skipped: 3 });
    expect(summarizeRunResults({ ok: true, status: "completed", results: [] })).toEqual({ ok: 0, failed: 0, skipped: 0 });
  });

  it("counts an unknown-source error as a failure even when no result came back", () => {
    expect(
      summarizeRunResults({
        ok: false,
        status: "failed",
        results: [],
        errors: [{ source: "x", code: "UNKNOWN_SOURCE", message: "unknown" }, { source: "y", code: "UNKNOWN_SOURCE", message: "unknown" }],
      }),
    ).toEqual({ ok: 0, failed: 2, skipped: 0 });
  });
});
