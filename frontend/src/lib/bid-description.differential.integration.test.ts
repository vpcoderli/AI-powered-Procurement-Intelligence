import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getBidDescriptionIssue } from "./bid-description";

type ClassifiedPair = { text: string; title: string | null; issue: string | null };

// Opt-in with the crawler integration suite: the generator runs the Python classifier.
describe.runIf(process.env.RUN_CRAWLER_INTEGRATION === "1")("description classifier: Python / TypeScript differential", () => {
  it("classifies 60,000 random descriptions built from the contract's vocabulary like Python does", () => {
    const pairs = JSON.parse(execFileSync(
      process.env.CRAWLER_INTEGRATION_PYTHON || "python3",
      [fileURLToPath(new URL("../../scripts/fixtures/description-differential.py", import.meta.url)), "20261012", "60000"],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    )) as ClassifiedPair[];
    const divergences = pairs
      .map((pair) => ({ ...pair, typescript: getBidDescriptionIssue(pair.text, pair.title) }))
      .filter((pair) => pair.typescript !== pair.issue);

    expect(pairs).toHaveLength(60_000);
    expect(divergences.slice(0, 10)).toEqual([]);
    expect(divergences).toHaveLength(0);
  }, 90_000);
});
