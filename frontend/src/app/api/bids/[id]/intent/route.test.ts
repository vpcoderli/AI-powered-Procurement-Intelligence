import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import * as intentService from "@/server/intents/service";
import { IntentBidNotFoundError } from "@/server/intents/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/intents/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/intents/service")>();

  return {
    ...actual,
    createIntentForBid: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const createIntentForBid = vi.mocked(intentService.createIntentForBid);

const intent = {
  id: "intent_1",
  userId: "anon_intent",
  bid: { id: "bid_1", title: "Cloud" },
  status: "intent_added",
  generated: {
    aiBidBrief: "Brief",
    keyDates: { publishedDate: "2026-05-01", deadlineDate: "2026-06-01" },
    initialChecklist: [],
    riskFlags: [],
  },
  match: { bidId: "bid_1", score: 70 },
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
} as const;

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
    expect(createIntentForBid).toHaveBeenCalledWith(expect.anything(), "anon_intent", "bid_1");
    expect(response.headers.get("set-cookie")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_intent`,
    );
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
