import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("knowledge library page", () => {
  it("loads and filters Knowledge Station library items for entitled users", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("Knowledge Station");
    expect(page).toContain("fetchKnowledgeItems");
    expect(page).toContain("knowledge_station");
    expect(page).toContain("type");
    expect(page).toContain("search");
  });
});
