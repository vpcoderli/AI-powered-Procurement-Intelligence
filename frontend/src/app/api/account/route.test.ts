import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as lifecycleService from "@/server/account/lifecycle";
import { DELETE } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/account/lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/lifecycle")>();

  return {
    ...actual,
    softDeleteAccount: vi.fn(),
  };
});

describe("DELETE /api/account", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("soft-deletes the authenticated account", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "buyer@example.com",
      displayName: "Buyer",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    vi.mocked(lifecycleService.softDeleteAccount).mockReturnValueOnce({ ok: true });

    const response = await DELETE(
      new Request("http://localhost/api/account", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(lifecycleService.softDeleteAccount).toHaveBeenCalledWith({}, "user_1");
  });

  it("returns OWNER_TRANSFER_REQUIRED when a sole owner still has active members", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "owner@example.com",
      displayName: "Owner",
      role: "user",
      tier: "business",
      features: ["bid_search"],
    });
    vi.mocked(lifecycleService.softDeleteAccount).mockImplementationOnce(() => {
      throw new lifecycleService.AccountDeletionRequiresOwnerTransferError();
    });

    const response = await DELETE(
      new Request("http://localhost/api/account", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("OWNER_TRANSFER_REQUIRED");
  });

  it("requires authentication", async () => {
    const response = await DELETE(new Request("http://localhost/api/account", { method: "DELETE" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});
