import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as principal from "@/server/auth/principal";
import * as usageLimits from "@/server/auth/usage-limits";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";
import { GET, POST } from "./route";

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
vi.mock("@/server/bids/service", () => ({
  getSavedBids: vi.fn(),
  saveBid: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const enforceUsageLimit = vi.mocked(usageLimits.enforceUsageLimit);
const getSavedBids = vi.mocked(bidService.getSavedBids);
const saveBid = vi.mocked(bidService.saveBid);

function cloneBid(index: number) {
  const bid = MOCK_BIDS[index];

  return {
    ...bid,
    attachments: [...bid.attachments],
    tags: [...bid.tags],
  };
}

describe("GET /api/saved-bids", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("requires an authenticated principal", async () => {
    const response = await GET(new Request("http://localhost/api/saved-bids"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(getSavedBids).not.toHaveBeenCalled();
  });

  it("returns saved bids", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: ["2"],
      bids: [cloneBid(1)],
    });

    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: "apsi_session=sess_valid" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2"]);
    expect(body.bids[0].title).toBe("Statewide Broadband Infrastructure Upgrade");
    expect(getSavedBids).toHaveBeenCalledWith("user_1");
  });

  it("uses the authenticated principal when a valid session exists", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: ["2"],
      bids: [cloneBid(1)],
    });

    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: {
          cookie: "apsi_anonymous_user=anon_existing; apsi_session=sess_valid",
        },
      }),
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getSavedBids).toHaveBeenCalledWith("user_1");
  });

  it("does not issue anonymous cookies for personal saved bid reads", async () => {
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await GET(new Request("http://localhost/api/saved-bids"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not issue anonymous cookies when an anonymous cookie already exists", async () => {
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: "apsi_anonymous_user=anon_existing" },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns INTERNAL_ERROR when fetching saved bids fails", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    getSavedBids.mockRejectedValueOnce(new Error("saved bids failed"));

    const response = await GET(new Request("http://localhost/api/saved-bids"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("POST /api/saved-bids", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("requires an authenticated principal", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(enforceUsageLimit).not.toHaveBeenCalled();
    expect(saveBid).not.toHaveBeenCalled();
  });

  it("saves an existing bid", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1", tier: "free" });
    saveBid.mockResolvedValueOnce({
      savedBidIds: ["1"],
      bids: [cloneBid(0)],
    });

    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        headers: { cookie: "apsi_anonymous_user=anon_existing" },
        body: JSON.stringify({ bidId: "1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["1"]);
    expect(enforceUsageLimit).toHaveBeenCalledWith(expect.anything(), {
      userId: "user_1",
      tier: "free",
      feature: "saved_bids",
      resourceId: "1",
    });
    expect(saveBid).toHaveBeenCalledWith("user_1", "1");
  });

  it("returns USAGE_LIMIT_REACHED when the current plan cannot save more bids", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1", tier: "free" });
    enforceUsageLimit.mockImplementationOnce(() => {
      throw new usageLimits.UsageLimitError({
        feature: "saved_bids",
        tier: "free",
        used: 5,
        limit: 5,
      });
    });

    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        headers: { cookie: "apsi_session=sess_valid" },
        body: JSON.stringify({ bidId: "6" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      limit: 5,
      used: 5,
      feature: "saved_bids",
      requiredTier: "pro",
    });
    expect(saveBid).not.toHaveBeenCalled();
  });

  it("persists saved bids for the authenticated user only", async () => {
    resolvePrincipal
      .mockResolvedValueOnce({ kind: "authenticated", userId: "user_a", tier: "free" })
      .mockResolvedValueOnce({ kind: "authenticated", userId: "user_a", tier: "free" })
      .mockResolvedValueOnce({ kind: "authenticated", userId: "user_b", tier: "free" });
    saveBid.mockResolvedValueOnce({
      savedBidIds: ["1"],
      bids: [cloneBid(0)],
    });
    getSavedBids
      .mockResolvedValueOnce({
        savedBidIds: ["1"],
        bids: [cloneBid(0)],
      })
      .mockResolvedValueOnce({
        savedBidIds: [],
        bids: [],
      });

    await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        headers: { cookie: "apsi_session=sess_a" },
        body: JSON.stringify({ bidId: "1" }),
      }),
    );

    const sameUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: "apsi_session=sess_a" },
      }),
    );
    const otherUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: "apsi_session=sess_b" },
      }),
    );

    expect((await sameUserResponse.json()).savedBidIds).toEqual(["1"]);
    expect((await otherUserResponse.json()).savedBidIds).toEqual([]);
    expect(saveBid).toHaveBeenCalledWith("user_a", "1");
    expect(getSavedBids).toHaveBeenNthCalledWith(1, "user_a");
    expect(getSavedBids).toHaveBeenNthCalledWith(2, "user_b");
  });

  it("returns INVALID_REQUEST when bidId is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: "{",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for non-string bidId", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: 1 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns INVALID_REQUEST for blank bidId", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "   " }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("returns BID_NOT_FOUND when bidId does not exist", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1", tier: "free" });
    saveBid.mockRejectedValueOnce(new BidNotFoundError());

    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "missing" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns INTERNAL_ERROR when saving a bid fails unexpectedly", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1", tier: "free" });
    saveBid.mockRejectedValueOnce(new Error("save failed"));

    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
