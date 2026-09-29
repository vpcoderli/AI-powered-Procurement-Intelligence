import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { emptySourceListFilters, type SourceListFilters } from "./data-source-list-contract";
import {
  DataSourceQueryError,
  likeContainsPattern,
  listAdminDataSourceIndex,
  listAdminDataSourceIndexFromMysql,
  parseSourceListFilters,
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
