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
  postQualificationQuestion,
  refreshQualificationEvidence,
  updateComplianceManifestItem,
  fetchSubmissionGuidance,
  updateIntentStatus,
  updatePursuitDecision,
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
    const body = { submission: { id: "submission_path_1", method: "external_portal" } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchSubmissionGuidance("intent/with space");

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/submission");
  });

  it("patches submission guidance fields", async () => {
    const payload = { method: "email" as const, requiresRegistration: false };
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
    const body = { confirmation: { id: "submission_confirmation_1", ...payload } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body, { status: 201 }));

    const result = await confirmSubmission("intent/with space", payload);

    expect(result).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/intents/intent%2Fwith%20space/submission/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("fetches compliance manifest with an encoded intent id", async () => {
    const body = { manifest: { intentId: "intent/with space", items: [] } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchComplianceManifest("intent/with space");

    expect(result).toEqual(body);
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
          }],
        },
      },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    const result = await fetchPursuitDecisionBoard("intent/with space");

    expect(result).toEqual(body);
    expect(result.decisionBoard.recommendation.reasonDetails[0].category).toBe("fit");
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
