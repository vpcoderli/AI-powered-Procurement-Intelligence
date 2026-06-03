import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as bidService from "@/server/bids/service";
import { DELETE } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/bids/service", () => ({
  removeSavedBid: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const removeSavedBid = vi.mocked(bidService.removeSavedBid);

describe("DELETE /api/saved-bids/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "anonymous", userId: "anon_existing" });
  });

  it("requires an authenticated principal", async () => {
    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(removeSavedBid).not.toHaveBeenCalled();
  });

  it("removes a saved bid", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    removeSavedBid.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await DELETE(
      new Request("http://localhost/api/saved-bids/2", {
        headers: { cookie: "apsi_session=sess_valid" },
      }),
      {
        params: Promise.resolve({ id: "2" }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.savedBidIds).toEqual([]);
    expect(removeSavedBid).toHaveBeenCalledWith("user_1", "2");
  });

  it("removes a saved bid for the current authenticated user only", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_a" });
    removeSavedBid.mockResolvedValueOnce({
      savedBidIds: [],
      bids: [],
    });

    const response = await DELETE(
      new Request("http://localhost/api/saved-bids/1", {
        headers: { cookie: "apsi_session=sess_a" },
      }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(200);
    expect(removeSavedBid).toHaveBeenCalledWith("user_a", "1");
  });

  it("returns INTERNAL_ERROR when removing a saved bid fails", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "authenticated", userId: "user_1" });
    removeSavedBid.mockRejectedValueOnce(new Error("remove failed"));

    const response = await DELETE(new Request("http://localhost/api/saved-bids/2"), {
      params: Promise.resolve({ id: "2" }),
    });
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
