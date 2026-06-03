import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ResponseWorkspaceComment } from "@/server/response-workspace/types";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    createResponseWorkspaceComment: vi.fn(),
    listResponseWorkspaceComments: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const createResponseWorkspaceComment = vi.mocked(responseWorkspaceService.createResponseWorkspaceComment);
const listResponseWorkspaceComments = vi.mocked(responseWorkspaceService.listResponseWorkspaceComments);

const businessPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "response.workspace.create"] as const,
};

const proPrincipal = {
  kind: "authenticated" as const,
  userId: "user_pro",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "submission_guidance"] as const,
};

const comment: ResponseWorkspaceComment = {
  id: "response_workspace_comment_1",
  intentId: "intent_1",
  itemId: "response_workspace_item_1",
  authorUserId: "user_1",
  author: {
    userId: "user_1",
    email: "buyer@example.com",
    displayName: "Buyer",
  },
  body: "Please validate staffing.",
  createdAt: "2026-06-02T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
};

describe("GET /api/intents/[id]/response-workspace/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("returns comments for a response workspace item", async () => {
    listResponseWorkspaceComments.mockResolvedValueOnce([comment]);

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/comments?itemId=response_workspace_item_1"),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ comments: [comment] });
    expect(listResponseWorkspaceComments).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      "response_workspace_item_1",
    );
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Business", async () => {
    resolvePrincipal.mockResolvedValueOnce(proPrincipal);

    const response = await GET(
      new Request("http://localhost/api/intents/intent_1/response-workspace/comments?itemId=response_workspace_item_1"),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
  });
});

describe("POST /api/intents/[id]/response-workspace/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("creates a response workspace comment", async () => {
    createResponseWorkspaceComment.mockResolvedValueOnce(comment);

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/comments", {
        method: "POST",
        body: JSON.stringify({
          itemId: "response_workspace_item_1",
          body: "Please validate staffing.",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ comment });
    expect(createResponseWorkspaceComment).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "response_workspace_item_1",
      body: "Please validate staffing.",
    });
  });

  it("returns INVALID_REQUEST for empty comments", async () => {
    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/comments", {
        method: "POST",
        body: JSON.stringify({ itemId: "response_workspace_item_1", body: "" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createResponseWorkspaceComment).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    createResponseWorkspaceComment.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(
      new Request("http://localhost/api/intents/missing/response-workspace/comments", {
        method: "POST",
        body: JSON.stringify({ itemId: "response_workspace_item_1", body: "Hello" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
