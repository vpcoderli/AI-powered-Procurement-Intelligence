import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app sidebar", () => {
  it("gates the Knowledge Station library navigation item by feature entitlement", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain('"/knowledge"');
    expect(sidebar).toContain('"knowledge_station"');
    expect(sidebar).toContain('"knowledge.library"');
  });
});
