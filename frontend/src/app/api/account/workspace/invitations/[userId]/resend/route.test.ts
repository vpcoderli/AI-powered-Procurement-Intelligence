import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
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
vi.mock("@/server/account/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/workspace")>();

  return {
    ...actual,
    resendWorkspaceInvitation: vi.fn(),
  };
});

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

describe("POST /api/account/workspace/invitations/[userId]/resend", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resends a pending workspace invitation", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.resendWorkspaceInvitation).mockReturnValueOnce({
      member: {
        userId: "user_2",
        email: "member@example.com",
        displayName: "Member One",
        workspaceRole: "member",
        status: "invited",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      inviteToken: "invite_new",
      inviteUrl: "/accept-invite?token=invite_new",
    });

    const response = await POST(
      new Request("http://localhost/api/account/workspace/invitations/user_2/resend", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.inviteUrl).toBe("/accept-invite?token=invite_new");
    expect(workspaceService.resendWorkspaceInvitation).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("returns INVITATION_NOT_FOUND when there is no pending invitation", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.resendWorkspaceInvitation).mockImplementationOnce(() => {
      throw new workspaceService.WorkspaceInvitationNotFoundError();
    });

    const response = await POST(
      new Request("http://localhost/api/account/workspace/invitations/user_2/resend", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INVITATION_NOT_FOUND");
  });
});
