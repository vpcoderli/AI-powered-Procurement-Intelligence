import { describe, expect, it } from "vitest";
import {
  closedPayload,
  closedRawPayload,
  delistedRawPayload,
  delistingApplies,
  mergeLifecycleFields,
  readListPagination,
  resolveLifecycle,
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

describe("mergeLifecycleFields with a clock (deadline-passed rule)", () => {
  /** 02:00 on 13 October in the deadline zone (UTC-10). */
  const NOW = "2026-10-13T12:00:00.000Z";
  const PASSED = "10/12/2026";
  const AHEAD = "10/14/2026";

  it("closes an open incoming row whose deadline has passed", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: PASSED }, {}, { now: NOW }))
      .toMatchObject({ lifecycle_status: "closed", is_active: 0, deadline_date: PASSED });
    // A row that states no status at all reads as open, so the rule applies to it as well.
    expect(mergeLifecycleFields({ deadline_date: PASSED }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({ is_active: 1, deadline_date: PASSED }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
  });

  it("keeps an open row open while its deadline is ahead, including the whole of today's date", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: AHEAD }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: "10/13/2026" }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: "10/13/2026 2:00 PM CST" }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "open" });
  });

  it("closes at the exact expiry instant and not before", () => {
    const row = { lifecycle_status: "open", deadline_date: "10/13/2026 2:00 AM" };
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-13T11:59:59.999Z" })).toMatchObject({ lifecycle_status: "open" });
    expect(mergeLifecycleFields(row, {}, { now: NOW })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
  });

  it("holds a bid whose time has no AM/PM open until its PM reading", () => {
    // 02:00 on the 13th in UTC-10 is 12:00Z; read as a PM hour it runs to 00:00Z on the 14th.
    const row = { lifecycle_status: "open", deadline_date: "10/13/2026 2:00" };
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-13T12:00:00.000Z" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-13T23:59:59.999Z" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-14T00:00:00.000Z" })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(resolveLifecycle(row, {}, { now: "2026-10-13T12:00:00.000Z" }).closedByDeadline).toBeNull();
    expect(resolveLifecycle(row, {}, { now: "2026-10-14T00:00:00.000Z" }).closedByDeadline).toBe("10/13/2026 2:00");
    // With the AM given, or an hour that cannot be PM, nothing is held back.
    expect(mergeLifecycleFields({ ...row, deadline_date: "10/13/2026 2:00 AM" }, {}, { now: "2026-10-13T12:00:00.000Z" })).toMatchObject({ lifecycle_status: "closed" });
    expect(mergeLifecycleFields({ ...row, deadline_date: "10/13/2026 0:30" }, {}, { now: "2026-10-13T12:00:00.000Z" })).toMatchObject({ lifecycle_status: "closed" });
  });

  it("keeps a bid whose deadline is a midnight open through the stated day, as a date-only deadline is", () => {
    const at = (deadline: string, now: string) => mergeLifecycleFields({ lifecycle_status: "open", deadline_date: deadline }, {}, { now });
    // The end of 13 October in UTC-10 is 10:00Z on the 14th.
    for (const deadline of ["10/13/2026 12:00 AM", "10/13/2026 00:00", "2026-10-13T00:00:00Z", "2026-10-13T00:00:00"]) {
      expect(at(deadline, "2026-10-13T12:00:00.000Z"), deadline).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      expect(at(deadline, "2026-10-14T09:59:59.999Z"), deadline).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      expect(at(deadline, "2026-10-14T10:00:00.000Z"), deadline).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    }
    // One minute past midnight is a time of its own.
    expect(at("10/13/2026 12:01 AM", "2026-10-13T12:00:00.000Z")).toMatchObject({ lifecycle_status: "closed" });
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/12/2026 12:00 AM" }, {}, { now: "2026-10-13T12:00:00.000Z" }).closedByDeadline).toBe("10/12/2026 12:00 AM");
  });

  it("keeps a bid whose deadline is a bare 12:00 (no AM/PM) open through the stated day, since it may be 12:00 AM", () => {
    const at = (deadline: string, now: string) => mergeLifecycleFields({ lifecycle_status: "open", deadline_date: deadline }, {}, { now });
    // Noon on the 13th in UTC-10 is 22:00Z; the end of the 13th is 10:00Z on the 14th.
    for (const deadline of ["10/13/2026 12:00", "10/13/2026 12:00:00", "Oct 13, 2026 at 12:00", "10/13/2026 12:00 A"]) {
      expect(at(deadline, "2026-10-13T22:00:00.000Z"), deadline).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      expect(at(deadline, "2026-10-14T09:59:59.999Z"), deadline).toMatchObject({ lifecycle_status: "open", is_active: 1 });
      expect(at(deadline, "2026-10-14T10:00:00.000Z"), deadline).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    }
    // With the PM written, 12:00 is noon.
    expect(at("10/13/2026 12:00 PM", "2026-10-13T22:00:00.000Z")).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/13/2026 12:00" }, {}, { now: "2026-10-13T22:00:00.000Z" }).closedByDeadline).toBeNull();
  });

  it("does not close a bid before the fraction of a second its ISO deadline states", () => {
    const row = { lifecycle_status: "open", deadline_date: "2026-10-13T11:59:59.999Z" };
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-13T11:59:59.998Z" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields(row, {}, { now: "2026-10-13T11:59:59.999Z" })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
  });

  it("changes nothing without a clock", () => {
    const row = { lifecycle_status: "open", deadline_date: PASSED };
    expect(mergeLifecycleFields(row)).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields(row, {}, {})).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields(row, {}, { now: undefined })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("ignores a clock that is not a zoned ISO instant", () => {
    const row = { lifecycle_status: "open", deadline_date: PASSED };
    for (const now of ["", "yesterday", "2026-10-13", "2026-10-13T12:00:00", "10/13/2026 12:00", "2026-13-45T99:00:00Z"]) {
      expect(mergeLifecycleFields(row, {}, { now })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    }
  });

  it("reads the offset and fraction forms the Python crawler and JavaScript write", () => {
    const row = { lifecycle_status: "open", deadline_date: PASSED };
    for (const now of ["2026-10-13T12:00:00.123456+00:00", "2026-10-13T12:00:00Z", "2026-10-13T07:00:00-05:00", "2026-10-13T12:00+00:00"]) {
      expect(mergeLifecycleFields(row, {}, { now })).toMatchObject({ lifecycle_status: "closed" });
    }
  });

  it("falls back to the stored deadline when the incoming row has none", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: null }, { deadline_date: PASSED }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "closed", is_active: 0, deadline_date: PASSED });
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: "  " }, { deadline_date: AHEAD }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: AHEAD });
  });

  it("prefers the incoming deadline over the stored one", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: AHEAD }, { deadline_date: PASSED }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "open", deadline_date: AHEAD });
  });

  it("never expires a bid whose deadline cannot be read or is missing", () => {
    for (const deadline of [null, undefined, "", "TBD", "Not Available", "02/30/2026"]) {
      expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: deadline }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    }
  });

  it("leaves a row the crawler already closed alone", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "closed", deadline_date: AHEAD }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({ lifecycle_status: "awarded", deadline_date: PASSED }, {}, { now: NOW })).toMatchObject({ lifecycle_status: "awarded", is_active: 0 });
  });

  it("keeps an awarded existing row awarded", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "closed", deadline_date: PASSED }, { lifecycle_status: "awarded", awarded_date: "07/09/2026" }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "awarded", is_active: 0, awarded_date: "07/09/2026" });
    // Even when the open list shows it again after its deadline, the deadline never downgrades an award to closed.
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: PASSED }, { lifecycle_status: "awarded" }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "awarded", is_active: 0 });
  });

  it("reopens a closed existing row whose incoming deadline is ahead", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: AHEAD }, { lifecycle_status: "closed", deadline_date: PASSED }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "open", is_active: 1, deadline_date: AHEAD });
    expect(mergeLifecycleFields({ lifecycle_status: "open", deadline_date: AHEAD }, { lifecycle_status: "awarded" }, { now: NOW }))
      .toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("still keeps the other lifecycle fields", () => {
    expect(mergeLifecycleFields(
      { lifecycle_status: "open", deadline_date: PASSED, solicitation_number: "" },
      { awarded_date: "08/06/2026", solicitation_number: "1026A" },
      { now: NOW },
    )).toEqual({ lifecycle_status: "closed", is_active: 0, awarded_date: "08/06/2026", deadline_date: PASSED, solicitation_number: "1026A" });
  });
});

describe("resolveLifecycle", () => {
  const NOW = "2026-10-13T12:00:00.000Z";

  it("returns the merged fields together with the deadline that closed an otherwise open bid", () => {
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: " 10/12/2026 " }, {}, { now: NOW })).toEqual({
      fields: { lifecycle_status: "closed", is_active: 0, awarded_date: null, deadline_date: "10/12/2026", solicitation_number: null },
      closedByDeadline: "10/12/2026",
    });
    expect(resolveLifecycle({ lifecycle_status: "open" }, { deadline_date: "10/12/2026" }, { now: NOW }).closedByDeadline).toBe("10/12/2026");
  });

  it("names no deadline whenever the rule did not close the bid", () => {
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/12/2026" }).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/12/2026" }, {}, {}).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/14/2026" }, {}, { now: NOW }).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "closed", deadline_date: "10/12/2026" }, {}, { now: NOW }).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "10/12/2026" }, { lifecycle_status: "awarded" }, { now: NOW }).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "TBD" }, {}, { now: NOW }).closedByDeadline).toBeNull();
    expect(resolveLifecycle({ lifecycle_status: "open", deadline_date: "01/01/1970" }, {}, { now: NOW }).closedByDeadline).toBeNull();
  });

  it("has exactly the fields mergeLifecycleFields returns", () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>, { now?: string }]> = [
      [{ lifecycle_status: "open", deadline_date: "10/12/2026" }, {}, { now: NOW }],
      [{ lifecycle_status: "closed" }, { lifecycle_status: "awarded", awarded_date: "07/09/2026" }, { now: NOW }],
      [{ is_active: 0, solicitation_number: "N-1" }, { deadline_date: "10/20/2026" }, {}],
      [{}, {}, {}],
    ];
    for (const [incoming, existing, options] of cases) expect(resolveLifecycle(incoming, existing, options).fields).toEqual(mergeLifecycleFields(incoming, existing, options));
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

  it("never delists on a run that did not declare which list it walked", () => {
    // A complete walk of an undeclared list kind must not close the source's open bids: only an
    // explicit open-list walk proves which bids are still listed (spec §5.1).
    expect(delistingApplies(run({ pagination: { complete: true } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: 7, complete: true } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: "OPEN", complete: true } }))).toBe(false);
  });
});

describe("readListPagination", () => {
  it("reads the request count when it is a non-negative number", () => {
    expect(readListPagination({ pagination: { list_kind: "open", complete: true, requests_made: 3 } })).toEqual({ listKind: "open", complete: true, requestsMade: 3 });
    expect(readListPagination({ pagination: { requests_made: "x" } })).toEqual({ listKind: null, complete: false, requestsMade: null });
    expect(readListPagination({})).toBeNull();
  });

  it("reports a missing or non-string list kind as null instead of assuming open", () => {
    expect(readListPagination({ pagination: { complete: true } })).toEqual({ listKind: null, complete: true, requestsMade: null });
    expect(readListPagination({ pagination: { list_kind: null, complete: true } })).toEqual({ listKind: null, complete: true, requestsMade: null });
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

describe("closedRawPayload", () => {
  const AT = "2026-10-13T12:00:00.000Z";

  it("records the reason and time under lifecycle without losing the payload or its lifecycle keys", () => {
    const next = JSON.parse(closedRawPayload(JSON.stringify({ title: "T", lifecycle: { note: "x" } }), "deadline_passed", AT)!);
    expect(next).toEqual({ title: "T", lifecycle: { note: "x", closed_reason: "deadline_passed", closed_observed_at: AT } });
  });

  it("takes an object payload as well as its JSON text, and adds the extra fields", () => {
    const expected = { title: "T", lifecycle: { closed_reason: "deadline_passed", closed_observed_at: AT, deadline: "10/12/2026" } };
    expect(JSON.parse(closedRawPayload({ title: "T" }, "deadline_passed", AT, { deadline: "10/12/2026" })!)).toEqual(expected);
    expect(JSON.parse(closedRawPayload('{"title":"T"}', "deadline_passed", AT, { deadline: "10/12/2026" })!)).toEqual(expected);
    expect(JSON.parse(closedRawPayload({}, "delisted", AT)!)).toEqual({ lifecycle: { closed_reason: "delisted", closed_observed_at: AT } });
  });

  it("replaces an earlier close reason with the new one", () => {
    const earlier = { lifecycle: { closed_reason: "delisted", closed_observed_at: "2026-09-01T00:00:00.000Z" } };
    expect(JSON.parse(closedRawPayload(earlier, "deadline_passed", AT)!).lifecycle).toEqual({ closed_reason: "deadline_passed", closed_observed_at: AT });
  });

  it("is null for a payload that is not a JSON object, so a caller can leave it untouched", () => {
    for (const raw of ["not json", "", "[1,2]", "42", '"text"', "null", [1], 7, null, undefined]) {
      expect(closedRawPayload(raw, "deadline_passed", AT)).toBeNull();
    }
  });
});

describe("closedPayload", () => {
  it("is the same close as an object, null for a payload that is not one", () => {
    const at = "2026-10-13T12:00:00.000Z";
    expect(closedPayload({ a: 1 }, "deadline_passed", at, { deadline: "10/12/2026" }))
      .toEqual({ a: 1, lifecycle: { closed_reason: "deadline_passed", closed_observed_at: at, deadline: "10/12/2026" } });
    expect(closedPayload("not json", "deadline_passed", at)).toBeNull();
  });
});

describe("withLifecycleMetadata", () => {
  it("adds the delisted count to the logged metadata", () => {
    expect(withLifecycleMetadata(run({ mode: "live" }), 2).metadata).toEqual({ mode: "live", lifecycle: { delisted: 2 } });
  });
});
