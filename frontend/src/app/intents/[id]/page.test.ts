import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readIntentComponent(fileName: string) {
  return readFileSync(new URL(`../../../components/intents/${fileName}`, import.meta.url), "utf8");
}

describe("intent detail page", () => {
  it("wires every paid intent module to feature gating and plan-limit locked states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panels = {
      artifactVault: readIntentComponent("ArtifactVaultPanel.tsx"),
      deadlineNotifications: readIntentComponent("DeadlineNotificationsPanel.tsx"),
      quoteWorkspace: readIntentComponent("QuoteWorkspacePanel.tsx"),
      responseWorkspace: readIntentComponent("ResponseWorkspacePanel.tsx"),
    };

    const paidModules = [
      {
        feature: "submission_guidance",
        featureState: "submissionGuidanceFeature",
        source: page,
        title: 't("intentsPage.submissionGuidance")',
      },
      {
        feature: "compliance_manifest",
        featureState: "complianceManifestFeature",
        source: page,
        title: 't("intentsPage.complianceManifest")',
      },
      {
        feature: "response.workspace.create",
        featureState: "responseWorkspaceFeature",
        panel: panels.responseWorkspace,
        source: page,
        title: 't("intentsPage.responseWorkspace")',
      },
      {
        feature: "artifact.vault.upload",
        featureState: "artifactVaultFeature",
        panel: panels.artifactVault,
        source: page,
        title: 't("intentsPage.artifactVault")',
      },
      {
        feature: "quote_workflow",
        featureState: "quoteWorkflowFeature",
        panel: panels.quoteWorkspace,
        source: page,
        title: 't("intentsPage.quoteWorkspace")',
      },
      {
        feature: "deadline_notifications",
        featureState: "deadlineNotificationsFeature",
        panel: panels.deadlineNotifications,
        source: page,
        title: 't("intentsPage.deadlineNotifications")',
      },
      {
        feature: "knowledge_station",
        featureState: "knowledgeStationFeature",
        source: page,
        title: 't("knowledge.lockedTitle")',
      },
    ];

    for (const paidModule of paidModules) {
      const lockedSource = paidModule.panel ?? paidModule.source;

      expect(page).toContain(`const ${paidModule.featureState} = useFeature("${paidModule.feature}")`);
      expect(paidModule.source).toContain(`${paidModule.featureState}.enabled`);
      expect(paidModule.source).toContain(`lockedFeatureMessage("${paidModule.feature}")`);
      expect(lockedSource).toContain("LockedFeatureState");
      expect(lockedSource).toContain(paidModule.title);
      expect(lockedSource).toContain('code="plan_limit"');
    }
  });

  it("loads and renders qualification evidence citations", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchQualificationCitations");
    expect(page).toContain("fetchQualificationFreshness");
    expect(page).toContain("refreshQualificationEvidence");
    expect(page).toContain("QualificationCitation");
    expect(page).toContain("QualificationFreshnessResponse");
    expect(page).toContain("qualificationCitations");
    expect(page).toContain("qualificationFreshness");
    expect(page).toContain("safeEvidenceUrl");
    expect(page).toContain('t("intentsPage.evidenceCitations")');
    expect(page).toContain('t("intentsPage.qualificationFreshness")');
    expect(page).toContain('t("intentsPage.refreshQualificationEvidence")');
    expect(page).toContain('t("intentsPage.noEvidenceCitations")');
  });

  it("renders document-grounded Q&A controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("postQualificationQuestion");
    expect(page).toContain("qaQuestion");
    expect(page).toContain("qaAnswer");
    expect(page).toContain('useFeature("bid.brief.full.generate")');
    expect(page).toContain('t("intentsPage.askEvidenceQuestion")');
    expect(page).toContain('t("intentsPage.groundedAnswer")');
  });

  it("renders structured pursue/no-bid reason details", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("reasonDetails");
    expect(page).toContain('t("intentsPage.reasonTaxonomy")');
    expect(page).toContain('t(`intentsPage.pursuitReasonCategories.${detail.category}`)');
    expect(page).toContain('t(`intentsPage.pursuitReasonSeverities.${detail.severity}`)');
    expect(page).toContain('t("intentsPage.suggestedAction")');
    expect(page).toContain("evidenceRefs");
    expect(page).toContain("evidenceRefUrl");
    expect(page).toContain('t("intentsPage.linkedEvidence")');
  });

  it("renders compliance evidence reference chips", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("item.evidenceRefs");
    expect(page).toContain('t("intentsPage.linkedEvidence")');
  });

  it("uses UniversalState for intent detail load failures and gated feature sections", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { UniversalState } from "@/components/universal-state"');
    expect(page).toContain('code="error"');
    expect(page).toContain('code="plan_limit"');
    expect(page).toContain('title={t("intentsPage.errorTitle")}');
    expect(page).toContain('message={t("intentsPage.detailErrorDescription")}');
  });

  it("requires authentication before loading personal intent detail APIs", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain('import { AuthRequiredState } from "@/components/auth/AuthRequiredState"');
    expect(page).toContain("const { user, isLoading: isAuthLoading } = useAuth()");
    expect(page).toContain("const intentId = user ? ");
    expect(page).toContain("if (!user) {");
    expect(page).toContain("<AuthRequiredState");
  });

  it("renders Artifact Vault Lite upload and evidence controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("ArtifactVaultPanel.tsx");

    expect(page).toContain("fetchArtifactVault");
    expect(page).toContain("uploadSupplierArtifact");
    expect(page).toContain('useFeature("artifact.vault.upload")');
    expect(page).toContain("artifactVault");
    expect(page).toContain("artifactDraft");
    expect(panel).toContain('t("intentsPage.artifactVault")');
    expect(panel).toContain('t("intentsPage.uploadArtifact")');
    expect(panel).toContain('code="empty"');
    expect(panel).toContain('code="upload_failed"');
  });

  it("renders Quote / Supply Chain Lite controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("QuoteWorkspacePanel.tsx");

    expect(page).toContain("fetchQuoteWorkspace");
    expect(page).toContain("createQuoteRequestDraft");
    expect(page).toContain("updateQuoteRequestDraft");
    expect(page).toContain('useFeature("quote_workflow")');
    expect(page).toContain("quoteWorkspace");
    expect(page).toContain("quoteDraft");
    expect(panel).toContain('t("intentsPage.quoteWorkspace")');
    expect(panel).toContain('t("intentsPage.createQuoteRequest")');
    expect(panel).toContain('code="empty"');
    expect(panel).toContain('code="error"');
  });

  it("renders Deadline Notifications Lite controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("DeadlineNotificationsPanel.tsx");

    expect(page).toContain("fetchDeadlineWorkspace");
    expect(page).toContain("updateDeadlineReminder");
    expect(page).toContain('useFeature("deadline_notifications")');
    expect(page).toContain("deadlineWorkspace");
    expect(panel).toContain('t("intentsPage.deadlineNotifications")');
    expect(panel).toContain('t("intentsPage.acknowledgeReminder")');
    expect(panel).toContain('t("intentsPage.snoozeReminder")');
    expect(panel).toContain('code="empty"');
    expect(panel).toContain('code="error"');
  });

  it("renders Response Workspace assignment and comment controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("ResponseWorkspacePanel.tsx");

    expect(page).toContain("fetchResponseWorkspaceComments");
    expect(page).toContain("createResponseWorkspaceComment");
    expect(page).toContain("updateResponseWorkspaceItemArtifactLinks");
    expect(page).toContain("assignedUserId");
    expect(page).toContain("responseWorkspaceCommentsByItemId");
    expect(page).toContain("responseWorkspaceCommentDrafts");
    expect(page).toContain("availableArtifacts={artifactVault?.artifacts ?? []}");
    expect(page).toContain("onSaveLinkedArtifacts");
    expect(panel).toContain('t("intentsPage.responseWorkspaceAssignee")');
    expect(panel).toContain('t("intentsPage.responseWorkspaceUnassigned")');
    expect(panel).toContain('t("intentsPage.responseWorkspaceLinkedArtifacts")');
    expect(panel).toContain('t("intentsPage.saveResponseWorkspaceArtifacts")');
    expect(panel).toContain('t("intentsPage.responseWorkspaceComments")');
    expect(panel).toContain('t("intentsPage.addResponseWorkspaceComment")');
    expect(panel).toContain('t("intentsPage.responseWorkspaceActivity")');
    expect(panel).toContain('t("intentsPage.responseWorkspaceNoActivity")');
    expect(panel).toContain('t(`intentsPage.responseWorkspaceActivityTypes.${activity.eventType}`)');
  });

  it("renders Response Package snapshot controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("ResponseWorkspacePanel.tsx");

    expect(page).toContain("fetchResponsePackageWorkspace");
    expect(page).toContain("createResponsePackageSnapshot");
    expect(page).toContain("responsePackageWorkspace");
    expect(page).toContain("handleCreateResponsePackageSnapshot");
    expect(panel).toContain('t("intentsPage.responsePackageSnapshot")');
    expect(panel).toContain('t("intentsPage.createResponsePackageSnapshot")');
    expect(panel).toContain('t("intentsPage.responsePackageReadiness")');
    expect(panel).toContain("packageWorkspace?.readiness");
    expect(panel).toContain("packageWorkspace?.snapshots");
    expect(page).toContain("createResponsePackageExport");
    expect(page).toContain("handleCreateResponsePackageExport");
    expect(panel).toContain('t("intentsPage.exportResponsePackage")');
    expect(panel).toContain("onCreatePackageExport");
    expect(panel).toContain("snapshot.exports");
  });
});
