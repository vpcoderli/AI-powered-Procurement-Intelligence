import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resources glossary route", () => {
  it("renders a public procurement glossary with metadata and safe CTAs", () => {
    const pageUrl = new URL("page.tsx", import.meta.url);
    const clientUrl = new URL("../resource-pages.tsx", import.meta.url);
    const contentUrl = new URL("../../../lib/marketing/resource-content.ts", import.meta.url);

    expect(existsSync(pageUrl)).toBe(true);
    expect(existsSync(clientUrl)).toBe(true);

    const page = readFileSync(pageUrl, "utf8");
    const client = readFileSync(clientUrl, "utf8");
    const content = readFileSync(contentUrl, "utf8");

    expect(page).toContain("metadata");
    expect(page).toContain("Public Bid Glossary");
    expect(page).toContain("ResourceGlossaryPage");
    expect(client).toContain("getGlossaryContent");
    expect(content).toContain("solicitation");
    expect(content).toContain("award_tabulation");
    expect(content).toContain("/resources/supplier-workflow");
    expect(client).not.toMatch(/guarantee.*win|automatically submit/i);
  });
});
