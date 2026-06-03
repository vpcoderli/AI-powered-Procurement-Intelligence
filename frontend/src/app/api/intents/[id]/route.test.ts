import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as intentService from "@/server/intents/service";
import { IntentNotFoundError, type IntentDetail } from "@/server/intents/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/intents/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/intents/service")>();

  return {
    ...actual,
    getUserIntent: vi.fn(),
    updateIntentStatus: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getUserIntent = vi.mocked(intentService.getUserIntent);
const updateIntentStatus = vi.mocked(intentService.updateIntentStatus);

const intent: IntentDetail = {
  id: "intent_1",
  userId: "user_1",
  status: "intent_added",
  bid: { ...MOCK_BIDS[0], id: "bid_1", title: "Cloud" },
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

describe("GET /api/intents/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("requires an authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "anonymous", userId: "anon_existing" });

    const response = await GET(new Request("http://localhost/api/intents/intent_1"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(getUserIntent).not.toHaveBeenCalled();
  });

  it("returns an intent for the current principal", async () => {
    getUserIntent.mockResolvedValueOnce(intent);

    const response = await GET(new Request("http://localhost/api/intents/intent_1"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ intent });
    expect(getUserIntent).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getUserIntent.mockResolvedValueOnce(undefined);

    const response = await GET(new Request("http://localhost/api/intents/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("PATCH /api/intents/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("requires an authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "anonymous", userId: "anon_existing" });

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1", {
        method: "PATCH",
        body: JSON.stringify({ status: "needs_review" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(updateIntentStatus).not.toHaveBeenCalled();
  });

  it("updates intent status", async () => {
    const updated: IntentDetail = { ...intent, status: "needs_review" };
    updateIntentStatus.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1", {
        method: "PATCH",
        body: JSON.stringify({ status: "needs_review" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ intent: updated });
    expect(updateIntentStatus).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      "needs_review",
    );
  });

  it("returns INVALID_REQUEST for invalid status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1", {
        method: "PATCH",
        body: JSON.stringify({ status: "bad" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateIntentStatus).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    updateIntentStatus.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await PATCH(
      new Request("http://localhost/api/intents/missing", {
        method: "PATCH",
        body: JSON.stringify({ status: "needs_review" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });

  it("returns INTERNAL_ERROR for unexpected failures", async () => {
    updateIntentStatus.mockRejectedValueOnce(new Error("private detail"));

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1", {
        method: "PATCH",
        body: JSON.stringify({ status: "needs_review" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
