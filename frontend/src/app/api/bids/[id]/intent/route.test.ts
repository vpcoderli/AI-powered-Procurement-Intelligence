import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as usageLimits from "@/server/auth/usage-limits";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as intentService from "@/server/intents/service";
import { IntentBidNotFoundError, type IntentDetail } from "@/server/intents/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/auth/usage-limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/usage-limits")>();

  return {
    ...actual,
    enforceUsageLimit: vi.fn(),
  };
});
vi.mock("@/server/intents/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/intents/service")>();

  return {
    ...actual,
    createIntentForBid: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const enforceUsageLimit = vi.mocked(usageLimits.enforceUsageLimit);
const createIntentForBid = vi.mocked(intentService.createIntentForBid);

const intent: IntentDetail = {
  id: "intent_1",
  userId: "anon_intent",
  bid: { ...MOCK_BIDS[0], id: "bid_1", title: "Cloud" },
  status: "intent_added",
  generated: {
    aiBidBrief: "Brief",
    keyDates: { publishedDate: "2026-05-01", deadlineDate: "2026-06-01" },
    initialChecklist: [],
    riskFlags: [],
  },
  match: {
    bidId: "bid_1",
    score: 70,
    confidence: "medium",
    components: {
      geography: 20,
      keywords: 20,
      category: 10,
      certifications: 0,
      contractValue: 5,
      deadline: 15,
    },
    explanation: "Good fit.",
    riskNotes: [],
    missingProfileHints: [],
  },
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

describe("POST /api/bids/[id]/intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({
      kind: "anonymous",
      userId: "anon_intent",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_intent; Path=/`,
    });
  });

  it("creates an intent for the current principal", async () => {
    createIntentForBid.mockResolvedValueOnce(intent);

    const response = await POST(new Request("http://localhost/api/bids/bid_1/intent"), {
      params: Promise.resolve({ id: "bid_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ intent });
    expect(enforceUsageLimit).toHaveBeenCalledWith(expect.anything(), {
      userId: "anon_intent",
      tier: "free",
      feature: "intent_workspace",
      resourceId: "bid_1",
    });
    expect(createIntentForBid).toHaveBeenCalledWith(expect.anything(), "anon_intent", "bid_1");
    expect(response.headers.get("set-cookie")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_intent`,
    );
  });

  it("returns USAGE_LIMIT_REACHED when the current plan cannot create more intents", async () => {
    enforceUsageLimit.mockImplementationOnce(() => {
      throw new usageLimits.UsageLimitError({
        feature: "intent_workspace",
        tier: "free",
        used: 2,
        limit: 2,
      });
    });

    const response = await POST(new Request("http://localhost/api/bids/bid_1/intent"), {
      params: Promise.resolve({ id: "bid_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      limit: 2,
      used: 2,
      feature: "intent_workspace",
      requiredTier: "pro",
    });
    expect(createIntentForBid).not.toHaveBeenCalled();
  });

  it("returns BID_NOT_FOUND when the bid is missing", async () => {
    createIntentForBid.mockRejectedValueOnce(new IntentBidNotFoundError());

    const response = await POST(new Request("http://localhost/api/bids/missing/intent"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
  });

  it("returns INTERNAL_ERROR for unexpected failures", async () => {
    createIntentForBid.mockRejectedValueOnce(new Error("private detail"));

    const response = await POST(new Request("http://localhost/api/bids/bid_1/intent"), {
      params: Promise.resolve({ id: "bid_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("private detail");
  });
});
