import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readIntentComponent(fileName: string) {
  return readFileSync(new URL(`../../../components/intents/${fileName}`, import.meta.url), "utf8");
}

describe("intent detail page", () => {
  it("keeps premium intent locks on shared upgrade messaging instead of unavailable states", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const featureHelper = readFileSync(new URL("../../../lib/features/useFeature.ts", import.meta.url), "utf8");

    expect(featureHelper).toContain("Upgrade to ${requiredTier} to unlock this feature.");

    for (const feature of ["submission_guidance", "compliance_manifest"]) {
      expect(page).toContain(`message={lockedFeatureMessage("${feature}")}`);
    }

    expect(page).toContain('lockedFeatureMessage("knowledge_station")');

    expect(page).not.toContain('code="permission_denied"');
  });

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

  it("renders deterministic AI metadata and credit dry-run details for Q&A answers", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("qaAnswer?.aiRun");
    expect(page).toContain("qaAnswer.creditUsage");
    expect(page).toContain("qaAnswer.creditUsage.chargedAmount");
    expect(page).toContain('t("intentsPage.aiRunMetadata")');
    expect(page).toContain('t("intentsPage.aiDeterministicNoLlmNotice")');
    expect(page).toContain('t("intentsPage.aiProvider")');
    expect(page).toContain('t("intentsPage.aiModelOrRulesVersion")');
    expect(page).toContain('t("intentsPage.aiPromptVersion")');
    expect(page).toContain('t("intentsPage.aiConfidence")');
    expect(page).toContain('t("intentsPage.aiCostTotal")');
    expect(page).toContain('t("intentsPage.aiFallbackReason")');
    expect(page).toContain('t("intentsPage.aiGeneratedAt")');
    expect(page).toContain('t("intentsPage.aiMetadataUnavailable")');
    expect(page).toContain('t("intentsPage.creditDryRun")');
    expect(page).toContain('t("intentsPage.creditChargedAmount")');
  });

  it("renders Knowledge retrieval trace only inside the enabled Knowledge Station area", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("KnowledgeRetrievalTrace");
    expect(page).toContain("knowledgeRetrievalTrace");
    expect(page).toContain("includeRetrievalTrace: true");
    expect(page).toContain("response.retrievalTrace");
    expect(page).toContain("knowledgeStationFeature.enabled");
    expect(page).toContain("selectedItemIds");
    expect(page).toContain("matchedFields.length");
    expect(page).toContain("futureEmbeddingStatus.status");
    expect(page).toContain('t("knowledge.retrievalTrace")');
    expect(page).toContain('t("knowledge.retrievalTraceOperatorOnly")');
    expect(page).toContain('t("knowledge.selectedItemIds")');
    expect(page).toContain('t("knowledge.matchedFields")');
    expect(page).toContain('t("knowledge.futureEmbeddingStatus")');
    expect(page).toContain('t("knowledge.retrievalTraceUnavailable")');
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

  it("renders submission status and confirmation history while gated", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("const [submissionConfirmations");
    expect(page).toContain('t("intentsPage.submissionStatus")');
    expect(page).toContain('t(`intentsPage.submissionStatuses.${submissionGuidance.status}`)');
    expect(page).toContain('t("intentsPage.confirmationHistory")');
    expect(page).toContain("response.confirmations");
    expect(page).toContain("submissionGuidanceFeature.enabled");
  });

  it("renders submission evidence links returned by guidance and confirmation APIs", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("SubmissionEvidenceLinks");
    expect(page).toContain("const [submissionEvidenceLinks");
    expect(page).toContain("response.evidenceLinks");
    expect(page).toContain("responsePackageExports");
    expect(page).toContain("linkedSupplierArtifacts");
    expect(page).toContain("awardOutcome");
    expect(page).toContain("downloadUrl");
    expect(page).toContain("artifactDownloadUrl");
    expect(page).toContain('t("intentsPage.submissionEvidence")');
    expect(page).toContain('t("intentsPage.submissionEvidenceEmpty")');
    expect(page).toContain('t("intentsPage.submissionEvidencePackageExports")');
    expect(page).toContain('t("intentsPage.submissionEvidenceLinkedArtifacts")');
    expect(page).toContain('t("intentsPage.submissionEvidenceAwardOutcome")');
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
    expect(page).toContain("deleteSupplierArtifact");
    expect(page).toContain("replaceSupplierArtifact");
    expect(page).toContain("handleDeleteSupplierArtifact");
    expect(page).toContain("handleReplaceSupplierArtifact");
    expect(page).toContain("deletingArtifactId");
    expect(page).toContain("replacingArtifactId");
    expect(page).toContain("onDelete={handleDeleteSupplierArtifact}");
    expect(page).toContain("onReplace={handleReplaceSupplierArtifact}");
    expect(page).toContain('useFeature("artifact.vault.upload")');
    expect(page).toContain("artifactVault");
    expect(page).toContain("artifactDraft");
    expect(panel).toContain('t("intentsPage.artifactVault")');
    expect(panel).toContain('t("intentsPage.uploadArtifact")');
    expect(panel).toContain('t("intentsPage.artifactDelete")');
    expect(panel).toContain('t("intentsPage.artifactVersions")');
    expect(panel).toContain('t("intentsPage.artifactReplace")');
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

  it("renders procurement workflow read-model summaries on the intent page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("quoteComparisonSummary");
    expect(page).toContain("lowAmountCents");
    expect(page).toContain("medianAmountCents");
    expect(page).toContain("highAmountCents");
    expect(page).toContain("spreadAmountCents");
    expect(page).toContain("recommendedReviewFlags");
    expect(page).toContain("learningSummary");
    expect(page).toContain("primaryDriver");
    expect(page).toContain("recommendedActions");
    expect(page).toContain("submissionEvidenceAutoLinkSummary");
    expect(page).toContain("responsePackageExports.length");
    expect(page).toContain("linkedSupplierArtifacts.length");
    expect(page).toContain("artifact/submission evidence");
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

  it("renders Award / Win-Loss Lite controls behind feature gating", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const panel = readIntentComponent("AwardWinLossPanel.tsx");

    expect(page).toContain('import { AwardWinLossPanel } from "@/components/intents/AwardWinLossPanel"');
    expect(page).toContain("fetchAwardOutcome");
    expect(page).toContain("updateAwardOutcome");
    expect(page).toContain('useFeature("award.tabulation.analyze")');
    expect(page).toContain("awardOutcome");
    expect(page).toContain("handleAwardOutcomeUpdate");
    expect(page).toContain("<AwardWinLossPanel");
    expect(page).toContain("availableArtifacts={artifactVault?.artifacts ?? []}");
    expect(page).toContain('lockedFeatureMessage("award.tabulation.analyze")');
    expect(panel).toContain('t("intentsPage.awardWinLoss")');
    expect(panel).toContain('t("intentsPage.awardNoticeUrl")');
    expect(panel).toContain('t("intentsPage.tabulationArtifact")');
    expect(panel).toContain('t("intentsPage.tabulationArtifactUrl")');
    expect(panel).toContain('t("intentsPage.winnerName")');
    expect(panel).toContain('t("intentsPage.awardAmount")');
    expect(panel).toContain('t("intentsPage.lossReason")');
    expect(panel).toContain('t("intentsPage.nextAction")');
    expect(panel).toContain('t("intentsPage.nextActionDueAt")');
    expect(panel).toContain('t("intentsPage.awardNotes")');
    expect(panel).toContain('code="plan_limit"');
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
    expect(panel).toContain("responsePackageExportFormatOptions");
    expect(panel).toContain("formatOption");
    expect(panel).toContain("onCreatePackageExport(snapshot.id, formatOption)");
    expect(page).toContain("handleCreateResponsePackageExport(snapshotId");
    expect(page).toContain("format: ResponsePackageExportFormat");
    expect(page).toContain("updateResponsePackageExportReview");
    expect(page).toContain("handleReviewResponsePackageExport");
    expect(panel).toContain("snapshot.exports");
    expect(panel).toContain("snapshot.version.versionNumber");
    expect(panel).toContain("snapshot.version.changes");
    expect(panel).toContain('t("intentsPage.responsePackageVersion")');
    expect(panel).toContain('t("intentsPage.responsePackageChangesSincePrevious")');
    expect(panel).toContain('t("intentsPage.responsePackageNoVersionChanges")');
    expect(panel).toContain("packageWorkspace?.versionHistory");
    expect(panel).toContain("visiblePackageSnapshots");
    expect(panel).toContain("showAllPackageSnapshots");
    expect(panel).toContain("setShowAllPackageSnapshots");
    expect(panel).toContain('t("intentsPage.responsePackageVersionHistory")');
    expect(panel).toContain('t("intentsPage.responsePackageTotalVersions")');
    expect(panel).toContain('t("intentsPage.responsePackageTotalChanges")');
    expect(panel).toContain('t("intentsPage.showAllResponsePackageVersions")');
    expect(panel).toContain('t("intentsPage.showRecentResponsePackageVersions")');
    expect(panel).toContain("packageWorkspace?.versionComparisons");
    expect(panel).toContain("selectedPackageComparisonKey");
    expect(panel).toContain("selectedPackageComparison");
    expect(panel).toContain("comparison.items");
    expect(panel).toContain('t("intentsPage.responsePackageSideBySideComparison")');
    expect(panel).toContain('t("intentsPage.responsePackageCompareVersions")');
    expect(panel).toContain('t("intentsPage.responsePackageFromVersion")');
    expect(panel).toContain('t("intentsPage.responsePackageToVersion")');
    expect(panel).toContain('t("intentsPage.responsePackageComparisonNoChanges")');
    expect(panel).toContain("onReviewPackageExport");
    expect(panel).toContain("approveResponsePackageExport");
    expect(panel).toContain("requestResponsePackageChanges");
    expect(panel).toContain("responsePackageExportReviewStatuses");
    expect(panel).toContain("responsePackageReviewHistory");
    expect(panel).toContain("exportRecord.reviewHistory");
    expect(panel).toContain("responsePackageExportFormats");
    expect(panel).toContain("exportRecord.format");
    expect(panel).toContain("packageWorkspace?.governanceSummary");
    expect(panel).toContain("governanceSummary.pendingReviewCount");
    expect(panel).toContain("governanceSummary.approvedCount");
    expect(panel).toContain("governanceSummary.needsChangesCount");
    expect(panel).toContain("governanceSummary.longestPendingAgeHours");
    expect(panel).toContain("governanceSummary.latestReviewerUserId");
    expect(panel).toContain("governanceSummary.canSubmitWithReviewedExport");
    expect(panel).toContain('t("intentsPage.responsePackageGovernance")');
    expect(panel).toContain('t("intentsPage.responsePackageGovernanceReviewedExportReady")');
    expect(panel).toContain('t("intentsPage.responsePackageGovernanceNoReviewer")');
  });
});
