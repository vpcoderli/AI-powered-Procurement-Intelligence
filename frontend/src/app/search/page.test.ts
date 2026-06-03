import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("search route", () => {
  it("renders the bid search workspace behind the Search Bids navigation item", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBids");
    expect(page).toContain("BidCard");
    expect(page).toContain("STATE_FILTERS");
    expect(page).not.toContain("SearchAlertsPage");
    expect(page).not.toContain("../page");
  });

  it("uses the WinBids demo workspace styling in the search route", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("winbids-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-filter-panel");
    expect(page).toContain("Discovery-first queue");
  });

  it("uses UniversalState for search error and empty states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { UniversalState } from "@/components/universal-state"');
    expect(page).toContain('code="error"');
    expect(page).toContain('code="empty"');
    expect(page).toContain('title={t("dashboard.errorTitle")}');
    expect(page).toContain('title={t("dashboard.noResultsTitle")}');
  });
});
