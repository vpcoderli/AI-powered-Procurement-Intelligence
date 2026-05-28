import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageLimitError } from "@/server/auth/usage-limits";
import * as workspaceService from "@/server/account/workspace";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/account/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/account/workspace")>();

  return {
    ...actual,
    acceptWorkspaceInvitation: vi.fn(),
  };
});

describe("POST /api/account/workspace/invitations/accept", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a workspace invitation and returns an authenticated user", async () => {
    vi.mocked(workspaceService.acceptWorkspaceInvitation).mockResolvedValueOnce({
      user: {
        id: "user_2",
        email: "member@example.com",
        displayName: "Member One",
        role: "user",
        tier: "free",
        features: ["bid_search"],
        workspace: {
          organizationId: "org_1",
          organizationName: "Acme Federal Team",
          role: "member",
        },
      },
      sessionToken: "sess_invited",
    });

    const response = await POST(
      new Request("http://localhost/api/account/workspace/invitations/accept", {
        method: "POST",
        body: JSON.stringify({
          token: "invite_secret",
          password: "member-strong-password",
          displayName: "Member One",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user.email).toBe("member@example.com");
    expect(response.headers.get("set-cookie")).toContain("apsi_session=");
    expect(workspaceService.acceptWorkspaceInvitation).toHaveBeenCalledWith({}, {
      token: "invite_secret",
      password: "member-strong-password",
      displayName: "Member One",
    });
  });

  it("returns INVALID_INVITATION_TOKEN for invalid tokens", async () => {
    vi.mocked(workspaceService.acceptWorkspaceInvitation).mockRejectedValueOnce(
      new workspaceService.InvalidWorkspaceInvitationTokenError(),
    );

    const response = await POST(
      new Request("http://localhost/api/account/workspace/invitations/accept", {
        method: "POST",
        body: JSON.stringify({
          token: "invite_bad",
          password: "member-strong-password",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_INVITATION_TOKEN");
  });

  it("returns USAGE_LIMIT_REACHED when the workspace has no remaining team seats", async () => {
    vi.mocked(workspaceService.acceptWorkspaceInvitation).mockRejectedValueOnce(
      new UsageLimitError({
        feature: "team_members",
        tier: "free",
        used: 1,
        limit: 1,
        requiredTier: "business",
      }),
    );

    const response = await POST(
      new Request("http://localhost/api/account/workspace/invitations/accept", {
        method: "POST",
        body: JSON.stringify({
          token: "invite_secret",
          password: "member-strong-password",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body.error).toMatchObject({
      code: "USAGE_LIMIT_REACHED",
      feature: "team_members",
      limit: 1,
      used: 1,
      requiredTier: "business",
    });
  });
});
