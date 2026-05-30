import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as qaService from "@/server/qualification/qa";
import { IntentNotFoundError } from "@/server/intents/types";
import type { QualificationQuestionResponse } from "@/server/qualification/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/qualification/qa", () => ({
  answerQualificationQuestion: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const answerQualificationQuestion = vi.mocked(qaService.answerQualificationQuestion);

const proPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "bid.brief.full.generate"] as const,
};

const freePrincipal = {
  kind: "authenticated" as const,
  userId: "user_free",
  role: "user" as const,
  tier: "free" as const,
  features: ["bid_search"] as const,
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
  generatedAt: "2026-05-30T00:00:00.000Z",
};

describe("POST /api/intents/[id]/qa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
  });

  it("returns a grounded answer for Pro users", async () => {
    answerQualificationQuestion.mockResolvedValueOnce(qaResponse);

    const response = await POST(new Request("http://localhost/api/intents/intent_1/qa", {
      method: "POST",
      body: JSON.stringify({ question: "What is the deadline?" }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(qaResponse);
    expect(answerQualificationQuestion).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      question: "What is the deadline?",
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
