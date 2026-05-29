import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bid detail pursuit panel", () => {
  it("loads match score and creates intent from the detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBidMatch");
    expect(page).toContain("createIntent");
    expect(page).toContain("Add to Intent");
    expect(page).toContain("match.score");
    expect(page).toContain("createIntentRequestRef");
    expect(page).toContain("requestedBidId");
    expect(page).toContain("USAGE_LIMIT_REACHED");
    expect(page).toContain("detail.intentLimitReached");
    expect(page).toContain("max-h-72");
    expect(page).toContain("winbids-detail-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-panel");
    expect(page).toContain("archiveTone");
    expect(page).toContain("detail.archiveStatus_archived");
    expect(page).toContain("detail.archiveError");
    expect(page).not.toContain("rounded-xl border border-slate-200 bg-white p-5");
  });
});
