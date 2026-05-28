import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import * as submissionService from "@/server/submission/service";
import { IntentNotFoundError } from "@/server/intents/types";
import type { SubmissionGuidance } from "@/server/submission/types";
import { GET, PATCH } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/submission/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/submission/service")>();

  return {
    ...actual,
    getOrCreateSubmissionGuidance: vi.fn(),
    updateSubmissionGuidance: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const getOrCreateSubmissionGuidance = vi.mocked(submissionService.getOrCreateSubmissionGuidance);
const updateSubmissionGuidance = vi.mocked(submissionService.updateSubmissionGuidance);

const guidance: SubmissionGuidance = {
  id: "submission_path_1",
  intentId: "intent_1",
  bidId: "bid_1",
  userId: "user_1",
  method: "external_portal",
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

describe("GET /api/intents/[id]/submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("returns generated or existing submission guidance", async () => {
    getOrCreateSubmissionGuidance.mockResolvedValueOnce(guidance);

    const response = await GET(new Request("http://localhost/api/intents/intent_1/submission"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ submission: guidance });
    expect(getOrCreateSubmissionGuidance).toHaveBeenCalledWith(expect.anything(), "user_1", "intent_1");
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
});

describe("PATCH /api/intents/[id]/submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("updates editable submission guidance fields", async () => {
    const updated: SubmissionGuidance = { ...guidance, method: "email", requiresRegistration: false };
    updateSubmissionGuidance.mockResolvedValueOnce(updated);

    const response = await PATCH(
      new Request("http://localhost/api/intents/intent_1/submission", {
        method: "PATCH",
        body: JSON.stringify({ method: "email", requiresRegistration: false }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ submission: updated });
    expect(updateSubmissionGuidance).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      { method: "email", requiresRegistration: false },
    );
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
});
