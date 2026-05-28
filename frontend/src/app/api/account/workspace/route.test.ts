import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import * as authService from "@/server/auth/service";
import * as workspaceService from "@/server/account/workspace";
import { GET, PATCH } from "./route";

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
    getAccountWorkspace: vi.fn(),
    updateOrganizationName: vi.fn(),
  };
});

const sessionUser: authService.PublicUser = {
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
};

const workspaceResponse: workspaceService.AccountWorkspaceResponse = {
  organization: {
    id: "org_1",
    name: "Acme Federal Team",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
  },
  currentUserRole: "owner",
  members: [
    {
      userId: "user_1",
      email: "owner@example.com",
      displayName: "Owner",
      workspaceRole: "owner",
      status: "active",
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    },
  ],
};

describe("GET /api/account/workspace", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current user's workspace", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(sessionUser);
    vi.mocked(workspaceService.getAccountWorkspace).mockReturnValueOnce(workspaceResponse);

    const response = await GET(
      new Request("http://localhost/api/account/workspace", {
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization.name).toBe("Acme Federal Team");
    expect(body.currentUserRole).toBe("owner");
    expect(workspaceService.getAccountWorkspace).toHaveBeenCalledWith({}, "user_1");
  });

  it("requires authentication", async () => {
    const response = await GET(new Request("http://localhost/api/account/workspace"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });
});

describe("PATCH /api/account/workspace", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renames the current user's workspace", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(sessionUser);
    vi.mocked(workspaceService.updateOrganizationName).mockReturnValueOnce(workspaceResponse);

    const response = await PATCH(
      new Request("http://localhost/api/account/workspace", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ name: "Acme Federal Team" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.organization.name).toBe("Acme Federal Team");
    expect(workspaceService.updateOrganizationName).toHaveBeenCalledWith({}, "user_1", {
      name: "Acme Federal Team",
    });
  });

  it("returns FORBIDDEN when a non-owner tries to rename", async () => {
    vi.mocked(authService.getSessionUser).mockResolvedValueOnce(sessionUser);
    vi.mocked(workspaceService.updateOrganizationName).mockImplementationOnce(() => {
      throw new workspaceService.WorkspacePermissionError();
    });

    const response = await PATCH(
      new Request("http://localhost/api/account/workspace", {
        method: "PATCH",
        headers: { cookie: `${SESSION_COOKIE_NAME}=sess_valid` },
        body: JSON.stringify({ name: "Acme Federal Team" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
