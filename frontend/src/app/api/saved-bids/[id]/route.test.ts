import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import * as bidService from "@/server/bids/service";
import { DELETE } from "./route";

describe("DELETE /api/saved-bids/[id]", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("removes a saved bid", async () => {
    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual([]);
  });

  it("returns INTERNAL_ERROR when removing a saved bid fails", async () => {
    vi.spyOn(bidService, "removeSavedBid").mockImplementationOnce(() => {
      throw new Error("remove failed");
    });

    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "remove failed",
    });
  });
});
