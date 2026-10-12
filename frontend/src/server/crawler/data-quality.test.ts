import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createImportQualityGate, evaluateCrawlerBid, existingIdentityIssues } from "./data-quality";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

const contract = JSON.parse(readFileSync(path.resolve("../crawler/tests/fixtures/data_quality_contract.json"), "utf8")) as {
  base: Record<string, unknown>;
  cases: Array<{ name: string; override: Record<string, unknown>; coreIssues: string[]; bodyValid: boolean }>;
};
describe("shared Python / TypeScript publication quality contract", () => {
  it.each(contract.cases)("$name", (example) => {
    const quality = evaluateCrawlerBid({ ...contract.base, ...example.override });
    expect(quality.coreIssues).toEqual(example.coreIssues);
    expect(quality.body.valid).toBe(example.bodyValid);
  });
});

describe("intake source identity policy", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({ ...contract.base, source_bid_id: "One", dedupe_key: "portal:One", ...overrides });
  const gate = (bid: Record<string, unknown>, expected: Record<string, unknown>) => createImportQualityGate({
    source: "portal", status: "success", runId: "identity", startedAt: "2026-10-08T00:00:00Z", bids: [bid], metadata: { sourceIdentity: expected },
  } satisfies CrawlerJsonRunPayload);

  it("compares literal expected geography exactly without inferring a different issuer type", () => {
    expect(gate(row({ state_code: "il", jurisdiction_level: "city" }), { stateCode: "IL", issuerType: "state", jurisdictionLevel: "city" }).manifest)
      .toMatchObject({ quarantinedCount: 1, quarantinedRecords: [{ issues: ["source_identity_mismatch:state_code", "source_identity_mismatch:issuer_type"] }] });
  });

  it("preserves legitimate missing-ID fallbacks and does not require optional registration fields", () => {
    for (const [incoming, id] of [[row({ id: "", dedupe_key: "portal:One" }), "portal:One"],
      [row({ id: "", dedupe_key: "" }), "portal:One"], [row({ id: "", dedupe_key: "legacy" }), "legacy"]] as const) {
      const result = gate(incoming, { id: "portal", stateCode: "IL", issuerType: "city", jurisdictionLevel: "city", fipsCode: "1714000" });
      expect(result.manifest.quarantinedCount).toBe(0);
      expect(result.rows[0].row.id).toBe(id);
    }
  });

  it("ignores unrelated metadata identity fields rather than tightening the intake contract", () => {
    expect(gate(row(), { id: "portal", sourceBidId: "other", dedupeKey: "other:one" }).manifest.quarantinedCount).toBe(0);
  });

  it("rejects the exact generic source URL while keeping a specific URL", () => {
    const baseUrl = "https://procurement.example.gov/open-bids";
    expect(gate(row({ source_url: baseUrl }), { baseUrl }).manifest.quarantinedRecords[0].issues).toEqual(["generic_source_url"]);
    expect(gate(row(), { baseUrl }).rows).toHaveLength(1);
  });

  it("keeps all existing nonblank identity fields exact, including stable ID case", () => {
    const before = { source_bid_id: "One", dedupe_key: "Portal:One", state_code: "IL", issuer_type: "city", jurisdiction_level: "city", fips_code: "1714000" };
    const after = { source_bid_id: "one", dedupe_key: "portal:one", state_code: "il", issuer_type: "CITY", jurisdiction_level: "CITY", fips_code: "1715000" };
    expect(existingIdentityIssues(after, before)).toEqual(["identity_changed:source_bid_id", "identity_changed:dedupe_key", "identity_changed:state_code",
      "identity_changed:issuer_type", "identity_changed:jurisdiction_level", "identity_changed:fips_code"]);
    expect(existingIdentityIssues({ ...after, source_bid_id: "", dedupe_key: null, fips_code: null }, {})).toEqual([]);
  });
});
