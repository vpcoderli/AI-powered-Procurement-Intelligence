import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as pursuitService from "@/server/pursuit/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { PursuitDecisionBoard } from "@/server/pursuit/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/pursuit/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/pursuit/service")>();

  return {
    ...actual,
    createPursuitDecision: vi.fn(),
    getPursuitDecisionBoard: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getPursuitDecisionBoard = vi.mocked(pursuitService.getPursuitDecisionBoard);
const createPursuitDecision = vi.mocked(pursuitService.createPursuitDecision);

const proPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "submission_guidance", "pursue_no_bid"],
};

const freePrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_free",
  role: "user" as const,
  tier: "free" as const,
  features: ["bid_search"],
};

const board: PursuitDecisionBoard = {
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  recommendation: {
    recommendation: "review",
    confidence: "medium",
    reasons: ["Review pricing and compliance before pursuing."],
    reasonDetails: [{
      category: "fit",
      severity: "watch",
      summary: "Review pricing and compliance before pursuing.",
      explanation: "The current match score requires human review.",
      evidenceLabel: "Match snapshot",
      suggestedAction: "Confirm pricing and compliance before deciding.",
    }],
  },
  currentDecision: null,
  history: [],
};

describe("GET /api/intents/[id]/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
  });

  it("returns a pursuit decision board for Pro users", async () => {
    getPursuitDecisionBoard.mockResolvedValueOnce(board);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/decision"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ decisionBoard: board });
    expect(body.decisionBoard.recommendation.reasonDetails[0].category).toBe("fit");
    expect(getPursuitDecisionBoard).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Pro", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/decision"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(getPursuitDecisionBoard).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getPursuitDecisionBoard.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/decision"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("PATCH /api/intents/[id]/decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
  });

  it("stores a pursuit decision", async () => {
    const updated: PursuitDecisionBoard = {
      ...board,
      currentDecision: {
        id: "pursuit_decision_1",
        intentId: "intent_1",
        bidId: "bid_1",
        userId: "user_1",
        decision: "pursue",
        reasons: ["Strong fit"],
        notes: "Proceed.",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      history: [],
    };
    createPursuitDecision.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/decision", {
        method: "PATCH",
        body: JSON.stringify({
          decision: "pursue",
          reasons: ["Strong fit"],
          notes: "Proceed.",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ decisionBoard: updated });
    expect(createPursuitDecision).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      decision: "pursue",
      reasons: ["Strong fit"],
      notes: "Proceed.",
    });
  });

  it("returns INVALID_REQUEST for unsupported decisions", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/decision", {
        method: "PATCH",
        body: JSON.stringify({ decision: "maybe" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createPursuitDecision).not.toHaveBeenCalled();
  });
});
