import { beforeEach, describe, expect, it, vi } from "vitest";
import * as bidService from "@/server/bids/service";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { DELETE } from "./route";

vi.mock("@/server/bids/service", () => ({
  removeSavedBid: vi.fn(),
}));

const removeSavedBid = vi.mocked(bidService.removeSavedBid);

describe("DELETE /api/saved-bids/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes a saved bid", async () => {
    removeSavedBid.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await DELETE(
      new Request("http://localhost/api/saved-bids/2", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
      {
        params: Promise.resolve({ id: "2" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual([]);
    expect(removeSavedBid).toHaveBeenCalledWith("anon_existing", "2");
  });

  it("removes a saved bid for the current anonymous user only", async () => {
    removeSavedBid.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await DELETE(
      new Request("http://localhost/api/saved-bids/1", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_a` },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(200);
    expect(removeSavedBid).toHaveBeenCalledWith("anon_a", "1");
  });

  it("returns INTERNAL_ERROR when removing a saved bid fails", async () => {
    removeSavedBid.mockRejectedValueOnce(new Error("remove failed"));

    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "remove failed",
    });
    expect(response.headers.get("set-cookie")).toContain(`${ANONYMOUS_USER_COOKIE_NAME}=anon_`);
  });
});
