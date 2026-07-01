import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resources hub route", () => {
  it("renders a bilingual SEO resource hub without implying submission or win guarantees", () => {
    const pageUrl = new URL("page.tsx", import.meta.url);
    const clientUrl = new URL("resource-pages.tsx", import.meta.url);
    const contentUrl = new URL("../../lib/marketing/resource-content.ts", import.meta.url);

    expect(existsSync(pageUrl)).toBe(true);
    expect(existsSync(clientUrl)).toBe(true);

    const page = readFileSync(pageUrl, "utf8");
    const client = readFileSync(clientUrl, "utf8");
    const content = readFileSync(contentUrl, "utf8");

    expect(page).toContain("metadata");
    expect(page).toContain("WinBids Resources");
    expect(page).toContain("ResourceHubPage");
    expect(client).toContain("useLanguage");
    expect(client).toContain("getResourceHubContent");
    expect(content).toContain("/resources/glossary");
    expect(content).toContain("/resources/supplier-workflow");
    expect(client).toContain("safeClaims");
    expect(client).not.toMatch(/guarantee.*win|guaranteed.*award|automatically submit/i);
  });
});
