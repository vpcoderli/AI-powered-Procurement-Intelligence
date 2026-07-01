import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("next config file tracing", () => {
  it("excludes next config from response package export route traces", () => {
    const config = readFileSync(new URL("next.config.ts", import.meta.url), "utf8");

    expect(config).toContain("outputFileTracingExcludes");
    expect(config).toContain("/api/intents/*/response-workspace/package/exports");
    expect(config).toContain("./next.config.ts");
    expect(config).toContain("**/next.config.ts");
    expect(config).toContain("ignoreIssue");
    expect(config).toContain("Encountered unexpected file in NFT list");
  });
});
