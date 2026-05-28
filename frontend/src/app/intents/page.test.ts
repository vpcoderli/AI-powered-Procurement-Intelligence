import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent pages", () => {
  it("lists intents and links to workspace details", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchIntents");
    expect(page).toContain("/intents/");
    expect(page).toContain("Intent to Bid");
    expect(page).toContain("winbids-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-panel");
  });

  it("loads intent workspace details and guards status updates", () => {
    const detailPage = readFileSync(new URL("[id]/page.tsx", import.meta.url), "utf8");

    expect(detailPage).toContain("fetchIntent");
    expect(detailPage).toContain("fetchSubmissionGuidance");
    expect(detailPage).toContain("updateSubmissionGuidance");
    expect(detailPage).toContain("confirmSubmission");
    expect(detailPage).toContain("updateIntentStatus");
    expect(detailPage).toContain("mountedRef");
    expect(detailPage).toContain("saveRequestRef");
    expect(detailPage).toContain("submissionGuidance");
    expect(detailPage).toContain("handleSaveSubmissionGuidance");
    expect(detailPage).toContain("handleConfirmSubmission");
    expect(detailPage).toContain("intentsPage.submissionGuidanceSaved");
    expect(detailPage).toContain("intentsPage.submissionConfirmationSaved");
    expect(detailPage).toContain("onValueChange={(value)");
    expect(detailPage).toContain("prototypeWorkspace");
    expect(detailPage).toContain("readinessChecklist");
    expect(detailPage).toContain("submissionPath");
    expect(detailPage).toContain("useFeature");
    expect(detailPage).toContain("submission_guidance");
    expect(detailPage).toContain("lockedFeatureMessage");
    expect(detailPage).toContain("Intent Workspace");
    expect(detailPage).toContain("Submission Path");
    expect(detailPage).toContain("winbids-detail-workspace");
    expect(detailPage).toContain("winbids-hero-panel");
    expect(detailPage).toContain("winbids-panel");
  });
});
