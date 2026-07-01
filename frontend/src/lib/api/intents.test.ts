import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./bids";
import {
  confirmSubmission,
  createIntent,
  fetchComplianceManifest,
  fetchIntent,
  fetchIntents,
  fetchPursuitDecisionBoard,
  fetchQualificationCitations,
  fetchQualificationFreshness,
  fetchResponseWorkspace,
  fetchResponseWorkspaceComments,
  fetchResponsePackageWorkspace,
  createResponsePackageExport,
  updateResponsePackageExportReview,
  postQualificationQuestion,
  refreshQualificationEvidence,
  createResponsePackageSnapshot,
  fetchAwardOutcome,
  updateComplianceManifestItem,
  updateAwardOutcome,
  createResponseWorkspaceComment,
  replaceSupplierArtifact,
  fetchSubmissionGuidance,
  updateIntentStatus,
  updatePursuitDecision,
  updateResponseWorkspaceItemArtifactLinks,
  updateResponseWorkspaceItem,
  updateSubmissionGuidance,
} from "./intents";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

const intent = {
  id: "intent/with space",
  status: "intent_added",
  bid: { id: "bid/with space", title: "Cloud" },
};

describe("intent API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an intent with an encoded bid id", async () => {
    const body = { intent };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await createIntent("bid/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/bids/bid%2Fwith%20space/intent", {
      method: "POST",
    });
  });

  it("parses usage limit errors when creating an intent", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      error: {
        code: "USAGE_LIMIT_REACHED",
        message: "Pro plan is required to create more intent workspaces.",
        feature: "intent_workspace",
        limit: 2,
        used: 2,
        requiredTier: "pro",
      },
    }, { status: 402 }));

    await expect(createIntent("bid_3")).rejects.toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      status: 402,
      message: "Pro plan is required to create more intent workspaces.",
    });
  });

  it("fetches intents", async () => {
    const body = { intents: [intent] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchIntents();

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents");
  });

  it("fetches an intent with an encoded id", async () => {
    const body = { intent };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchIntent("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space");
  });

  it("patches status with an encoded id", async () => {
    const body = { intent: { ...intent, status: "needs_review" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateIntentStatus("intent/with space", "needs_review");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "needs_review" }),
    });
  });

  it("fetches submission guidance with an encoded intent id", async () => {
    const body = {
      submission: { id: "submission_path_1", method: "external_portal", status: "draft" },
      confirmations: [],
      evidenceLinks: {
        responsePackageExports: [{
          id: "response_package_export_1",
          format: "markdown",
          downloadUrl: "/api/intents/intent%2Fwith%20space/response-workspace/package/exports/response_package_export_1",
        }],
        linkedSupplierArtifacts: [{ id: "supplier_artifact_1", name: "Signed capability statement" }],
        awardOutcome: { status: "awarded_to_us", awardNoticeUrl: "https://sam.gov/award/notice" },
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchSubmissionGuidance("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/submission");
  });

  it("patches submission guidance fields", async () => {
    const payload = { method: "email" as const, status: "ready" as const, requiresRegistration: false };
    const body = { submission: { id: "submission_path_1", ...payload } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateSubmissionGuidance("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/submission", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("posts a submission confirmation", async () => {
    const payload = {
      submittedAt: "2026-05-29T15:30:00.000Z",
      method: "external_portal" as const,
      confirmationReference: "CONF-123",
      confirmationNotes: "Receipt downloaded.",
    };
    const body = {
      confirmation: { id: "submission_confirmation_1", ...payload },
      submission: { id: "submission_path_1", status: "submitted" },
      confirmations: [{ id: "submission_confirmation_1", ...payload }],
      evidenceLinks: {
        responsePackageExports: [{
          id: "response_package_export_1",
          format: "zip",
          downloadUrl: "/api/intents/intent%2Fwith%20space/response-workspace/package/exports/response_package_export_1",
        }],
        linkedSupplierArtifacts: [{ id: "supplier_artifact_1", name: "Signed capability statement" }],
        awardOutcome: { status: "awarded_to_us", awardNoticeUrl: "https://sam.gov/award/notice" },
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await confirmSubmission("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/submission/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetches award outcome with an encoded intent id", async () => {
    const body = {
      outcome: {
        intentId: "intent/with space",
        status: "awaiting_award",
        lossReason: "unknown",
        nextAction: "capture_tabulation",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchAwardOutcome("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/award");
  });

  it("patches award outcome fields", async () => {
    const payload = {
      status: "awarded_to_competitor" as const,
      lossReason: "price_uncompetitive" as const,
      winnerName: "Delta Integrators",
    };
    const body = { outcome: { id: "award_outcome_1", ...payload } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateAwardOutcome("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/award", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetches compliance manifest with an encoded intent id", async () => {
    const body = {
      manifest: {
        intentId: "intent/with space",
        items: [{
          id: "compliance_item_1",
          evidenceRefs: [{ kind: "source_url", label: "Original source", url: "https://example.gov/bid" }],
        }],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchComplianceManifest("intent/with space");

    expect(result).toEqual(body);
    expect(result.manifest.items[0].evidenceRefs[0]).toMatchObject({ kind: "source_url" });
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/compliance");
  });

  it("updates a compliance manifest item", async () => {
    const payload = {
      itemId: "compliance_item_1",
      status: "complete" as const,
      evidenceStatus: "attached" as const,
      notes: "Capability statement uploaded.",
    };
    const body = { manifest: { intentId: "intent/with space", items: [{ id: payload.itemId }] } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateComplianceManifestItem("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/compliance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetches response workspace with an encoded intent id", async () => {
    const body = {
      workspace: {
        intentId: "intent/with space",
        summary: { total: 1, done: 0, blocked: 0 },
        items: [{ id: "response_workspace_item_1", status: "todo" }],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchResponseWorkspace("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/response-workspace");
  });

  it("updates a response workspace item", async () => {
    const payload = {
      itemId: "response_workspace_item_1",
      status: "done" as const,
      notes: "Ready for review.",
      assignedUserId: "member_1",
    };
    const body = { workspace: { intentId: "intent/with space", items: [{ id: payload.itemId }] } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateResponseWorkspaceItem("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/response-workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("updates linked response workspace artifacts with an encoded intent id", async () => {
    const body = {
      workspace: {
        intentId: "intent/with space",
        items: [{
          id: "response_workspace_item_1",
          linkedArtifacts: [{ id: "artifact/with space" }],
          activity: [],
        }],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateResponseWorkspaceItemArtifactLinks(
      "intent/with space",
      "response_workspace_item_1",
      ["artifact/with space"],
    );

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/response-workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: "response_workspace_item_1",
        linkedArtifactIds: ["artifact/with space"],
      }),
    });
  });

  it("fetches response workspace comments for an item", async () => {
    const body = {
      comments: [{
        id: "response_workspace_comment_1",
        itemId: "response_workspace_item_1",
        body: "Please validate staffing.",
      }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchResponseWorkspaceComments("intent/with space", "response_workspace_item_1");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/comments?itemId=response_workspace_item_1",
    );
  });

  it("creates a response workspace comment", async () => {
    const payload = {
      itemId: "response_workspace_item_1",
      body: "Please validate staffing.",
    };
    const body = { comment: { id: "response_workspace_comment_1", ...payload } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await createResponseWorkspaceComment("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
  });

  it("replaces a supplier artifact with an encoded intent and artifact id", async () => {
    const body = {
      vault: {
        intentId: "intent/with space",
        artifacts: [{
          id: "artifact/with space",
          fileName: "capability-v2.pdf",
          versions: [{ versionNumber: 1 }, { versionNumber: 2 }],
        }],
      },
    };
    const file = new File(["new capability"], "capability-v2.pdf", { type: "application/pdf" });
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await replaceSupplierArtifact("intent/with space", "artifact/with space", {
      file,
      replacementReason: "Updated past performance.",
      notes: "Ready.",
    });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/artifacts/artifact%2Fwith%20space",
      expect.objectContaining({
        method: "PUT",
        body: expect.any(FormData),
      }),
    );
    const form = (mockFetch.mock.calls.at(-1)?.[1] as RequestInit).body as FormData;
    expect(form.get("file")).toBe(file);
    expect(form.get("replacementReason")).toBe("Updated past performance.");
    expect(form.get("notes")).toBe("Ready.");
  });

  it("fetches response package workspace with an encoded intent id", async () => {
    const body = {
      packageWorkspace: {
        readiness: { ready: false, missingArtifactLinks: 1 },
        outline: [],
        snapshots: [],
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchResponsePackageWorkspace("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/package",
    );
  });

  it("creates a response package snapshot with an encoded intent id", async () => {
    const body = {
      snapshot: { id: "response_package_snapshot_1", title: "Draft package" },
      packageWorkspace: { snapshots: [{ id: "response_package_snapshot_1" }] },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await createResponsePackageSnapshot("intent/with space", { title: "Draft package" });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/package",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Draft package" }),
      },
    );
  });

  it("creates a response package export with an encoded intent id", async () => {
    const body = {
      exportRecord: {
        id: "response_package_export_1",
        downloadUrl: "/api/intents/intent%2Fwith%20space/response-workspace/package/exports/response_package_export_1",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await createResponsePackageExport("intent/with space", {
      snapshotId: "response_package_snapshot_1",
      format: "docx",
    });

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/package/exports",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: "response_package_snapshot_1", format: "docx" }),
      },
    );
  });

  it("updates a response package export review with encoded ids", async () => {
    const body = {
      exportRecord: {
        id: "response_package_export_1",
        reviewStatus: "needs_changes",
        reviewNotes: "Missing price volume.",
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updateResponsePackageExportReview(
      "intent/with space",
      "response_package_export/with space",
      {
        reviewStatus: "needs_changes",
        reviewNotes: "Missing price volume.",
      },
    );

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/intents/intent%2Fwith%20space/response-workspace/package/exports/response_package_export%2Fwith%20space",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus: "needs_changes", reviewNotes: "Missing price volume." }),
      },
    );
  });

  it("fetches pursuit decision board with an encoded intent id", async () => {
    const body = {
      decisionBoard: {
        intentId: "intent/with space",
        history: [],
        recommendation: {
          reasonDetails: [{
            category: "fit",
            severity: "watch",
            summary: "Review fit.",
            explanation: "Match needs review.",
            evidenceLabel: "Match snapshot",
            suggestedAction: "Confirm requirements.",
            evidenceRefs: [{
              kind: "citation",
              label: "Match snapshot",
              citationId: "citation_generated_brief",
            }],
          }],
        },
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchPursuitDecisionBoard("intent/with space");

    expect(result).toEqual(body);
    expect(result.decisionBoard.recommendation.reasonDetails[0].category).toBe("fit");
    expect(result.decisionBoard.recommendation.reasonDetails[0].evidenceRefs[0]).toMatchObject({
      kind: "citation",
      citationId: "citation_generated_brief",
    });
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/decision");
  });

  it("fetches qualification citations with an encoded intent id", async () => {
    const body = { intentId: "intent/with space", bidId: "bid_1", citations: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchQualificationCitations("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/citations");
  });

  it("fetches qualification freshness with an encoded intent id", async () => {
    const body = { intentId: "intent/with space", bidId: "bid_1", status: "stale", signals: [] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchQualificationFreshness("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/qualification/freshness");
  });

  it("refreshes qualification evidence with an encoded intent id", async () => {
    const body = { intent, citations: { citations: [] }, freshness: { status: "current" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await refreshQualificationEvidence("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/qualification/freshness", {
      method: "POST",
    });
  });

  it("posts a grounded qualification question with an encoded intent id", async () => {
    const payload = { question: "What is the deadline?" };
    const body = { intentId: "intent/with space", bidId: "bid_1", answer: "Based on evidence." };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await postQualificationQuestion("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("updates a pursuit decision", async () => {
    const payload = {
      decision: "no_bid" as const,
      reasons: ["Poor fit"],
      notes: "Do not pursue this one.",
    };
    const body = { decisionBoard: { intentId: "intent/with space", currentDecision: payload } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await updatePursuitDecision("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/decision", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("throws ApiError from an API error payload", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { error: { code: "INTENT_NOT_FOUND", message: "Intent not found" } },
        { status: 404 },
      ),
    );

    const promise = fetchIntent("missing");

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 404,
      code: "INTENT_NOT_FOUND",
      message: "Intent not found",
    });
  });

  it("throws fallback ApiError for malformed error JSON", async () => {
    mockFetch.mockResolvedValueOnce(new Response("failed", { status: 500 }));

    const promise = fetchIntents();

    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await expect(promise).rejects.toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Request failed",
    });
  });
});
