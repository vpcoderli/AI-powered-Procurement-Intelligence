import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("knowledge library page", () => {
  it("loads and filters Knowledge Station library items for entitled users", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("t(\"knowledge.title\")");
    expect(page).toContain("fetchKnowledgeItems");
    expect(page).toContain("knowledge_station");
    expect(page).toContain("type");
    expect(page).toContain("search");
  });

  it("filters unsafe source URLs and localizes dates", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("safeKnowledgeSourceUrl");
    expect(page).toContain("protocol === \"http:\" || protocol === \"https:\"");
    expect(page).toContain("formatDate(item.updatedAt, language)");
    expect(page).not.toContain("href: item.sourceUrl");
    expect(page).not.toContain("Intl.DateTimeFormat(\"en\"");
    expect(page).not.toContain("Knowledge Station");
  });
});
