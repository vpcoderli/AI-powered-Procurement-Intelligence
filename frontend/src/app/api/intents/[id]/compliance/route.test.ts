import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as complianceService from "@/server/compliance/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ComplianceManifest } from "@/server/compliance/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/compliance/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/compliance/service")>();

  return {
    ...actual,
    getOrCreateComplianceManifest: vi.fn(),
    updateComplianceManifestItem: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getOrCreateComplianceManifest = vi.mocked(complianceService.getOrCreateComplianceManifest);
const updateComplianceManifestItem = vi.mocked(complianceService.updateComplianceManifestItem);

const businessPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["bid_search", "submission_guidance", "compliance_manifest"] as const,
};

const proPrincipal = {
  kind: "authenticated" as const,
  userId: "user_pro",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "submission_guidance"] as const,
};

const manifest: ComplianceManifest = {
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  summary: {
    total: 1,
    completed: 0,
    blocked: 0,
    evidenceAttached: 0,
  },
  items: [
    {
      id: "compliance_item_1",
      intentId: "intent_1",
      bidId: "bid_1",
      userId: "user_1",
      title: "Confirm eligibility requirements",
      category: "eligibility",
      status: "not_started",
      evidenceStatus: "needed",
      notes: "",
      sortOrder: 0,
      createdAt: "2026-05-28T00:00:00.000Z",
      updatedAt: "2026-05-28T00:00:00.000Z",
    },
  ],
};

describe("GET /api/intents/[id]/compliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("returns generated or existing compliance manifest for Business users", async () => {
    getOrCreateComplianceManifest.mockResolvedValueOnce(manifest);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/compliance"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ manifest });
    expect(getOrCreateComplianceManifest).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Business", async () => {
    resolvePrincipal.mockResolvedValueOnce(proPrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/compliance"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(getOrCreateComplianceManifest).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getOrCreateComplianceManifest.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/compliance"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});

describe("PATCH /api/intents/[id]/compliance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("updates a compliance manifest item", async () => {
    const updated: ComplianceManifest = {
      ...manifest,
      summary: { ...manifest.summary, completed: 1, evidenceAttached: 1 },
      items: [{ ...manifest.items[0], status: "complete", evidenceStatus: "attached" }],
    };
    updateComplianceManifestItem.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/compliance", {
        method: "PATCH",
        body: JSON.stringify({
          itemId: "compliance_item_1",
          status: "complete",
          evidenceStatus: "attached",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ manifest: updated });
    expect(updateComplianceManifestItem).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1", {
      itemId: "compliance_item_1",
      status: "complete",
      evidenceStatus: "attached",
    });
  });

  it("returns INVALID_REQUEST for unsupported item states", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/compliance", {
        method: "PATCH",
        body: JSON.stringify({ itemId: "compliance_item_1", status: "done" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateComplianceManifestItem).not.toHaveBeenCalled();
  });
});
