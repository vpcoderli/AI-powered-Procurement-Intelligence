import { describe, expect, it } from "vitest";
import { AdminApiError } from "@/lib/api/admin";
import {
  SOURCE_PLATFORM_PATTERN,
  SOURCE_STATE_PATTERN,
  defaultSourceListQuery,
  type SourceListQuery,
} from "@/server/admin/data-source-list-contract";
import {
  ListRequestError,
  facetOptions,
  hasActiveFilters,
  lastRunOf,
  pageRange,
  readSourceListQuery,
  recoverRejectedQuery,
  recoveryForListError,
  selectedFacetValues,
  toggleFacetValue,
  writeSourceListQuery,
} from "./source-list-url";

describe("source list URL state", () => {
  it("reads a valid URL", () => {
    const { query, invalid } = readSourceListQuery(new URLSearchParams("level=county&state=co&platform=bidnet&approval=awaiting&health=failing&q=den&sort=-lastRun&page=2&pageSize=100"));
    expect(invalid).toBe(false);
    expect(query).toEqual({ levels: ["county"], states: ["CO"], platforms: ["bidnet"], approvals: ["awaiting"], healths: ["failing"], q: "den", sort: "lastRun", descending: true, page: 2, pageSize: 100 });
  });

  it("drops unknown values and reports them", () => {
    const { query, invalid } = readSourceListQuery(new URLSearchParams("level=galaxy&level=city&state=Colorado&sort=bogus&page=-1&pageSize=7"));
    expect(invalid).toBe(true);
    expect(query).toEqual({ ...defaultSourceListQuery(), levels: ["city"] });
  });

  it("writes a canonical URL that omits defaults and round-trips", () => {
    expect(writeSourceListQuery(defaultSourceListQuery())).toBe("");
    const query: SourceListQuery = { ...defaultSourceListQuery(), levels: ["county", "city"], q: "den", sort: "failures", descending: true, page: 3 };
    const text = writeSourceListQuery(query);
    expect(text).toBe("?level=county&level=city&q=den&sort=-failures&page=3");
    expect(readSourceListQuery(new URLSearchParams(text.slice(1))).query).toEqual(query);
  });

  it("toggles a facet value and goes back to page 1", () => {
    const start = { ...defaultSourceListQuery(), page: 4 };
    const added = toggleFacetValue(start, "approval", "awaiting");
    expect(selectedFacetValues(added, "approval")).toEqual(["awaiting"]);
    expect(added.page).toBe(1);
    expect(selectedFacetValues(toggleFacetValue(added, "approval", "awaiting"), "approval")).toEqual([]);
  });

  it("keeps a selected value visible with count 0", () => {
    expect(facetOptions([{ value: "CO", count: 3 }], ["CO", "OH"])).toEqual([
      { value: "CO", count: 3 },
      { value: "OH", count: 0 },
    ]);
  });

  it("describes the page range and the last run", () => {
    expect(pageRange(0, 1, 50)).toEqual({ from: 0, to: 0, lastPage: 1 });
    expect(pageRange(1020, 21, 50)).toEqual({ from: 1001, to: 1020, lastPage: 21 });
    expect(lastRunOf({ lastSuccessAt: "2026-09-29T07:00:00.000Z", lastFailureAt: "2026-09-29T05:00:00.000Z" })).toBe("2026-09-29T07:00:00.000Z");
    expect(lastRunOf({ lastSuccessAt: null, lastFailureAt: "2026-09-29T05:00:00.000Z" })).toBe("2026-09-29T05:00:00.000Z");
    expect(lastRunOf({ lastSuccessAt: null, lastFailureAt: null })).toBeNull();
  });
});

describe("source list URL state, edge cases", () => {
  const read = (search: string) => readSourceListQuery(new URLSearchParams(search));

  it("reads an empty URL as the defaults without reporting anything", () => {
    expect(read("")).toEqual({ query: defaultSourceListQuery(), invalid: false });
  });

  it("normalises the case of states and platforms without calling the URL invalid", () => {
    const { query, invalid } = read("state=co&state=CO&platform=BidNet&platform=bidnet&level=city&level=city");
    expect(invalid).toBe(false);
    expect(query.states).toEqual(["CO"]);
    expect(query.platforms).toEqual(["bidnet"]);
    expect(query.levels).toEqual(["city"]);
  });

  it("reports an unknown approval, health, platform or state and keeps the valid ones", () => {
    const { query, invalid } = read("approval=maybe&approval=blocked&health=sick&platform=Bid%20Net&state=C&state=OH");
    expect(invalid).toBe(true);
    expect(query.approvals).toEqual(["blocked"]);
    expect(query.healths).toEqual([]);
    expect(query.platforms).toEqual([]);
    expect(query.states).toEqual(["OH"]);
  });

  it("reads an explicit descending default sort and writes it back", () => {
    const { query, invalid } = read("sort=-label");
    expect(invalid).toBe(false);
    expect(query).toEqual({ ...defaultSourceListQuery(), descending: true });
    expect(writeSourceListQuery(query)).toBe("?sort=-label");
  });

  it("reports a page or page size the API would refuse, and falls back to the defaults", () => {
    for (const search of ["page=0", "page=abc", "page=1.5", "page=", "pageSize=30", "pageSize=", "pageSize=1000", "sort=", "sort=-"]) {
      const { query, invalid } = read(search);
      expect(invalid, search).toBe(true);
      expect(query, search).toEqual(defaultSourceListQuery());
    }
  });

  it("trims the search text and cuts it to what the API accepts", () => {
    expect(read("q=%20%20den%20").query.q).toBe("den");
    expect(read("q=%20%20").query.q).toBeNull();
    expect(read(`q=${"x".repeat(150)}`).query.q).toBe("x".repeat(100));
  });

  it("writes the search text encoded and reads it back unchanged", () => {
    const query: SourceListQuery = { ...defaultSourceListQuery(), q: "Denver & Boulder +100%" };
    const text = writeSourceListQuery(query);
    expect(text).not.toContain("&Boulder");
    expect(readSourceListQuery(new URLSearchParams(text.slice(1))).query).toEqual(query);
  });

  it("writes a non-default page size and leaves page 1 out", () => {
    expect(writeSourceListQuery({ ...defaultSourceListQuery(), pageSize: 200 })).toBe("?pageSize=200");
    expect(writeSourceListQuery({ ...defaultSourceListQuery(), page: 1, pageSize: 25, states: ["OH", "CO"] })).toBe("?state=OH&state=CO&pageSize=25");
  });

  it("goes back to page 1 whichever facet is toggled and keeps the other filters", () => {
    const start: SourceListQuery = { ...defaultSourceListQuery(), levels: ["county"], q: "den", page: 5 };
    for (const [facet, value] of [["level", "city"], ["state", "CO"], ["platform", "bidnet"], ["approval", "blocked"], ["health", "failing"]] as const) {
      const next = toggleFacetValue(start, facet, value);
      expect(next.page, facet).toBe(1);
      expect(selectedFacetValues(next, facet), facet).toContain(value);
      expect(next.q, facet).toBe("den");
      expect(next.levels, facet).toContain("county");
    }
    expect(start.page).toBe(5);
  });

  it("does not mutate the query it toggles or the selection it returns", () => {
    const start: SourceListQuery = { ...defaultSourceListQuery(), states: ["CO"] };
    const returned = selectedFacetValues(start, "state");
    returned.push("OH");
    expect(start.states).toEqual(["CO"]);
    toggleFacetValue(start, "state", "OH");
    expect(start.states).toEqual(["CO"]);
  });

  it("lists a selected value once even when the counts already contain it", () => {
    expect(facetOptions([], [])).toEqual([]);
    expect(facetOptions([{ value: "CO", count: 3 }], ["CO"])).toEqual([{ value: "CO", count: 3 }]);
  });

  it("clamps the page range to the total on a short last page and on an empty list", () => {
    expect(pageRange(51, 2, 50)).toEqual({ from: 51, to: 51, lastPage: 2 });
    expect(pageRange(50, 1, 50)).toEqual({ from: 1, to: 50, lastPage: 1 });
    expect(pageRange(0, 3, 50)).toEqual({ from: 0, to: 0, lastPage: 1 });
  });

  it("tells a filter from a sort or a page change", () => {
    expect(hasActiveFilters(defaultSourceListQuery())).toBe(false);
    expect(hasActiveFilters({ ...defaultSourceListQuery(), sort: "failures", descending: true, page: 3, pageSize: 100 })).toBe(false);
    expect(hasActiveFilters({ ...defaultSourceListQuery(), states: ["CO"] })).toBe(true);
    expect(hasActiveFilters({ ...defaultSourceListQuery(), healths: ["failing"] })).toBe(true);
    expect(hasActiveFilters({ ...defaultSourceListQuery(), q: "den" })).toBe(true);
  });
});

describe("recovering from a refused query", () => {
  it("retries the same filters from page 1 when a later page was refused", () => {
    const refused: SourceListQuery = { ...defaultSourceListQuery(), levels: ["county"], states: ["CO"], q: "den", sort: "failures", descending: true, page: 7, pageSize: 100 };

    expect(recoverRejectedQuery(refused)).toEqual({ query: { ...refused, page: 1 }, fellBack: false });
  });

  it("falls back to the defaults, and says so, when page 1 is refused as well", () => {
    const refused: SourceListQuery = { ...defaultSourceListQuery(), levels: ["county"], q: "den", page: 1 };

    expect(recoverRejectedQuery(refused)).toEqual({ query: defaultSourceListQuery(), fellBack: true });
  });

  it("has nothing else to try for the defaults themselves", () => {
    expect(recoverRejectedQuery(defaultSourceListQuery())).toEqual({ query: defaultSourceListQuery(), fellBack: true });
  });

  it("reaches the defaults in at most two refusals from any starting point, so the page cannot loop", () => {
    for (const page of [1, 2, 40]) {
      let query: SourceListQuery = { ...defaultSourceListQuery(), states: ["OH"], healths: ["failing"], page };
      let refusals = 0;
      for (;;) {
        refusals += 1;
        const recovery = recoverRejectedQuery(query);
        if (recovery.fellBack) {
          expect(recovery.query).toEqual(defaultSourceListQuery());
          break;
        }
        query = recovery.query;
        expect(refusals).toBeLessThan(3);
      }
      expect(refusals, `page ${page}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("recoveryForListError", () => {
  const refused = (canonical: string, status = 400) => new ListRequestError(canonical, new AdminApiError(status, status === 400 ? "INVALID_REQUEST" : "INTERNAL_ERROR", "refused"));
  const onPage = (page: number): SourceListQuery => ({ ...defaultSourceListQuery(), levels: ["county"], page });

  it("retries the same filters from page 1 when the API refused the query the URL holds", () => {
    const query = onPage(7);

    expect(recoveryForListError(refused(writeSourceListQuery(query)), writeSourceListQuery(query), query)).toEqual({ query: onPage(1), fellBack: false });
  });

  it("falls back to the defaults when the refused query was already page 1", () => {
    const query = onPage(1);

    expect(recoveryForListError(refused(writeSourceListQuery(query)), writeSourceListQuery(query), query)).toEqual({
      query: defaultSourceListQuery(),
      fellBack: true,
    });
  });

  it("does not blame the query the URL holds now for an answer to an older one", () => {
    const older = onPage(7);
    const current = onPage(1);

    expect(recoveryForListError(refused(writeSourceListQuery(older)), writeSourceListQuery(current), current)).toBeNull();
  });

  it("has no recovery for a failure that is not the API refusing the query", () => {
    const query = onPage(7);
    const canonical = writeSourceListQuery(query);

    expect(recoveryForListError(refused(canonical, 500), canonical, query)).toBeNull();
    expect(recoveryForListError(new ListRequestError(canonical, new TypeError("Failed to fetch")), canonical, query)).toBeNull();
    expect(recoveryForListError(new AdminApiError(400, "INVALID_REQUEST", "untagged"), canonical, query)).toBeNull();
    expect(recoveryForListError(new Error("boom"), canonical, query)).toBeNull();
    expect(recoveryForListError(null, canonical, query)).toBeNull();
    expect(recoveryForListError(undefined, canonical, query)).toBeNull();
  });

  it("carries the query string and the original failure of the request it tags", () => {
    const failure = new AdminApiError(400, "INVALID_REQUEST", "page 7 is out of range");
    const error = new ListRequestError("?page=7", failure);

    expect(error).toBeInstanceOf(Error);
    expect(error.canonical).toBe("?page=7");
    expect(error.failure).toBe(failure);
    expect(error.message).toBe("page 7 is out of range");
    expect(new ListRequestError("", "plain").message).not.toBe("");
  });
});

describe("rewriting an invalid link", () => {
  const read = (search: string) => readSourceListQuery(new URLSearchParams(search));

  it("keeps the valid part of a link with unknown values and writes it as the canonical URL", () => {
    const { query, invalid } = read("level=galaxy&level=city&state=Colorado&sort=bogus&page=-1&pageSize=7");

    expect(invalid).toBe(true);
    expect(writeSourceListQuery(query)).toBe("?level=city");
  });

  it.each([
    "level=galaxy",
    "state=Colorado&state=OH",
    "platform=Bid%20Net&platform=bidnet",
    "approval=maybe",
    "health=sick&health=failing",
    "sort=bogus",
    "sort=-",
    "page=0",
    "page=abc",
    "page=1.5",
    "pageSize=30",
    "pageSize=1000",
    "level=galaxy&level=city&state=Colorado&sort=bogus&page=-1&pageSize=7",
  ])("rewrites %s once, to a URL the page then reads as valid and unchanged", (search) => {
    const first = read(search);
    const rewritten = writeSourceListQuery(first.query);
    const second = readSourceListQuery(new URLSearchParams(rewritten.slice(1)));

    expect(first.invalid).toBe(true);
    expect(second.invalid).toBe(false);
    expect(second.query).toEqual(first.query);
    expect(writeSourceListQuery(second.query)).toBe(rewritten);
  });

  it("leaves a canonical link alone: reading and writing it gives the same text and reports nothing", () => {
    for (const search of ["", "level=county&level=city", "state=CO&state=OH&q=den", "sort=-failures&page=3&pageSize=100", "platform=bidnet&approval=awaiting&health=never_run"]) {
      const { query, invalid } = read(search);

      expect(invalid, search).toBe(false);
      expect(writeSourceListQuery(query), search).toBe(search ? `?${search}` : "");
    }
  });
});

describe("state and platform patterns shared with the API", () => {
  it("accepts a two-letter upper-case state and a lower-case platform slug, and nothing looser", () => {
    for (const state of ["CO", "OH", "US"]) expect(SOURCE_STATE_PATTERN.test(state), state).toBe(true);
    for (const state of ["co", "C", "COL", "1A", "", " CO", "C O"]) expect(SOURCE_STATE_PATTERN.test(state), state).toBe(false);
    for (const platform of ["bidnet", "state_portal", "federal_portal", "a-b", "0abc"]) expect(SOURCE_PLATFORM_PATTERN.test(platform), platform).toBe(true);
    for (const platform of ["", "BidNet", "-x", "_x", "a b", "a.b", "a/b"]) expect(SOURCE_PLATFORM_PATTERN.test(platform), platform).toBe(false);
  });

  it("makes the page keep exactly the states and platforms those patterns accept", () => {
    const { query } = readSourceListQuery(new URLSearchParams("state=co&state=Colorado&state=C0&state=OH&platform=BidNet&platform=a%20b&platform=-x&platform=state_portal"));

    expect(query.states).toEqual(["CO", "OH"]);
    expect(query.platforms).toEqual(["bidnet", "state_portal"]);
    for (const state of query.states) expect(SOURCE_STATE_PATTERN.test(state)).toBe(true);
    for (const platform of query.platforms) expect(SOURCE_PLATFORM_PATTERN.test(platform)).toBe(true);
  });
});
