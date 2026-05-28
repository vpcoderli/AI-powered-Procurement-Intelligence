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
    inviteWorkspaceMember: vi.fn(),
  };
});

describe("POST /api/account/workspace/members", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("invites a member to the current user's workspace", async () => {
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
    vi.mocked(workspaceService.inviteWorkspaceMember).mockResolvedValueOnce({
      member: {
        userId: "user_2",
        email: "member@example.com",
        displayName: "Member One",
        workspaceRole: "member",
        status: "active",
        createdAt: "2026-05-28T00:00:00.000Z",
        updatedAt: "2026-05-28T00:00:00.000Z",
      },
      temporaryPassword: "Temp-secret",
    });

    const response = await POST(
      new Request("http://localhost/api/account/workspace/members", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({
          email: "member@example.com",
          displayName: "Member One",
          role: "member",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.member.email).toBe("member@example.com");
    expect(body.temporaryPassword).toBe("Temp-secret");
    expect(workspaceService.inviteWorkspaceMember).toHaveBeenCalledWith({}, "user_1", {
      email: "member@example.com",
      displayName: "Member One",
      role: "member",
    });
  });

  it("returns EMAIL_ALREADY_REGISTERED for duplicate emails", async () => {
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
    vi.mocked(workspaceService.inviteWorkspaceMember).mockRejectedValueOnce(
      new workspaceService.WorkspaceEmailExistsError(),
    );

    const response = await POST(
      new Request("http://localhost/api/account/workspace/members", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ email: "member@example.com", role: "member" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });
});
