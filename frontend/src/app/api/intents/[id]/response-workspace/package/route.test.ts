import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import type { RequestPrincipal } from "@/server/auth/principal";
import * as responseWorkspaceService from "@/server/response-workspace/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ResponsePackageWorkspace } from "@/server/response-workspace/types";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/response-workspace/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/response-workspace/service")>();

  return {
    ...actual,
    createResponsePackageSnapshot: vi.fn(),
    getResponsePackageWorkspace: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const createResponsePackageSnapshot = vi.mocked(responseWorkspaceService.createResponsePackageSnapshot);
const getResponsePackageWorkspace = vi.mocked(responseWorkspaceService.getResponsePackageWorkspace);

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
  features: ["bid_search"],
};

const packageWorkspace: ResponsePackageWorkspace = {
  workspace: {
    intentId: "intent_1",
    bidId: "bid_1",
    userId: "user_1",
    summary: {
      total: 1,
      done: 0,
      blocked: 0,
      tasks: 0,
      checkpoints: 0,
      artifacts: 1,
      outlineSections: 0,
    },
    items: [],
  },
  outline: [],
  readiness: {
    ready: false,
    totalOutlineSections: 0,
    completedOutlineSections: 0,
    blockedItems: 0,
    artifactPlaceholders: 1,
    artifactPlaceholdersWithLinks: 0,
    missingArtifactLinks: 1,
    openItems: 1,
  },
  snapshots: [],
};

describe("GET /api/intents/[id]/response-workspace/package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("returns response package workspace readiness for Business users", async () => {
    getResponsePackageWorkspace.mockResolvedValueOnce(packageWorkspace);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/response-workspace/package"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ packageWorkspace });
    expect(getResponsePackageWorkspace).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Business", async () => {
    resolvePrincipal.mockResolvedValueOnce(proPrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/response-workspace/package"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(getResponsePackageWorkspace).not.toHaveBeenCalled();
  });
});

describe("POST /api/intents/[id]/response-workspace/package", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("creates a response package snapshot through the service", async () => {
    const snapshot = {
      id: "response_package_snapshot_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      createdByUserId: "user_1",
      title: "Draft package",
      outline: [],
      readiness: packageWorkspace.readiness,
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    createResponsePackageSnapshot.mockResolvedValueOnce({
      snapshot,
      packageWorkspace: {
        ...packageWorkspace,
        snapshots: [snapshot],
      },
    });

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package", {
        method: "POST",
        body: JSON.stringify({ title: "Draft package" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.snapshot).toEqual(snapshot);
    expect(body.packageWorkspace.snapshots).toEqual([snapshot]);
    expect(createResponsePackageSnapshot).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      title: "Draft package",
    });
  });

  it("returns INVALID_REQUEST for a blank snapshot title", async () => {
    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/response-workspace/package", {
        method: "POST",
        body: JSON.stringify({ title: " " }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createResponsePackageSnapshot).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    createResponsePackageSnapshot.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(
      new Request("http://localhost/api/intents/missing/response-workspace/package", {
        method: "POST",
        body: JSON.stringify({ title: "Draft package" }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
