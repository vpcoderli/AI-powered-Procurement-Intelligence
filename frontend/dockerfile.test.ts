import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The images ship the crawler without the repository around it: whatever apsi_crawler reads from disk at run time has to
// be copied in by frontend/Dockerfile, and no test run exercises an image. This pins the one data file the crawler needs.
const dockerfile = readFileSync(new URL("Dockerfile", import.meta.url), "utf8");
const jurisdictionsModule = readFileSync(new URL("../crawler/apsi_crawler/jurisdictions/__init__.py", import.meta.url), "utf8");

/** The instructions of one build stage: everything after its `FROM ... AS <name>` up to the next `FROM`. */
function stageInstructions(name: string): string[] {
  const lines = dockerfile.split("\n");
  const start = lines.findIndex((line) => new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${name}\\s*$`, "i").test(line));
  if (start === -1) throw new Error(`frontend/Dockerfile has no stage named ${name}`);
  const next = lines.findIndex((line, index) => index > start && /^FROM\s/i.test(line));
  return lines.slice(start + 1, next === -1 ? undefined : next).map((line) => line.trim());
}

describe("frontend/Dockerfile crawler data", () => {
  it("copies the jurisdiction table to where apsi_crawler.jurisdictions reads it", () => {
    // BUNDLED_TABLE_PATH is <crawler root>/data/us_jurisdictions.tsv, and the crawler root is the directory that holds the
    // package: /crawler, because the Dockerfile copies the package to /crawler/apsi_crawler.
    expect(jurisdictionsModule).toMatch(/BUNDLED_TABLE_PATH\s*=\s*Path\(__file__\)\.resolve\(\)\.parents\[2\]\s*\/\s*"data"\s*\/\s*"us_jurisdictions\.tsv"/);
    expect(stageInstructions("crawler-runtime")).toContain("COPY --chown=nextjs:nodejs crawler/apsi_crawler /crawler/apsi_crawler");

    const copies = stageInstructions("crawler-runtime").filter((line) => /^COPY\s/i.test(line));
    expect(copies.some((line) => /^COPY\s+(?:--\S+\s+)*crawler\/data\/us_jurisdictions\.tsv\s+\/crawler\/data\/us_jurisdictions\.tsv$/.test(line))).toBe(true);
  });

  it("copies it in the stage that both the runner and the worker image build on", () => {
    expect(dockerfile).toMatch(/^FROM crawler-runtime AS worker$/m);
    expect(dockerfile).toMatch(/^FROM crawler-runtime AS runner$/m);
  });

  it("copies a file that is in the repository", () => {
    expect(existsSync(new URL("../crawler/data/us_jurisdictions.tsv", import.meta.url))).toBe(true);
  });
});
