import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import * as bidService from "@/server/bids/service";
import { GET } from "./route";

describe("GET /api/bids/[id]", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("returns a bid by id", async () => {
    const response = await GET(new Request("http://localhost/api/bids/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.bid.title).toBe("Enterprise Cloud Migration Services");
  });

  it("returns BID_NOT_FOUND for a missing bid", async () => {
    const response = await GET(new Request("http://localhost/api/bids/missing"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("BID_NOT_FOUND");
  });

  it("returns INTERNAL_ERROR when looking up a bid fails", async () => {
    vi.spyOn(bidService, "getBidById").mockImplementationOnce(() => {
      throw new Error("lookup failed");
    });

    const response = await GET(new Request("http://localhost/api/bids/1"), {
      params: Promise.resolve({ id: "1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "lookup failed",
    });
  });
});
