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

  it("orders state-level sources before county and city", () => {
    const city = source({ id: "city", jurisdictionLevel: "city" });
    const county = source({ id: "county", jurisdictionLevel: "county" });
    const state = source({ id: "state", jurisdictionLevel: "state" });
    const ordered = selectDueSources([city, county, state], NOW).map((s) => s.id);
    expect(ordered).toEqual(["state", "county", "city"]);
  });

  it("interleaves sources of the same provider family", () => {
    const sources = [
      source({ id: "bidnet_1", providerFamily: "bidnet" }),
      source({ id: "bidnet_2", providerFamily: "bidnet" }),
      source({ id: "bidnet_3", providerFamily: "bidnet" }),
      source({ id: "bonfire_1", providerFamily: "bonfire" }),
    ];
    const ordered = selectDueSources(sources, NOW).map((s) => s.providerFamily);
    expect(ordered[0]).not.toBe(ordered[1]);
  });
});
