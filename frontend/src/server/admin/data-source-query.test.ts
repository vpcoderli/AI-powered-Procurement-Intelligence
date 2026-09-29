import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  defaultSourceListQuery,
  emptySourceListFilters,
  type SourceHealthState,
  type SourceListFilters,
  type SourceListQuery,
} from "./data-source-list-contract";
import {
  DataSourceQueryError,
  likeContainsPattern,
  listAdminDataSourceIndex,
  listAdminDataSourceIndexFromMysql,
  listAdminDataSourcesPage,
  listAdminDataSourcesPageFromMysql,
  parseSourceListFilters,
  parseSourceListQuery,
  sourceFilterWhere,
} from "./data-source-query";

const NOW = "2026-09-29T08:00:00.000Z";

function row(id: string, overrides: Partial<typeof dataSources.$inferInsert> = {}): typeof dataSources.$inferInsert {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "CO",
    jurisdictionLevel: "county",
    providerFamily: "bidnet",
    isEnabled: 1,
    cadence: "daily",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ROWS = [
  row("ca_state", { label: "California Cal eProcure", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", lastSuccessAt: NOW }),
  row("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null }),
  row("bidnet_co_denver", { label: "City and County of Denver", jurisdictionName: "Denver", approvalStatus: "approved", lastSuccessAt: NOW }),
  row("bidnet_co_aurora", { label: "City of Aurora", issuerType: "city", jurisdictionLevel: "city", jurisdictionName: "Aurora" }),
  row("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 2, lastFailureAt: NOW }),
  row("bidnet_oh_block", { label: "Blocked County", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
  row("odd_level", { label: "Odd 100% match", issuerType: "municipal", jurisdictionLevel: null, stateCode: "TX", providerFamily: "periscope" }),
];

function filters(overrides: Partial<SourceListFilters>): SourceListFilters {
  return { ...emptySourceListFilters(), ...overrides };
}

describe("parseSourceListFilters", () => {
  it("reads repeated, normalised values", () => {
    const parsed = parseSourceListFilters(
      new URLSearchParams("level=county&level=city&level=county&state=co&state=CO&platform=BidNet&approval=awaiting&health=failing&q=%20den%20"),
    );
    expect(parsed).toEqual({ levels: ["county", "city"], states: ["CO"], platforms: ["bidnet"], approvals: ["awaiting"], healths: ["failing"], q: "den" });
    expect(parseSourceListFilters(new URLSearchParams(""))).toEqual(emptySourceListFilters());
  });

  it.each([
    ["level=galaxy"],
    ["state=Colorado"],
    ["platform=bid%20net"],
    ["approval=maybe"],
    ["health=bad"],
    [`q=${"x".repeat(101)}`],
  ])("rejects %s", (query) => {
    expect(() => parseSourceListFilters(new URLSearchParams(query))).toThrow(DataSourceQueryError);
  });
});

describe("sourceFilterWhere", () => {
  it("is empty without filters and leaves out the excepted dimension", () => {
    expect(sourceFilterWhere(emptySourceListFilters())).toEqual({ sql: "", values: [] });
    const where = sourceFilterWhere(filters({ levels: ["county", "city"], states: ["CO"], q: "Den" }), "level");
    expect(where.sql).toBe(
      "WHERE state_code IN (?) AND (LOWER(id) LIKE ? ESCAPE '!' OR LOWER(label) LIKE ? ESCAPE '!' OR LOWER(COALESCE(jurisdiction_name, '')) LIKE ? ESCAPE '!')",
    );
    expect(where.values).toEqual(["CO", "%den%", "%den%", "%den%"]);
  });

  it("escapes LIKE wildcards", () => {
    expect(likeContainsPattern("100%_!x")).toBe("%100!%!_!!x%");
  });
});

describe("source index", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(ROWS).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const ids = async (applied: Partial<SourceListFilters>) =>
    (await listAdminDataSourceIndex(testDb.db, filters(applied))).items.map((item) => item.id);

  it("lists every source by label with the gate's view of approval", async () => {
    const index = await listAdminDataSourceIndex(testDb.db, emptySourceListFilters());
    expect(index.total).toBe(7);
    expect(index.truncated).toBe(false);
    expect(index.items.map((item) => item.id)).toEqual([
      "bidnet_oh_block",
      "ca_state",
      "bidnet_mi_twp",
      "bidnet_co_denver",
      "bidnet_co_aurora",
      "odd_level",
      "sam_gov",
    ]);
    expect(index.items.find((item) => item.id === "ca_state")).toEqual({
      id: "ca_state",
      label: "California Cal eProcure",
      stateCode: "CA",
      level: "state",
      issuerType: "state",
      jurisdictionLevel: null,
      providerFamily: "state_portal",
      approvalState: "approved",
      isEnabled: true,
      crawlerSourceId: "ca_caleprocure",
    });
    expect(index.items.find((item) => item.id === "sam_gov")).toMatchObject({ level: "federal", providerFamily: "federal_portal", approvalState: "approved" });
    expect(index.items.find((item) => item.id === "odd_level")).toMatchObject({ level: "unknown", approvalState: "awaiting", crawlerSourceId: null });
  });

  it("filters by every dimension", async () => {
    expect(await ids({ levels: ["county"] })).toEqual(["bidnet_oh_block", "bidnet_co_denver"]);
    expect(await ids({ approvals: ["awaiting"] })).toEqual(["bidnet_mi_twp", "bidnet_co_aurora", "odd_level"]);
    expect(await ids({ approvals: ["blocked"] })).toEqual(["bidnet_oh_block"]);
    expect(await ids({ healths: ["never_run"] })).toEqual(["bidnet_co_aurora", "odd_level", "sam_gov"]);
    expect(await ids({ healths: ["failing", "disabled"] })).toEqual(["bidnet_oh_block", "bidnet_mi_twp"]);
    expect(await ids({ platforms: ["state_portal", "federal_portal"] })).toEqual(["ca_state", "sam_gov"]);
    expect(await ids({ states: ["CO"], levels: ["city"] })).toEqual(["bidnet_co_aurora"]);
    expect(await ids({ q: "DENVER" })).toEqual(["bidnet_co_denver"]);
    expect(await ids({ q: "%" })).toEqual(["odd_level"]);
  });

  it("runs the same SQL on MySQL and reads string flags", async () => {
    const query = vi.fn(async () => [[
      { id: "x", label: "X", state_code: "CO", issuer_type: "county", jurisdiction_level: "county", coverage_level: "county", platform: "bidnet", approval_state: "awaiting", is_enabled: "1" },
    ]] as [unknown[]]);
    const index = await listAdminDataSourceIndexFromMysql({ query }, filters({ levels: ["county"] }));
    expect(index.items).toEqual([
      { id: "x", label: "X", stateCode: "CO", level: "county", issuerType: "county", jurisdictionLevel: "county", providerFamily: "bidnet", approvalState: "awaiting", isEnabled: true, crawlerSourceId: null },
    ]);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("FROM data_sources WHERE");
    expect(sql).toContain("LIMIT 5001");
    expect(values).toEqual(["county"]);
  });
});

const PAGE_ROWS = [
  row("ca_state", { label: "California Cal eProcure", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", lastSuccessAt: "2026-09-29T06:00:00.000Z" }),
  row("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null }),
  row("bidnet_co_denver", { label: "City and County of Denver", jurisdictionName: "Denver", approvalStatus: "approved", lastSuccessAt: "2026-09-29T07:00:00.000Z" }),
  row("bidnet_co_aurora", { label: "City of Aurora", issuerType: "city", jurisdictionLevel: "city", jurisdictionName: "Aurora" }),
  row("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 2, lastFailureAt: "2026-09-29T05:00:00.000Z" }),
  row("bidnet_oh_block", { label: "Blocked County", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
  row("odd_level", { label: "Odd 100% match", issuerType: "municipal", jurisdictionLevel: null, stateCode: "TX", providerFamily: "periscope" }),
];

function pageQuery(overrides: Partial<SourceListQuery>): SourceListQuery {
  return { ...defaultSourceListQuery(), ...overrides };
}

describe("parseSourceListQuery", () => {
  it("reads sort, direction and paging", () => {
    expect(parseSourceListQuery(new URLSearchParams("sort=-lastRun&page=2&pageSize=25"))).toMatchObject({ sort: "lastRun", descending: true, page: 2, pageSize: 25 });
    expect(parseSourceListQuery(new URLSearchParams(""))).toEqual(defaultSourceListQuery());
  });

  it("carries the filters alongside sort and paging, and accepts the largest page size", () => {
    expect(parseSourceListQuery(new URLSearchParams("level=county&state=co&q=den&sort=updated&pageSize=200"))).toEqual({
      ...emptySourceListFilters(),
      levels: ["county"],
      states: ["CO"],
      q: "den",
      sort: "updated",
      descending: false,
      page: 1,
      pageSize: 200,
    });
  });

  it.each([["sort=bogus"], ["page=0"], ["page=1.5"], ["pageSize=201"], ["pageSize=abc"]])("rejects %s", (query) => {
    expect(() => parseSourceListQuery(new URLSearchParams(query))).toThrow(DataSourceQueryError);
  });
});

describe("source list page", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(PAGE_ROWS).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const pageIds = async (overrides: Partial<SourceListQuery>) =>
    (await listAdminDataSourcesPage(testDb.db, pageQuery(overrides))).items.map((item) => item.id);

  it("returns compact rows with the list's health and approval views", async () => {
    const page = await listAdminDataSourcesPage(testDb.db, defaultSourceListQuery());
    expect(page.total).toBe(7);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(50);
    expect(page.items.find((item) => item.id === "bidnet_mi_twp")).toEqual({
      id: "bidnet_mi_twp",
      label: "Canton Township",
      stateCode: "MI",
      level: "township",
      issuerType: "township",
      jurisdictionLevel: "township",
      jurisdictionName: null,
      providerFamily: "bidnet",
      approvalState: "awaiting",
      isEnabled: true,
      health: "failing",
      lastSuccessAt: null,
      lastFailureAt: "2026-09-29T05:00:00.000Z",
      consecutiveFailures: 2,
      precheckRequestedAt: null,
      liveHealthDisposition: null,
      crawlerSourceId: null,
    });
  });

  it("pages and rejects a page past the end", async () => {
    expect(await pageIds({ pageSize: 2, page: 2 })).toEqual(["bidnet_mi_twp", "bidnet_co_denver"]);
    expect(await pageIds({ pageSize: 2, page: 4 })).toEqual(["sam_gov"]);
    await expect(listAdminDataSourcesPage(testDb.db, pageQuery({ pageSize: 2, page: 5 }))).rejects.toThrow(DataSourceQueryError);
  });

  it("sorts by failures and by last run with never-run rows last", async () => {
    expect(await pageIds({ sort: "failures", descending: true })).toEqual([
      "bidnet_mi_twp",
      "bidnet_oh_block",
      "ca_state",
      "bidnet_co_denver",
      "bidnet_co_aurora",
      "odd_level",
      "sam_gov",
    ]);
    expect(await pageIds({ sort: "lastRun", descending: true })).toEqual([
      "bidnet_co_denver",
      "ca_state",
      "bidnet_mi_twp",
      "bidnet_co_aurora",
      "bidnet_oh_block",
      "odd_level",
      "sam_gov",
    ]);
  });

  it("keeps never-run rows last when sorting last run ascending", async () => {
    expect(await pageIds({ sort: "lastRun", descending: false })).toEqual([
      "bidnet_mi_twp",
      "ca_state",
      "bidnet_co_denver",
      "bidnet_co_aurora",
      "bidnet_oh_block",
      "odd_level",
      "sam_gov",
    ]);
  });

  it("sorts by label in either direction and by last update, breaking ties on id", async () => {
    const touch = testDb.db.$client.prepare("UPDATE data_sources SET updated_at = ? WHERE id = ?");
    touch.run("2026-09-29T09:00:00.000Z", "odd_level");
    touch.run("2026-09-29T10:00:00.000Z", "sam_gov");

    expect(await pageIds({ sort: "label", descending: true })).toEqual([
      "sam_gov",
      "odd_level",
      "bidnet_co_aurora",
      "bidnet_co_denver",
      "bidnet_mi_twp",
      "ca_state",
      "bidnet_oh_block",
    ]);
    expect(await pageIds({ sort: "updated", descending: true })).toEqual([
      "sam_gov",
      "odd_level",
      "bidnet_co_aurora",
      "bidnet_co_denver",
      "bidnet_mi_twp",
      "bidnet_oh_block",
      "ca_state",
    ]);
    expect(await pageIds({ sort: "updated", descending: false })).toEqual([
      "bidnet_co_aurora",
      "bidnet_co_denver",
      "bidnet_mi_twp",
      "bidnet_oh_block",
      "ca_state",
      "odd_level",
      "sam_gov",
    ]);
  });

  it("counts each facet with the other dimensions' filters only", async () => {
    const { facets, total } = await listAdminDataSourcesPage(testDb.db, pageQuery({ levels: ["county"] }));
    expect(total).toBe(2);
    expect(facets.level).toEqual([
      { value: "federal", count: 1 },
      { value: "state", count: 1 },
      { value: "county", count: 2 },
      { value: "city", count: 1 },
      { value: "township", count: 1 },
      { value: "unknown", count: 1 },
    ]);
    expect(facets.state).toEqual([
      { value: "CO", count: 1 },
      { value: "OH", count: 1 },
    ]);
    expect(facets.approval).toEqual([
      { value: "approved", count: 1 },
      { value: "blocked", count: 1 },
    ]);
    expect(facets.health).toEqual([
      { value: "healthy", count: 1 },
      { value: "disabled", count: 1 },
    ]);
    expect(facets.platform).toEqual([{ value: "bidnet", count: 2 }]);
  });

  it("runs the same SQL on MySQL with LIMIT/OFFSET values and string counts", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT COUNT(*) AS total")) return [[{ total: "3" }]] as [unknown[]];
      if (sql.includes(" AS facet_value")) return [[{ facet_value: "county", total: "3" }]] as [unknown[]];
      return [[]] as [unknown[]];
    });
    const page = await listAdminDataSourcesPageFromMysql({ query }, pageQuery({ page: 2, pageSize: 2 }));
    expect(page.total).toBe(3);
    const listCall = query.mock.calls.find(([sql]) => sql.includes("LIMIT ? OFFSET ?")) as unknown as [string, unknown[]];
    expect(listCall[1]).toEqual([2, 2]);
    expect(page.facets.level).toEqual([{ value: "county", count: 3 }]);
  });
});

// Spec §5.1 priority: disabled > failing > healthy > never_run. Each row is chosen so that putting two arms of the CASE
// in the wrong order changes its answer: the first row matches every arm, the second matches failing and healthy.
const HEALTH_ROWS = [
  row("h_disabled_failing", {
    label: "Disabled and failing",
    isEnabled: 0,
    consecutiveFailures: 3,
    lastSuccessAt: "2026-09-28T06:00:00.000Z",
    lastFailureAt: "2026-09-29T06:00:00.000Z",
  }),
  row("h_failing_after_success", {
    label: "Failing after a success",
    consecutiveFailures: 2,
    lastSuccessAt: "2026-09-28T06:00:00.000Z",
    lastFailureAt: "2026-09-29T06:00:00.000Z",
  }),
  row("h_healthy", { label: "Healthy", lastSuccessAt: "2026-09-29T06:00:00.000Z" }),
  row("h_never_run", { label: "Never run" }),
];

describe("health state priority", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(HEALTH_ROWS).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("reads disabled before failing, failing before healthy and healthy before never run", async () => {
    const page = await listAdminDataSourcesPage(testDb.db, defaultSourceListQuery());

    expect(Object.fromEntries(page.items.map((item) => [item.id, item.health]))).toEqual({
      h_disabled_failing: "disabled",
      h_failing_after_success: "failing",
      h_healthy: "healthy",
      h_never_run: "never_run",
    });
  });

  it("filters and counts by the same priority", async () => {
    const withHealth = async (health: SourceHealthState) =>
      (await listAdminDataSourceIndex(testDb.db, filters({ healths: [health] }))).items.map((item) => item.id);

    expect(await withHealth("disabled")).toEqual(["h_disabled_failing"]);
    expect(await withHealth("failing")).toEqual(["h_failing_after_success"]);
    expect(await withHealth("healthy")).toEqual(["h_healthy"]);
    expect(await withHealth("never_run")).toEqual(["h_never_run"]);

    const { facets } = await listAdminDataSourcesPage(testDb.db, defaultSourceListQuery());
    expect(facets.health).toEqual([
      { value: "never_run", count: 1 },
      { value: "healthy", count: 1 },
      { value: "failing", count: 1 },
      { value: "disabled", count: 1 },
    ]);
  });
});
