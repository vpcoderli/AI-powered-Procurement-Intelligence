import { describe, expect, it } from "vitest";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";
import { hasVerifiedEmptyState, validateCrawlerImport } from "./persistence-errors";

const BASE: CrawlerJsonRunPayload = {
  source: "bidnet_ny_erie",
  runId: "run_1",
  status: "success",
  startedAt: "2026-09-16T00:00:00.000Z",
  bids: [],
};

const VERIFIED = {
  verified: true,
  tenant_confirmed: true,
  marker: "There are no open bids at this time.",
  method: "adapter",
};

describe("hasVerifiedEmptyState", () => {
  it("requires both the verified flag and the tenant confirmation", () => {
    expect(hasVerifiedEmptyState({ emptyState: VERIFIED })).toBe(true);
    expect(hasVerifiedEmptyState({ emptyState: { ...VERIFIED, tenant_confirmed: false } })).toBe(false);
    expect(hasVerifiedEmptyState({ emptyState: { ...VERIFIED, verified: false } })).toBe(false);
  });

  it("ignores absent, non-object and truthy-but-not-true markers", () => {
    expect(hasVerifiedEmptyState(null)).toBe(false);
    expect(hasVerifiedEmptyState(undefined)).toBe(false);
    expect(hasVerifiedEmptyState({})).toBe(false);
    expect(hasVerifiedEmptyState({ emptyState: "yes" })).toBe(false);
    expect(hasVerifiedEmptyState({ emptyState: { verified: "true", tenant_confirmed: "true" } })).toBe(false);
  });
});

describe("validateCrawlerImport", () => {
  it("accepts a zero-row success carrying a verified empty state", () => {
    expect(() => validateCrawlerImport({ ...BASE, metadata: { emptyState: VERIFIED } })).not.toThrow();
  });

  it("still refuses a zero-row success whose tenant was never confirmed", () => {
    expect(() =>
      validateCrawlerImport({ ...BASE, metadata: { emptyState: { ...VERIFIED, tenant_confirmed: false } } }),
    ).toThrow("Crawler JSON import refused a successful run with no bid rows.");
  });

  it("keeps accepting the explained date-filter case and rejecting unexplained empties", () => {
    expect(() =>
      validateCrawlerImport({
        ...BASE,
        metadata: { dateFilter: { from: "2026-09-01", to: null, kept: 0, dropped: 3, unparsed: 0 } },
      }),
    ).not.toThrow();
    expect(() => validateCrawlerImport({ ...BASE, metadata: {} })).toThrow(/no bid rows/);
  });
});
