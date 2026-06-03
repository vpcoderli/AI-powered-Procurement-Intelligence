import { describe, expect, it } from "vitest";
import { parseSourceHealthCheckArgs } from "./source-health-check";

describe("source health check script", () => {
  it("parses persist mode without changing the default report-only behavior", () => {
    expect(parseSourceHealthCheckArgs([])).toMatchObject({
      persist: false,
      reportOnly: false,
      json: false,
      timeoutMs: 10_000,
    });

    expect(parseSourceHealthCheckArgs(["--persist", "--source", "CA", "--json"])).toMatchObject({
      persist: true,
      sourceFilters: ["CA"],
      json: true,
    });
  });

  it("accepts --all as an explicit full source registry selector", () => {
    expect(parseSourceHealthCheckArgs(["--all", "--timeout-ms", "5000", "--report-only"])).toMatchObject({
      sourceFilters: [],
      timeoutMs: 5_000,
      reportOnly: true,
    });
  });
});
