import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as principal from "@/server/auth/principal";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/bids/service", () => ({
  getSavedBids: vi.fn(),
  saveBid: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
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
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("returns saved bids", async () => {
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: ["2"],
      bids: [cloneBid(1)],
    });

    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2"]);
    expect(body.bids[0].title).toBe("Statewide Broadband Infrastructure Upgrade");
    expect(getSavedBids).toHaveBeenCalledWith("anon_existing");
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
          cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing; apsi_session=sess_valid`,
        },
      }),
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(getSavedBids).toHaveBeenCalledWith("user_1");
  });

  it("sets an anonymous user cookie when one is missing", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_new; Path=/`,
    });
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await GET(new Request("http://localhost/api/saved-bids"));

    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });

  it("does not reset the cookie when a valid anonymous user exists", async () => {
    getSavedBids.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns INTERNAL_ERROR when fetching saved bids fails", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_new; Path=/`,
    });
    getSavedBids.mockRejectedValueOnce(new Error("saved bids failed"));

    const response = await GET(new Request("http://localhost/api/saved-bids"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });
});

describe("POST /api/saved-bids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("saves an existing bid", async () => {
    saveBid.mockResolvedValueOnce({
      savedBidIds: ["1"],
      bids: [cloneBid(0)],
    });

    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
        body: JSON.stringify({ bidId: "1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["1"]);
    expect(saveBid).toHaveBeenCalledWith("anon_existing", "1");
  });

  it("persists saved bids for the same anonymous user only", async () => {
    resolvePrincipal
      .mockResolvedValueOnce({ kind: "anonymous", userId: "anon_a" })
      .mockResolvedValueOnce({ kind: "anonymous", userId: "anon_a" })
      .mockResolvedValueOnce({ kind: "anonymous", userId: "anon_b" });
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
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
        body: JSON.stringify({ bidId: "1" }),
      }),
    );

    const sameUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
      }),
    );
    const otherUserResponse = await GET(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_b` },
      }),
    );

    expect((await sameUserResponse.json()).savedBidIds).toEqual(["1"]);
    expect((await otherUserResponse.json()).savedBidIds).toEqual([]);
    expect(saveBid).toHaveBeenCalledWith("anon_a", "1");
    expect(getSavedBids).toHaveBeenNthCalledWith(1, "anon_a");
    expect(getSavedBids).toHaveBeenNthCalledWith(2, "anon_b");
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
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_new; Path=/`,
    });
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
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });

  it("returns INTERNAL_ERROR when saving a bid fails unexpectedly", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anon_new",
      anonymousCookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_new; Path=/`,
    });
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
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });
});
