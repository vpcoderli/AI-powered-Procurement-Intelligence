import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("search route", () => {
  it("renders the bid search workspace behind the Search Bids navigation item", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("../page");
    expect(page).toContain("Dashboard");
    expect(page).not.toContain("SearchAlertsPage");
  });
});
