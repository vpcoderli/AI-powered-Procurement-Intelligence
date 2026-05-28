import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as lifecycleService from "@/server/account/lifecycle";
import * as workspaceService from "@/server/account/workspace";
import { POST } from "./route";

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
    transferWorkspaceOwnership: vi.fn(),
  };
});

const workspaceBody = {
  organization: {
    id: "org_1",
    name: "Acme Federal Team",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
  },
  currentUserRole: "member" as const,
  members: [],
};

describe("POST /api/account/workspace/ownership", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("transfers ownership to another workspace member", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "owner@example.com",
      displayName: "Owner",
      role: "user",
      tier: "business",
      features: ["bid_search"],
    });
    vi.mocked(lifecycleService.transferWorkspaceOwnership).mockReturnValueOnce(workspaceBody);

    const response = await POST(
      new Request("http://localhost/api/account/workspace/ownership", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ targetUserId: "user_2" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.currentUserRole).toBe("member");
    expect(lifecycleService.transferWorkspaceOwnership).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("returns FORBIDDEN for non-owner actors", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
      id: "user_1",
      email: "member@example.com",
      displayName: "Member",
      role: "user",
      tier: "business",
      features: ["bid_search"],
    });
    vi.mocked(lifecycleService.transferWorkspaceOwnership).mockImplementationOnce(() => {
      throw new workspaceService.WorkspacePermissionError();
    });

    const response = await POST(
      new Request("http://localhost/api/account/workspace/ownership", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ targetUserId: "user_2" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
