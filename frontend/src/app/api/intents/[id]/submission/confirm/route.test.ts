import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { IntentNotFoundError } from "@/server/intents/types";
import * as submissionService from "@/server/submission/service";
import type { SubmissionConfirmation } from "@/server/submission/types";
import { POST } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/submission/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/submission/service")>();

  return {
    ...actual,
    createSubmissionConfirmation: vi.fn(),
  };
});

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const createSubmissionConfirmation = vi.mocked(submissionService.createSubmissionConfirmation);

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

const confirmation: SubmissionConfirmation = {
  id: "submission_confirmation_1",
  intentId: "intent_1",
  userId: "user_1",
  submittedAt: "2026-05-29T15:30:00.000Z",
  method: "external_portal",
  confirmationReference: "CONF-123",
  confirmationNotes: "Receipt downloaded.",
  createdAt: "2026-05-29T15:31:00.000Z",
  updatedAt: "2026-05-29T15:31:00.000Z",
};

describe("POST /api/intents/[id]/submission/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolvePrincipal.mockResolvedValue(proPrincipal);
  });

  it("stores a manual external submission confirmation", async () => {
    createSubmissionConfirmation.mockResolvedValueOnce(confirmation);

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/submission/confirm", {
        method: "POST",
        body: JSON.stringify({
          submittedAt: "2026-05-29T15:30:00.000Z",
          method: "external_portal",
          confirmationReference: "CONF-123",
          confirmationNotes: "Receipt downloaded.",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ confirmation });
    expect(createSubmissionConfirmation).toHaveBeenCalledWith(
      expect.anything(),
      "user_1",
      "intent_1",
      {
        submittedAt: "2026-05-29T15:30:00.000Z",
        method: "external_portal",
        confirmationReference: "CONF-123",
        confirmationNotes: "Receipt downloaded.",
      },
    );
  });

  it("returns INVALID_REQUEST when submittedAt is missing", async () => {
    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/submission/confirm", {
        method: "POST",
        body: JSON.stringify({ method: "external_portal" }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(createSubmissionConfirmation).not.toHaveBeenCalled();
  });

  it("returns INTENT_NOT_FOUND when the intent is missing", async () => {
    createSubmissionConfirmation.mockRejectedValueOnce(new IntentNotFoundError());

    const response = await POST(
      new Request("http://localhost/api/intents/missing/submission/confirm", {
        method: "POST",
        body: JSON.stringify({
          submittedAt: "2026-05-29T15:30:00.000Z",
          method: "external_portal",
        }),
      }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("INTENT_NOT_FOUND");
  });

  it("returns FEATURE_NOT_AVAILABLE before storing confirmations for users below Pro", async () => {
    resolvePrincipal.mockResolvedValueOnce(freePrincipal);

    const response = await POST(
      new Request("http://localhost/api/intents/intent_1/submission/confirm", {
        method: "POST",
        body: JSON.stringify({
          submittedAt: "2026-05-29T15:30:00.000Z",
          method: "external_portal",
        }),
      }),
      { params: Promise.resolve({ id: "intent_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(createSubmissionConfirmation).not.toHaveBeenCalled();
  });
});
