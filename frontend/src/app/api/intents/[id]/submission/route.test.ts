import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as submissionService from "@/server/submission/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { SubmissionEvidenceLinks, SubmissionGuidance } from "@/server/submission/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/submission/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/submission/service")>();

  return {
    ...actual,
    getSubmissionEvidenceLinks: vi.fn(),
    getOrCreateSubmissionGuidance: vi.fn(),
    listSubmissionConfirmations: vi.fn(),
    updateSubmissionGuidance: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getSubmissionEvidenceLinks = vi.mocked(submissionService.getSubmissionEvidenceLinks);
const getOrCreateSubmissionGuidance = vi.mocked(submissionService.getOrCreateSubmissionGuidance);
const listSubmissionConfirmations = vi.mocked(submissionService.listSubmissionConfirmations);
const updateSubmissionGuidance = vi.mocked(submissionService.updateSubmissionGuidance);

const proPrincipal = {
  kind: "authenticated" as const,
  userId: "user_1",
  role: "user" as const,
  tier: "pro" as const,
  features: ["bid_search", "submission_guidance"] as const,
};

const freePrincipal = {
  kind: "authenticated" as const,
  userId: "user_free",
  role: "user" as const,
  tier: "free" as const,
  features: ["bid_search"] as const,
};

const guidance: SubmissionGuidance = {
  id: "submission_path_1",
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  method: "external_portal",
  status: "draft",
  portalUrl: "https://sam.gov/example",
  contactEmail: "buyer@example.gov",
  requiresRegistration: true,
  requiresPhysicalDelivery: false,
  requiresAddendaAcknowledgement: true,
  complexityScore: 65,
  guidanceText: "Submit through the external procurement portal.",
  readinessChecklist: ["Confirm portal access."],
  riskFlags: ["Addenda acknowledgement may be required."],
  createdAt: "2026-05-28T00:00:00.000Z",
  updatedAt: "2026-05-28T00:00:00.000Z",
};

const evidenceLinks: SubmissionEvidenceLinks = {
  responsePackageExports: [{
    id: "response_package_export_1",
    format: "markdown",
    downloadUrl: "/api/intents/intent_1/response-workspace/package/exports/response_package_export_1",
  }],
  linkedSupplierArtifacts: [{
    id: "supplier_artifact_1",
    name: "Signed capability statement",
  }],
  awardOutcome: {
    status: "awarded_to_us",
    awardNoticeUrl: "https://sam.gov/award/notice",
  },
};

describe("GET /api/intents/[id]/submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
    listSubmissionConfirmations.mockResolvedValue([]);
    getSubmissionEvidenceLinks.mockResolvedValue(evidenceLinks);
  });

  it("returns generated or existing submission guidance", async () => {
    getOrCreateSubmissionGuidance.mockResolvedValueOnce(guidance);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/submission"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ submission: guidance, confirmations: [], evidenceLinks });
    expect(getOrCreateSubmissionGuidance).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
    expect(getSubmissionEvidenceLinks).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    getOrCreateSubmissionGuidance.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await GET(new Request("http://localhost/api/intents/missing/submission"), {
      params: Promise.resolve({ id: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });

  it("returns FEATURE_NOT_AVAILABLE for users below Pro", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/submission"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(getOrCreateSubmissionGuidance).not.toHaveBeenCalled();
    expect(getSubmissionEvidenceLinks).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/intents/[id]/submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
    listSubmissionConfirmations.mockResolvedValue([]);
    getSubmissionEvidenceLinks.mockResolvedValue(evidenceLinks);
  });

  it("updates editable submission guidance fields", async () => {
    const updated: SubmissionGuidance = { ...guidance, method: "email", status: "ready", requiresRegistration: false };
    updateSubmissionGuidance.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ method: "email", status: "ready", requiresRegistration: false }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ submission: updated, confirmations: [], evidenceLinks });
    expect(updateSubmissionGuidance).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      { method: "email", status: "ready", requiresRegistration: false },
    );
    expect(getSubmissionEvidenceLinks).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
  });

  it("returns INVALID_REQUEST for unsupported status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ status: "done" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateSubmissionGuidance).not.toHaveBeenCalled();
  });

  it("returns INVALID_REQUEST for manual submitted status", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ status: "submitted" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateSubmissionGuidance).not.toHaveBeenCalled();
  });

  it("returns INVALID_REQUEST for unsupported method", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ method: "fax" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(updateSubmissionGuidance).not.toHaveBeenCalled();
  });

  it("returns FEATURE_NOT_AVAILABLE before updating for users below Pro", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ method: "email" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(updateSubmissionGuidance).not.toHaveBeenCalled();
    expect(getSubmissionEvidenceLinks).not.toHaveBeenCalled();
  });
});
