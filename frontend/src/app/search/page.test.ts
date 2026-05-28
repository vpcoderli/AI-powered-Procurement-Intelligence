import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("search route", () => {
  it("renders the bid search workspace behind the Search Bids navigation item", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("../page");
    expect(page).toContain("Dashboard");
    expect(page).not.toContain("SearchAlertsPage");
  });

  it("uses the WinBids demo workspace styling through the real dashboard route", () => {
    const dashboardPage = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");

    expect(dashboardPage).toContain("winbids-workspace");
    expect(dashboardPage).toContain("winbids-hero-panel");
    expect(dashboardPage).toContain("winbids-filter-panel");
    expect(dashboardPage).toContain("Discovery-first queue");
  });
});
