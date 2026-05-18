import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import * as bidService from "@/server/bids/service";
import { GET, POST } from "./route";

describe("GET /api/saved-bids", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("returns saved bids", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2"]);
    expect(body.bids[0].title).toBe("Statewide Broadband Infrastructure Upgrade");
  });

  it("returns INTERNAL_ERROR when fetching saved bids fails", async () => {
    vi.spyOn(bidService, "getSavedBids").mockImplementationOnce(() => {
      throw new Error("saved bids failed");
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "saved bids failed",
    });
  });
});

describe("POST /api/saved-bids", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("saves an existing bid", async () => {
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual(["2", "1"]);
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
    const response = await POST(
      new Request("http://localhost/api/saved-bids", {
        method: "POST",
        body: JSON.stringify({ bidId: "missing" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
  });

  it("returns INTERNAL_ERROR when saving a bid fails unexpectedly", async () => {
    vi.spyOn(bidService, "saveBid").mockImplementationOnce(() => {
      throw new Error("save failed");
    });

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
  });
});
