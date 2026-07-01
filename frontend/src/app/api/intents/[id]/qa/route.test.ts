import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as creditLedger from "@/server/billing/credit-ledger";
import * as qaService from "@/server/qualification/qa";
import { IntentNotFoundError } from "@/server/intents/types";
import type { RequestPrincipal } from "@/server/auth/principal";
import type { CreditLedgerDryRunResult } from "@/server/billing/credit-ledger";
import type { QualificationQuestionResponse } from "@/server/qualification/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/qualification/qa", () => ({
  answerQualificationQuestion: vi.fn(),
}));
vi.mock("@/server/billing/credit-ledger", () => ({
  recordPremiumActionUsageDryRun: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const answerQualificationQuestion = vi.mocked(qaService.answerQualificationQuestion);
const recordPremiumActionUsageDryRun = vi.mocked(creditLedger.recordPremiumActionUsageDryRun);

const proPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "bid.brief.full.generate"],
};

const freePrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_free",
  role: "user" as const,
  tier: "free" as const,
  features: ["bid_search"],
};

const proWorkspacePrincipal: RequestPrincipal = {
  ...proPrincipal,
  workspace: {
    organizationId: "org_seed",
    organizationName: "Seed Organization",
    role: "owner" as const,
    tier: "pro" as const,
  },
};

const qaResponse: QualificationQuestionResponse = {
  intentId: "intent_1",
  bidId: "bid_1",
  question: "What is the deadline?",
  answer: "Based on Deadline: 2026-06-15.",
  citations: [{
    id: "citation_deadline",
    section: "key_dates",
    sourceType: "bid_field",
    sourceLabel: "Deadline",
    excerpt: "2026-06-15",
    url: "https://sam.gov/example",
    confidence: "high",
    generatedAt: "2026-05-30T00:00:00.000Z",
  }],
  grounded: true,
  groundingStatus: "grounded",
  evidenceCoverage: {
    status: "direct",
    matchedCitationCount: 1,
    selectedCitationCount: 1,
    totalCitationCount: 1,
    coveredSections: ["key_dates"],
  },
  limitations: [
    "Deterministic local answer generated from stored bid fields, archives, attachments, and generated brief citations only.",
    "No live LLM, embeddings, vector database, or external retrieval were used.",
  ],
  aiRun: {
    id: "ai_run_qualification_qa_2026-06-10T00:00:00.000Z",
    provider: "deterministic",
    model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
    rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
    promptVersion: "qualification-qa-lite@2026-06-10",
    confidence: "high",
    cost: { currency: "USD", total: 0 },
    fallbackReason: "no_llm_provider_configured",
    generatedAt: "2026-06-10T00:00:00.000Z",
  },
  generatedAt: "2026-05-30T00:00:00.000Z",
};

function creditDryRun(overrides: Partial<CreditLedgerDryRunResult> = {}): CreditLedgerDryRunResult {
  return {
    mode: "dry_run",
    eventRecorded: false,
    eventId: null,
    featureKey: "bid.brief.full.generate",
    creditCost: 1,
    estimatedCredits: 1,
    estimatedCost: { currency: "USD", total: 0, estimatedUsd: 0 },
    chargedAmount: 0,
    balanceAfter: null,
    fallbackReason: "workspace_not_available",
    ...overrides,
  };
}

describe("POST /api/intents/[id]/qa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
    recordPremiumActionUsageDryRun.mockResolvedValue(creditDryRun());
  });

  it("returns a grounded answer with unavailable dry-run usage when no workspace exists", async () => {
    answerQualificationQuestion.mockResolvedValueOnce(qaResponse);

    const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
      method: "POST",
      body: JSON.stringify({ question: "What is the deadline?" }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ...qaResponse,
      creditUsage: {
        mode: "dry_run",
        eventRecorded: false,
        eventId: null,
        featureKey: "bid.brief.full.generate",
        creditCost: 1,
        estimatedCredits: 1,
        estimatedCost: { currency: "USD", total: 0, estimatedUsd: 0 },
        chargedAmount: 0,
        balanceAfter: null,
        fallbackReason: "workspace_not_available",
      },
    });
    expect(answerQualificationQuestion).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      question: "What is the deadline?",
    });
    expect(recordPremiumActionUsageDryRun).toHaveBeenCalledWith(expect.anything(), {
      organizationId: null,
      userId: "user_1",
      featureKey: "bid.brief.full.generate",
      actionId: "qualification_qa:intent_1",
      aiRunId: qaResponse.aiRun.id,
      metadata: {
        provider: "deterministic",
        promptVersion: "qualification-qa-lite@2026-06-10",
      },
    });
  });

  it("records dry-run credit usage for successful premium Q&A when workspace exists", async () => {
    resolvePrincipal.mockResolvedValueOnce(proWorkspacePrincipal);
    answerQualificationQuestion.mockResolvedValueOnce(qaResponse);
    recordPremiumActionUsageDryRun.mockResolvedValueOnce(creditDryRun({
      eventRecorded: true,
      eventId: "credit_usage_1",
      fallbackReason: "billing_enforcement_disabled",
    }));

    const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
      method: "POST",
      body: JSON.stringify({ question: "What is the deadline?" }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.creditUsage).toMatchObject({
      mode: "dry_run",
      eventRecorded: true,
      chargedAmount: 0,
      balanceAfter: null,
      fallbackReason: "billing_enforcement_disabled",
    });
    expect(recordPremiumActionUsageDryRun).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org_seed",
      userId: "user_1",
      featureKey: "bid.brief.full.generate",
      actionId: "qualification_qa:intent_1",
      aiRunId: qaResponse.aiRun.id,
      metadata: {
        provider: "deterministic",
        promptVersion: "qualification-qa-lite@2026-06-10",
      },
    });
  });

  it("returns INVALID_REQUEST for empty questions", async () => {
    const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
      method: "POST",
      body: JSON.stringify({ question: " " }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(answerQualificationQuestion).not.toHaveBeenCalled();
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Pro", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
      method: "POST",
      body: JSON.stringify({ question: "What is the deadline?" }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(answerQualificationQuestion).not.toHaveBeenCalled();
    expect(recordPremiumActionUsageDryRun).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    answerQualificationQuestion.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(new Request("http://localhost/api/intents/missing/qa", {
      method: "POST",
      body: JSON.stringify({ question: "What is the deadline?" }),
    }), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
