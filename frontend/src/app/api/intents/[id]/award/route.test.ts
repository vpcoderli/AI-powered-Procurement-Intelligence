import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as awardService from "@/server/awards/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { AwardOutcome } from "@/server/awards/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/awards/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/awards/service")>();

  return {
    ...actual,
    getAwardOutcome: vi.fn(),
    updateAwardOutcome: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getAwardOutcome = vi.mocked(awardService.getAwardOutcome);
const updateAwardOutcome = vi.mocked(awardService.updateAwardOutcome);

const enterprisePrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "enterprise" as const,
  features: ["bid_search", "award.tabulation.analyze"] as const,
};

const freePrincipal = {
  kind: "authenticated" as const,
  userId: "user_free",
  role: "user" as const,
  tier: "free" as const,
  features: ["bid_search"] as const,
};

const outcome: AwardOutcome = {
  id: "award_outcome_1",
  organizationId: "org_1",
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  status: "awaiting_award",
  awardNoticeUrl: "",
  tabulationArtifactId: null,
  tabulationArtifactUrl: "",
  winnerName: "",
  awardAmountCents: null,
  currency: "USD",
  lossReason: "unknown",
  lossReasonNotes: "",
  nextAction: "capture_tabulation",
  nextActionDueAt: null,
  notes: "",
  decidedAt: null,
  createdAt: "2026-06-10T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
};

describe("GET /api/intents/[id]/award", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(enterprisePrincipal);
  });

  it("returns the award outcome for authenticated users with the award feature", async () => {
    getAwardOutcome.mockResolvedValueOnce(outcome);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/award"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ outcome });
    expect(getAwardOutcome).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns AUTH_REQUIRED for anonymous principals", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_1",
      features: [],
    });

    const response = await GET(new Request("http://localhost/api/intents/intent_1/award"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
    expect(getAwardOutcome).not.toHaveBeenCalled();
  });

  it("returns FEATURE_NOT_AVAILABLE when the award feature is missing", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/award"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.error.feature).toBe("award.tabulation.analyze");
    expect(getAwardOutcome).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getAwardOutcome.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/award"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("PATCH /api/intents/[id]/award", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(enterprisePrincipal);
  });

  it("updates editable award outcome fields", async () => {
    const updated: AwardOutcome = {
      ...outcome,
      status: "awarded_to_competitor",
      winnerName: "Delta Integrators",
      awardAmountCents: 500000,
      lossReason: "price_uncompetitive",
    };
    updateAwardOutcome.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/award", {
        method: "PATCH",
        body: JSON.stringify({
          status: "awarded_to_competitor",
          winnerName: "Delta Integrators",
          awardAmountCents: 500000,
          lossReason: "price_uncompetitive",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ outcome: updated });
    expect(updateAwardOutcome).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      status: "awarded_to_competitor",
      winnerName: "Delta Integrators",
      awardAmountCents: 500000,
      lossReason: "price_uncompetitive",
    });
  });

  it("returns INVALID_REQUEST for invalid enum or negative amount", async () => {
    const invalidStatus = await PATCH(
      new Request("http://localhost/api/intents/intent_1/award", {
        method: "PATCH",
        body: JSON.stringify({ status: "won" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const invalidAmount = await PATCH(
      new Request("http://localhost/api/intents/intent_1/award", {
        method: "PATCH",
        body: JSON.stringify({ awardAmountCents: -1 }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );

    expect(invalidStatus.status).toBe(400);
    expect((await invalidStatus.json()).error.code).toBe("INVALID_REQUEST");
    expect(invalidAmount.status).toBe(400);
    expect((await invalidAmount.json()).error.code).toBe("INVALID_REQUEST");
    expect(updateAwardOutcome).not.toHaveBeenCalled();
  });
});
