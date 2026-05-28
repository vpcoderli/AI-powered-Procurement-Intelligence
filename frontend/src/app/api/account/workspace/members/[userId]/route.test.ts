import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as workspaceService from "@/server/account/workspace";
import { DELETE, PATCH } from "./route";

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
    disableWorkspaceMember: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    restoreWorkspaceMember: vi.fn(),
    updateWorkspaceMemberRole: vi.fn(),
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

describe("/api/account/workspace/members/[userId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates a workspace member role", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.updateWorkspaceMemberRole).mockReturnValueOnce(workspaceBody);

    const response = await PATCH(
      new Request("http://localhost/api/account/workspace/members/user_2", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ role: "owner" }),
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.currentUserRole).toBe("owner");
    expect(workspaceService.updateWorkspaceMemberRole).toHaveBeenCalledWith({}, "user_1", "user_2", {
      role: "owner",
    });
  });

  it("disables a workspace member", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.disableWorkspaceMember).mockReturnValueOnce({
      ...workspaceBody,
      members: [
        {
          userId: "user_2",
          email: "member@example.com",
          displayName: "Member",
          workspaceRole: "member",
          status: "disabled",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/workspace/members/user_2", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ status: "disabled" }),
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members[0].status).toBe("disabled");
    expect(workspaceService.disableWorkspaceMember).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("restores a disabled workspace member", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.restoreWorkspaceMember).mockReturnValueOnce({
      ...workspaceBody,
      members: [
        {
          userId: "user_2",
          email: "member@example.com",
          displayName: "Member",
          workspaceRole: "member",
          status: "active",
          createdAt: "2026-05-28T00:00:00.000Z",
          updatedAt: "2026-05-28T00:00:00.000Z",
        },
      ],
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/workspace/members/user_2", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ status: "active" }),
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.members[0].status).toBe("active");
    expect(workspaceService.restoreWorkspaceMember).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("removes a workspace member", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.removeWorkspaceMember).mockReturnValueOnce(workspaceBody);

    const response = await DELETE(
      new Request("http://localhost/api/account/workspace/members/user_2", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_2" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization.id).toBe("org_1");
    expect(workspaceService.removeWorkspaceMember).toHaveBeenCalledWith({}, "user_1", "user_2");
  });

  it("returns LAST_OWNER_REQUIRED when the last owner would be removed", async () => {
    mockOwnerSession();
    vi.mocked(workspaceService.removeWorkspaceMember).mockImplementationOnce(() => {
      throw new workspaceService.WorkspaceLastOwnerError();
    });

    const response = await DELETE(
      new Request("http://localhost/api/account/workspace/members/user_1", {
        method: "DELETE",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
      { params: Promise.resolve({ userId: "user_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("LAST_OWNER_REQUIRED");
  });
});
