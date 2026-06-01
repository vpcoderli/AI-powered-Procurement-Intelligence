import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bid detail pursuit panel", () => {
  it("loads match score and creates intent from the detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBidMatch");
    expect(page).toContain("createIntent");
    expect(page).toContain("bidIdFromRouteParam");
    expect(page).toContain("const bidId = rawBidId ? bidIdFromRouteParam(rawBidId) : ''");
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

  it("uses UniversalState for bid detail not-found, error, and plan-limit states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { UniversalState } from "@/components/universal-state"');
    expect(page).toContain('code="empty"');
    expect(page).toContain('code="error"');
    expect(page).toContain('code="plan_limit"');
    expect(page).toContain('title={t("detail.notFoundTitle")}');
    expect(page).toContain('title={t("dashboard.errorTitle")}');
  });
});
