import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import * as bidService from "@/server/bids/service";
import { BidNotFoundError } from "@/server/bids/types";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { GET, POST } from "./route";

describe("GET /api/saved-bids", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("returns saved bids", async () => {
    const bid = bidService.getBidById("2");
    if (!bid) throw new Error("Expected mock bid 2 to exist");
    vi.spyOn(bidService, "getSavedBids").mockResolvedValueOnce({
      savedBidIds: ["2"],
      bids: [bid],
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
    expect(bidService.getSavedBids).toHaveBeenCalledWith("anon_existing");
  });

  it("sets an anonymous user cookie when one is missing", async () => {
    vi.spyOn(bidService, "getSavedBids").mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await GET(new Request("http://localhost/api/saved-bids"));

    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });

  it("does not reset the cookie when a valid anonymous user exists", async () => {
    vi.spyOn(bidService, "getSavedBids").mockResolvedValueOnce({
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
    vi.spyOn(bidService, "getSavedBids").mockRejectedValueOnce(new Error("saved bids failed"));

    const response = await GET(new Request("http://localhost/api/saved-bids"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "saved bids failed",
    });
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });
});

describe("POST /api/saved-bids", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("saves an existing bid", async () => {
    const bid = bidService.getBidById("1");
    if (!bid) throw new Error("Expected mock bid 1 to exist");
    vi.spyOn(bidService, "saveBid").mockResolvedValueOnce({
      savedBidIds: ["1"],
      bids: [bid],
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
    expect(bidService.saveBid).toHaveBeenCalledWith("anon_existing", "1");
  });

  it("persists saved bids for the same anonymous user only", async () => {
    const bid = bidService.getBidById("1");
    if (!bid) throw new Error("Expected mock bid 1 to exist");
    vi.spyOn(bidService, "saveBid").mockResolvedValueOnce({
      savedBidIds: ["1"],
      bids: [bid],
    });
    vi.spyOn(bidService, "getSavedBids")
      .mockResolvedValueOnce({
        savedBidIds: ["1"],
        bids: [bid],
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
    expect(bidService.saveBid).toHaveBeenCalledWith("anon_a", "1");
    expect(bidService.getSavedBids).toHaveBeenNthCalledWith(1, "anon_a");
    expect(bidService.getSavedBids).toHaveBeenNthCalledWith(2, "anon_b");
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
    vi.spyOn(bidService, "saveBid").mockRejectedValueOnce(new BidNotFoundError());

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
    vi.spyOn(bidService, "saveBid").mockRejectedValueOnce(new Error("save failed"));

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
      message: "save failed",
    });
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });
});
