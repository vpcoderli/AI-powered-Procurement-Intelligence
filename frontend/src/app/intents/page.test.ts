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

  it("supports dashboard pipeline query drill-down filters", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("useSearchParams");
    expect(page).toContain("pipelineFilter");
    expect(page).toContain("PIPELINE_FILTERS");
    expect(page).toContain("visibleIntents");
    expect(page).toContain("pipeline=ready");
    expect(page).toContain("pipeline=blocked");
    expect(page).toContain("/intents");
  });

  it("shows an auth-required state before loading personal intent workspaces", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("AuthRequiredState");
    expect(page).toContain("useAuth");
    expect(page).toContain("if (!user)");
    expect(page).toContain("fetchIntents");
  });

  it("loads intent workspace details and guards status updates", () => {
    const detailPage = readFileSync(new URL("[id]/page.tsx", import.meta.url), "utf8");

    expect(detailPage).toContain("fetchIntent");
    expect(detailPage).toContain("fetchSubmissionGuidance");
    expect(detailPage).toContain("fetchComplianceManifest");
    expect(detailPage).toContain("fetchPursuitDecisionBoard");
    expect(detailPage).toContain("fetchResponseWorkspace");
    expect(detailPage).toContain("updateSubmissionGuidance");
    expect(detailPage).toContain("updateComplianceManifestItem");
    expect(detailPage).toContain("updatePursuitDecision");
    expect(detailPage).toContain("updateResponseWorkspaceItem");
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
    expect(detailPage).toContain("compliance_manifest");
    expect(detailPage).toContain("response.workspace.create");
    expect(detailPage).toContain("complianceManifest");
    expect(detailPage).toContain("handleComplianceItemUpdate");
    expect(detailPage).toContain("pursuitDecisionBoard");
    expect(detailPage).toContain("handleSavePursuitDecision");
    expect(detailPage).toContain("responseWorkspace");
    expect(detailPage).toContain("handleResponseWorkspaceItemUpdate");
    expect(detailPage).toContain("intentsPage.complianceManifest");
    expect(detailPage).toContain("intentsPage.complianceManifestSaved");
    expect(detailPage).toContain("intentsPage.pursuitDecision");
    expect(detailPage).toContain("intentsPage.pursuitDecisionSaved");
    expect(detailPage).toContain("intentsPage.responseWorkspace");
    expect(detailPage).toContain("intentsPage.responseWorkspaceSaved");
    expect(detailPage).toContain("lockedFeatureMessage");
    expect(detailPage).toContain("intentsPage.workspaceKicker");
    expect(detailPage).toContain("intentsPage.submissionPathTitle");
    expect(detailPage).toContain("intentsPage.knowledgeStationCoachAriaLabel");
    expect(detailPage).toContain("knowledgeStationCoach");
    expect(detailPage).toContain("knowledge_station");
    expect(detailPage).toContain("createKnowledgeItem");
    expect(detailPage).toContain("fetchKnowledgeItems");
    expect(detailPage).toContain("card.href ?? intent.bid.sourceUrl");
    expect(detailPage).toContain("winbids-detail-workspace");
    expect(detailPage).toContain("winbids-hero-panel");
    expect(detailPage).toContain("winbids-panel");
  });
});
