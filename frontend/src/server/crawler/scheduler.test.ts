import { describe, expect, it } from "vitest";
import type { CrawlableSource } from "./source-registry";
import { cadenceIntervalMs, nextDueAt, selectDueSources } from "./scheduler";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function source(overrides: Partial<CrawlableSource> = {}): CrawlableSource {
  return {
    id: "src",
    label: "Source",
    issuerType: "state",
    stateCode: "CA",
    baseUrl: "https://example.gov",
    cadence: "daily",
    providerFamily: null,
    jurisdictionLevel: "state",
    jurisdictionName: "California",
    fipsCode: "06",
    fetchConfig: {},
    lastSuccessAt: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

describe("cadenceIntervalMs", () => {
  it("maps known cadences to their intervals", () => {
    expect(cadenceIntervalMs("hourly")).toBe(60 * 60 * 1000);
    expect(cadenceIntervalMs("daily")).toBe(24 * 60 * 60 * 1000);
    expect(cadenceIntervalMs("weekly")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("returns null for manual so it never auto-schedules", () => {
    expect(cadenceIntervalMs("manual")).toBeNull();
  });

  it("falls back to daily for unknown values", () => {
    expect(cadenceIntervalMs("fortnightly")).toBe(24 * 60 * 60 * 1000);
    expect(cadenceIntervalMs("")).toBe(24 * 60 * 60 * 1000);
  });
});

describe("nextDueAt", () => {
  it("returns null for a source that never succeeded (due immediately)", () => {
    expect(nextDueAt(source({ lastSuccessAt: null }))).toBeNull();
  });

  it("adds the cadence interval to the last success", () => {
    expect(nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z" }))).toBe(
      "2026-07-29T12:00:00.000Z",
    );
  });

  it("doubles the interval per consecutive failure", () => {
    expect(
      nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z", consecutiveFailures: 2 })),
    ).toBe("2026-08-01T12:00:00.000Z");
  });

  it("caps backoff at seven days", () => {
    expect(
      nextDueAt(source({ lastSuccessAt: "2026-07-28T12:00:00.000Z", consecutiveFailures: 20 })),
    ).toBe("2026-08-04T12:00:00.000Z");
  });
});

describe("selectDueSources", () => {
  it("includes sources that never succeeded", () => {
    expect(selectDueSources([source({ lastSuccessAt: null })], NOW)).toHaveLength(1);
  });

  it("excludes sources whose next run is in the future", () => {
    const notYet = source({ lastSuccessAt: "2026-07-29T06:00:00.000Z" });
    expect(selectDueSources([notYet], NOW)).toHaveLength(0);
  });

  it("excludes manual sources entirely", () => {
    const manual = source({ cadence: "manual", lastSuccessAt: null });
    expect(selectDueSources([manual], NOW)).toHaveLength(0);
  });

  it("returns an empty array for empty input", () => {
    expect(selectDueSources([], NOW)).toEqual([]);
  });

  it("orders all five jurisdiction levels: federal, state, county, city, special_district", () => {
    const city = source({ id: "city", jurisdictionLevel: "city" });
    const specialDistrict = source({ id: "special_district", jurisdictionLevel: "special_district" });
    const county = source({ id: "county", jurisdictionLevel: "county" });
    const federal = source({ id: "federal", jurisdictionLevel: "federal" });
    const state = source({ id: "state", jurisdictionLevel: "state" });
    // Deliberately scrambled input order; the assertion pins the required output order.
    const ordered = selectDueSources([city, specialDistrict, county, federal, state], NOW).map(
      (s) => s.id,
    );
    expect(ordered).toEqual(["federal", "state", "county", "city", "special_district"]);
  });

  it("treats a null jurisdiction level as lowest priority, after all named levels", () => {
    const city = source({ id: "city", jurisdictionLevel: "city" });
    const unknown = source({ id: "unknown", jurisdictionLevel: null });
    const ordered = selectDueSources([unknown, city], NOW).map((s) => s.id);
    expect(ordered).toEqual(["city", "unknown"]);
  });

  it("interleaves sources of the same provider family instead of grouping them together", () => {
    const sources = [
      source({ id: "bidnet_1", providerFamily: "bidnet" }),
      source({ id: "bidnet_2", providerFamily: "bidnet" }),
      source({ id: "bidnet_3", providerFamily: "bidnet" }),
      source({ id: "bonfire_1", providerFamily: "bonfire" }),
    ];
    // Round-robin across families: bidnet (3) and bonfire (1) alternate one turn each: the
    // first bidnet source pairs with the only bonfire source, then the remaining two bidnet
    // sources run back-to-back because bonfire has nothing left to interleave with. Full
    // separation is impossible once one family holds more than half of the sources.
    const ordered = selectDueSources(sources, NOW).map((s) => s.id);
    expect(ordered).toEqual(["bidnet_1", "bonfire_1", "bidnet_2", "bidnet_3"]);
  });

  it("lets provider-family interleaving take precedence over strict due-time order", () => {
    // x1 and x2 share a provider family and are, by due time, the two most overdue sources;
    // y1 is a different family, due later than both. Strict due-time order would be
    // [x1, x2, y1], but the scheduler interleaves families within the jurisdiction level
    // first, so x2 (same family as x1) is pushed behind y1 even though x2 is due earlier.
    // This is intentional: at 2000+ source scale, a few minutes of due-time drift is cheap
    // while hammering one platform risks rate-limiting or an outright block, so platform
    // diversity is prioritized over strict recency.
    const x1 = source({
      id: "x1",
      providerFamily: "family-x",
      lastSuccessAt: "2026-07-28T00:00:00.000Z", // nextDueAt 2026-07-29T00:00:00.000Z
    });
    const x2 = source({
      id: "x2",
      providerFamily: "family-x",
      lastSuccessAt: "2026-07-28T04:00:00.000Z", // nextDueAt 2026-07-29T04:00:00.000Z
    });
    const y1 = source({
      id: "y1",
      providerFamily: "family-y",
      lastSuccessAt: "2026-07-28T08:00:00.000Z", // nextDueAt 2026-07-29T08:00:00.000Z
    });

    const ordered = selectDueSources([y1, x1, x2], NOW).map((s) => s.id);
    expect(ordered).toEqual(["x1", "y1", "x2"]);
  });

  it("caps each provider_family to the platform concurrency limit", () => {
    const sources = Array.from({ length: 15 }, (_, i) =>
      source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
    );
    const result = selectDueSources(sources, NOW);
    expect(result).toHaveLength(10);
    expect(result.every((s) => s.providerFamily === "bidnet")).toBe(true);
  });

  it("applies the cap independently per provider_family", () => {
    const bidnets = Array.from({ length: 12 }, (_, i) =>
      source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
    );
    const bonfires = Array.from({ length: 8 }, (_, i) =>
      source({ id: `bonfire_${i}`, providerFamily: "bonfire" }),
    );
    const result = selectDueSources([...bidnets, ...bonfires], NOW);
    const bidnetCount = result.filter((s) => s.providerFamily === "bidnet").length;
    const bonfireCount = result.filter((s) => s.providerFamily === "bonfire").length;
    expect(bidnetCount).toBe(10);
    expect(bonfireCount).toBe(8);
  });

  it("does not cap dedicated sources (null providerFamily)", () => {
    const dedicated = Array.from({ length: 15 }, (_, i) =>
      source({ id: `dedicated_${i}`, providerFamily: null }),
    );
    const result = selectDueSources(dedicated, NOW);
    expect(result).toHaveLength(15);
  });

  it("accepts a custom cap via options", () => {
    const sources = Array.from({ length: 20 }, (_, i) =>
      source({ id: `bidnet_${i}`, providerFamily: "bidnet" }),
    );
    const result = selectDueSources(sources, NOW, { platformConcurrencyCap: 5 });
    expect(result).toHaveLength(5);
  });
});
