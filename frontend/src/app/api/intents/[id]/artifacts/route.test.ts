import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as artifactService from "@/server/artifacts/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { ArtifactVault } from "@/server/artifacts/types";
import { GET, POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/artifacts/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/artifacts/service")>();

  return {
    ...actual,
    getArtifactVault: vi.fn(),
    createSupplierArtifact: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getArtifactVault = vi.mocked(artifactService.getArtifactVault);
const createSupplierArtifact = vi.mocked(artifactService.createSupplierArtifact);

const businessPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "business" as const,
  features: ["artifact.vault.upload"] as const,
};

const proPrincipal = {
  kind: "authenticated" as const,
  userId: "user_pro",
  role: "user" as const,
  tier: "pro" as const,
  features: ["submission_guidance"] as const,
};

const vault: ArtifactVault = {
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  summary: {
    total: 1,
    active: 1,
    expired: 0,
    pendingReview: 1,
  },
  artifacts: [
    {
      id: "artifact_1",
      userId: "user_1",
      intentId: "intent_1",
      bidId: "bid_1",
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      fileName: "w9.pdf",
      contentType: "application/pdf",
      byteSize: 12,
      storagePath: "/tmp/w9.pdf",
      checksumSha256: "abc",
      expiresAt: null,
      reviewStatus: "pending_review",
      computedStatus: "active",
      notes: "",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
      downloadUrl: "/api/intents/intent_1/artifacts/artifact_1",
    },
  ],
};

describe("/api/intents/[id]/artifacts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(businessPrincipal);
  });

  it("lists artifacts for Business users", async () => {
    getArtifactVault.mockResolvedValueOnce(vault);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/artifacts"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ vault });
    expect(getArtifactVault).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("uploads a multipart artifact for Business users", async () => {
    createSupplierArtifact.mockResolvedValueOnce(vault);
    const form = new FormData();
    const file = new File(["w9 content"], "w9.pdf", { type: "application/pdf" });
    form.set("file", file);
    form.set("title", "Signed W-9");
    form.set("artifactType", "w9");
    form.set("purpose", "compliance_evidence");
    form.set("notes", "Ready for compliance review.");

    const response = await POST(new Request("http://localhost/api/intents/intent_1/artifacts", {
      method: "POST",
      body: form,
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ vault });
    expect(createSupplierArtifact).toHaveBeenCalledWith(expect.any(Object), "user_1", "intent_1", {
      title: "Signed W-9",
      artifactType: "w9",
      purpose: "compliance_evidence",
      expiresAt: null,
      notes: "Ready for compliance review.",
      file: expect.any(File),
    });
  });

  it("returns FEATURE_NOT_AVAILABLE below Business", async () => {
    resolvePrincipal.mockResolvedValueOnce(proPrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/artifacts"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.error.feature).toBe("artifact.vault.upload");
    expect(getArtifactVault).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getArtifactVault.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/artifacts"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });
});
