import { describe, expect, it } from "vitest";
import { defaultSourceListQuery, type SourceListQuery } from "@/server/admin/data-source-list-contract";
import { facetOptions, hasActiveFilters, lastRunOf, pageRange, readSourceListQuery, selectedFacetValues, toggleFacetValue, writeSourceListQuery } from "./source-list-url";

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
