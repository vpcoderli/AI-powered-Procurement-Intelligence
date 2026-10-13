import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const frontend = new URL("./", import.meta.url);
const scripts = (JSON.parse(readFileSync(new URL("package.json", frontend), "utf8")) as { scripts: Record<string, string> }).scripts;

describe("data-integrity npm scripts", () => {
  it.each([
    ["data:integrity", "scripts/data-integrity.ts"],
    ["bids:lifecycle:sweep", "scripts/sweep-bid-lifecycle.ts"],
    ["bids:purge-demo", "scripts/purge-demo-bids.ts"],
  ])("%s runs %s", (name, file) => {
    expect(scripts[name]).toBe(`tsx ${file}`);
    expect(existsSync(new URL(file, frontend))).toBe(true);
  });
});

describe("test:crawler-integration", () => {
  // CI's crawler-integration job runs exactly this script, so a file that is not named in it never runs there. Vitest also
  // ignores a name that matches no file as long as another one matches, so a misspelt entry skips its test without a word.
  const listed = scripts["test:crawler-integration"].split(/\s+/).filter((token) => /\.test\.tsx?$/.test(token));

  const integrationTests = ["src", "scripts"].flatMap((directory) =>
    readdirSync(new URL(`${directory}/`, frontend), { recursive: true, encoding: "utf8" })
      .map((entry) => entry.split("\\").join("/"))
      .filter((entry) => entry.endsWith(".integration.test.ts"))
      .map((entry) => `${directory}/${entry}`));

  it("finds the integration tests it is about", () => {
    // Guards the walk itself: an empty list would make the next test pass for nothing.
    expect(integrationTests.length).toBeGreaterThanOrEqual(10);
    expect(integrationTests).toContain("src/server/integrity/data-integrity.mysql.integration.test.ts");
  });

  it("names every *.integration.test.ts under src and scripts", () => {
    expect(integrationTests.filter((file) => !listed.includes(file)).sort()).toEqual([]);
  });

  it("names only files that exist, each once", () => {
    expect(listed.filter((file) => !existsSync(fileURLToPath(new URL(file, frontend)))).sort()).toEqual([]);
    expect(listed.filter((file, index) => listed.indexOf(file) !== index)).toEqual([]);
  });
});
