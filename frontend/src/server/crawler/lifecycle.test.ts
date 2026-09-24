import { describe, expect, it } from "vitest";
import {
  delistedRawPayload,
  delistingApplies,
  mergeLifecycleFields,
  readListPagination,
  sourceBidIdLikePattern,
  withLifecycleMetadata,
} from "./lifecycle";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

function run(metadata: Record<string, unknown> | null, status: "success" | "failure" = "success"): CrawlerJsonRunPayload {
  return { source: "bidnet_co_denver", runId: "r", status, startedAt: "2026-09-24T00:00:00.000Z", metadata, bids: [] };
}

describe("mergeLifecycleFields", () => {
  it("keeps is_active equal to an open lifecycle", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields({ lifecycle_status: "closed" })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({ is_active: 0 })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({})).toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("never downgrades an awarded bid to closed, but lets the open list reopen it", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "closed" }, { lifecycle_status: "awarded", awarded_date: "07/09/2026" }))
      .toMatchObject({ lifecycle_status: "awarded", is_active: 0, awarded_date: "07/09/2026" });
    expect(mergeLifecycleFields({ lifecycle_status: "open" }, { lifecycle_status: "awarded" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("keeps the previous deadline, award date and number when the incoming row lacks them", () => {
    expect(mergeLifecycleFields(
      { lifecycle_status: "awarded", awarded_date: "08/06/2026", deadline_date: null },
      { deadline_date: "07/01/2026", solicitation_number: "1026A" },
    )).toEqual({ lifecycle_status: "awarded", is_active: 0, awarded_date: "08/06/2026", deadline_date: "07/01/2026", solicitation_number: "1026A" });
  });
});

describe("delistingApplies", () => {
  it("needs a successful, complete walk of the open list", () => {
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: true } }))).toBe(true);
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: false } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: "closed", complete: true } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: true } }, "failure"))).toBe(false);
    expect(delistingApplies(run({}))).toBe(false);
    expect(delistingApplies(run(null))).toBe(false);
  });
});

describe("readListPagination", () => {
  it("reads the request count when it is a non-negative number", () => {
    expect(readListPagination({ pagination: { list_kind: "open", complete: true, requests_made: 3 } })).toEqual({ listKind: "open", complete: true, requestsMade: 3 });
    expect(readListPagination({ pagination: { requests_made: "x" } })).toEqual({ listKind: "open", complete: false, requestsMade: null });
    expect(readListPagination({})).toBeNull();
  });
});

describe("sourceBidIdLikePattern", () => {
  it("escapes LIKE wildcards so one source never matches another", () => {
    expect(sourceBidIdLikePattern("bidnet_co_denver")).toBe("bidnet!_co!_denver:%");
    expect(sourceBidIdLikePattern("a%b!c")).toBe("a!%b!!c:%");
  });
});

describe("delistedRawPayload", () => {
  it("records why and when the bid closed without losing the crawler payload", () => {
    const next = JSON.parse(delistedRawPayload(JSON.stringify({ title: "T", lifecycle: { note: "x" } }), "2026-09-24T01:00:00.000Z"));
    expect(next).toEqual({ title: "T", lifecycle: { note: "x", closed_reason: "delisted", closed_observed_at: "2026-09-24T01:00:00.000Z" } });
    expect(JSON.parse(delistedRawPayload("not json", "t"))).toEqual({ lifecycle: { closed_reason: "delisted", closed_observed_at: "t" } });
  });
});

describe("withLifecycleMetadata", () => {
  it("adds the delisted count to the logged metadata", () => {
    expect(withLifecycleMetadata(run({ mode: "live" }), 2).metadata).toEqual({ mode: "live", lifecycle: { delisted: 2 } });
  });
});
