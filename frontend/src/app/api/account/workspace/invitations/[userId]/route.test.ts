import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as workspaceService from "@/server/account/workspace";
import { DELETE } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/auth/service")>();

  return {
    ...actual,
    getSessionUser: vi.fn(),
  };
});
vi.mock("@/server/account/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/workspace")>();

  return {
    ...actual,
    revokeWorkspaceInvitation: vi.fn(),
  };
});

const workspaceBody = {
  organization: {
    id: "org_1",
    name: "Acme Federal Team",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
  },
  currentUserRole: "owner" as const,
  members: [],
};

function mockOwnerSession() {
  vi.mocked(authService.getSessionUser).mockResolvedValueOnce({
    id: "user_1",
    email: "owner@example.com",
    displayName: "Owner",
    role: "user",
    tier: "business",
    features: ["bid_search"],
    workspace: {
      organizationId: "org_1",
      organizationName: "Acme Federal Team",
      role: "owner",
    },
  });
}

describe("DELETE /api/account/workspace/invitations/[userId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("revokes a pending workspace invitation", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.revokeWorkspaceInvitation).mockReturnValueOnce(workspaceBody);

    const response = await DELETE(
      new Request("http://localhost/api/account/workspace/invitations/user_2", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization.id).toBe("org_1");
    expect(workspaceService.revokeWorkspaceInvitation).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("returns INVITATION_NOT_FOUND when there is no pending invitation", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.revokeWorkspaceInvitation).mockImplementationOnce(() => {
      throw new workspaceService.WorkspaceInvitationNotFoundError();
    });

    const response = await DELETE(
      new Request("http://localhost/api/account/workspace/invitations/user_2", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INVITATION_NOT_FOUND");
  });
});
