import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ResponseWorkspace } from "@/server/response-workspace/types";
import { GET, PATCH, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    getOrCreateResponseWorkspace: vi.fn(),
    updateResponseWorkspaceItem: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getOrCreateResponseWorkspace = vi.mocked(responseWorkspaceService.getOrCreateResponseWorkspace);
const updateResponseWorkspaceItem = vi.mocked(responseWorkspaceService.updateResponseWorkspaceItem);

const businessPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "response.workspace.create"],
};

const proPrincipal: RequestPrincipal = {
  kind: "authenticated" as const,
  userId: "user_pro",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "submission_guidance"],
};

const workspace: ResponseWorkspace = {
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  summary: {
    total: 1,
    done: 0,
    blocked: 0,
    tasks: 1,
    checkpoints: 0,
    artifacts: 0,
    outlineSections: 0,
  },
  items: [
    {
      id: "response_workspace_item_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      kind: "task",
      title: "Draft technical approach",
      status: "todo",
      notes: "",
      dueAt: null,
      assignedUserId: null,
      assignedUser: null,
      sortOrder: 0,
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      linkedArtifacts: [],
      activity: [],
    },
  ],
};

describe("GET /api/intents/[id]/response-workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("returns generated or existing response workspace items for Business users", async () => {
    getOrCreateResponseWorkspace.mockResolvedValueOnce(workspace);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/response-workspace"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ workspace });
    expect(getOrCreateResponseWorkspace).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Business", async () => {
    resolvePrincipal.mockResolvedValueOnce(proPrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/response-workspace"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(getOrCreateResponseWorkspace).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getOrCreateResponseWorkspace.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/response-workspace"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("PATCH /api/intents/[id]/response-workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("updates an editable response workspace item", async () => {
    const updated: ResponseWorkspace = {
      ...workspace,
      summary: { ...workspace.summary, done: 1 },
      items: [{ ...workspace.items[0], status: "done", notes: "Ready for review." }],
    };
    updateResponseWorkspaceItem.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace", {
        method: "PATCH",
        body: JSON.stringify({
          itemId: "response_workspace_item_1",
          status: "done",
          notes: "Ready for review.",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ workspace: updated });
    expect(updateResponseWorkspaceItem).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "response_workspace_item_1",
      status: "done",
      notes: "Ready for review.",
    });
  });

  it("assigns an editable response workspace item", async () => {
    const updated: ResponseWorkspace = {
      ...workspace,
      items: [{
        ...workspace.items[0],
        assignedUserId: "member_1",
        assignedUser: {
          userId: "member_1",
          email: "member@example.com",
          displayName: "Member One",
        },
      }],
    };
    updateResponseWorkspaceItem.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace", {
        method: "PATCH",
        body: JSON.stringify({
          itemId: "response_workspace_item_1",
          assignedUserId: "member_1",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ workspace: updated });
    expect(updateResponseWorkspaceItem).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "response_workspace_item_1",
      assignedUserId: "member_1",
    });
  });

  it("updates linked supplier artifacts for a response workspace item", async () => {
    const updated: ResponseWorkspace = {
      ...workspace,
      items: [{
        ...workspace.items[0],
        linkedArtifacts: [{
          id: "artifact_1",
          title: "Capability statement",
          fileName: "capability.pdf",
          artifactType: "capability_statement",
          purpose: "response_workspace",
          downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
        }],
        activity: [],
      }],
    };
    updateResponseWorkspaceItem.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace", {
        method: "PATCH",
        body: JSON.stringify({
          itemId: "response_workspace_item_1",
          linkedArtifactIds: ["artifact_1"],
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ workspace: updated });
    expect(updateResponseWorkspaceItem).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "response_workspace_item_1",
      linkedArtifactIds: ["artifact_1"],
    });
  });

  it("also accepts POST for linked supplier artifact updates", async () => {
    updateResponseWorkspaceItem.mockResolvedValueOnce(workspace);

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace", {
        method: "POST",
        body: JSON.stringify({
          itemId: "response_workspace_item_1",
          linkedArtifactIds: [],
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );

    expect(response.status).toBe(200);
    expect(updateResponseWorkspaceItem).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "response_workspace_item_1",
      linkedArtifactIds: [],
    });
  });

  it("returns INVALID_REQUEST for unsupported item status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/response-workspace", {
        method: "PATCH",
        body: JSON.stringify({ itemId: "response_workspace_item_1", status: "complete" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateResponseWorkspaceItem).not.toHaveBeenCalled();
  });
});
