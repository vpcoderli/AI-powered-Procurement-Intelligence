import { describe, expect, it, vi } from "vitest";
import type { QuoteWorkspace } from "@/server/quotes/types";
import * as quoteService from "@/server/quotes/service";

vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(async () => ({
    kind: "authenticated",
    userId: "user_1",
    role: "user",
    tier: "business",
    features: ["quote_workflow"],
  })),
}));

vi.mock("@/server/db/client", () => ({ db: {} }));

vi.mock("@/server/quotes/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/quotes/service")>();

  return {
    ...actual,
    createQuoteRequest: vi.fn(),
    getQuoteWorkspace: vi.fn(),
    updateQuoteRequest: vi.fn(),
  };
});

const workspace: QuoteWorkspace = {
  intentId: "intent_1",
  bidId: "bid_1",
  organizationId: "org_1",
  summary: {
    partners: 1,
    requests: 1,
    draft: 1,
    sent: 0,
    received: 0,
    accepted: 0,
  },
  partners: [
    {
      id: "partner_1",
      organizationId: "org_1",
      createdByUserId: "user_1",
      name: "Acme Distribution",
      contactName: "Riley Adams",
      contactEmail: "quotes@acme.example",
      phone: "",
      category: "",
      regions: [],
      capabilityTags: [],
      status: "active",
      notes: "",
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
  requests: [
    {
      id: "quote_request_1",
      organizationId: "org_1",
      intentId: "intent_1",
      bidId: "bid_1",
      partnerId: "partner_1",
      partnerName: "Acme Distribution",
      createdByUserId: "user_1",
      title: "Cloud migration quote",
      description: "",
      status: "draft",
      requestedDueAt: null,
      lineItems: [],
      quotedAmountCents: null,
      currency: "USD",
      responseNotes: "",
      respondedAt: null,
      artifacts: [],
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
  ],
};

describe("GET /api/intents/[id]/quotes", () => {
  it("returns the quote workspace for Business users", async () => {
    vi.mocked(quoteService.getQuoteWorkspace).mockResolvedValueOnce(workspace);
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/intents/intent_1/quotes"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workspace).toEqual(workspace);
    expect(quoteService.getQuoteWorkspace).toHaveBeenCalledWith({}, "user_1", "intent_1");
  });

  it("returns FEATURE_NOT_AVAILABLE below Business", async () => {
    const principal = await import("@/server/auth/principal");
    vi.mocked(principal.resolvePrincipal).mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "pro",
      features: [],
    });
    const { GET } = await import("./route");

    const response = await GET(new Request("http://localhost/api/intents/intent_1/quotes"), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
    expect(body.error.feature).toBe("quote_workflow");
  });
});

describe("POST /api/intents/[id]/quotes", () => {
  it("creates a quote request", async () => {
    vi.mocked(quoteService.createQuoteRequest).mockResolvedValueOnce(workspace);
    const { POST } = await import("./route");

    const response = await POST(new Request("http://localhost/api/intents/intent_1/quotes", {
      method: "POST",
      body: JSON.stringify({
        partnerName: "Acme Distribution",
        title: "Cloud migration quote",
        artifactIds: ["artifact_1"],
      }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.workspace).toEqual(workspace);
    expect(quoteService.createQuoteRequest).toHaveBeenCalledWith({}, "user_1", "intent_1", {
      partnerName: "Acme Distribution",
      title: "Cloud migration quote",
      artifactIds: ["artifact_1"],
    });
  });
});

describe("PATCH /api/intents/[id]/quotes", () => {
  it("updates a quote request", async () => {
    vi.mocked(quoteService.updateQuoteRequest).mockResolvedValueOnce({
      ...workspace,
      summary: { ...workspace.summary, draft: 0, received: 1 },
      requests: [{ ...workspace.requests[0], status: "received", quotedAmountCents: 120000 }],
    });
    const { PATCH } = await import("./route");

    const response = await PATCH(new Request("http://localhost/api/intents/intent_1/quotes", {
      method: "PATCH",
      body: JSON.stringify({
        requestId: "quote_request_1",
        status: "received",
        quotedAmountCents: 120000,
      }),
    }), {
      params: Promise.resolve({ id: "intent_1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.workspace.summary.received).toBe(1);
    expect(quoteService.updateQuoteRequest).toHaveBeenCalledWith({}, "user_1", "intent_1", {
      requestId: "quote_request_1",
      status: "received",
      quotedAmountCents: 120000,
    });
  });
});
