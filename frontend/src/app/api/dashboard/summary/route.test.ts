import { afterEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { createDashboardSummaryGet } from "./route";

vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);

describe("GET /api/dashboard/summary", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication for the command-center summary", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    const createSummary = vi.fn();
    const GET = createDashboardSummaryGet({
      database: {},
      createSummary,
      now: () => new Date("2026-06-02T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/api/dashboard/summary"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(createSummary).not.toHaveBeenCalled();
  });

  it("returns command-center summary for the resolved principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({
      kind: "authenticated",
      userId: "user_1",
      role: "user",
      tier: "free",
      features: ["bid_search"],
    });
    const createSummary = vi.fn(async () => ({
      generatedAt: "2026-06-02T00:00:00.000Z",
      briefs: {
        newMatches: { value: 18 },
        dueSoon: { value: 4 },
        evidenceRisks: { value: 0 },
        readyPackages: { value: 1 },
      },
      notifications: [],
      pipeline: { saved: 2, intent: 3, qualifying: 1, ready: 1 },
      dataTrust: {
        stateCoverage: { value: "50/50", ok: true, summary: "50/50 required states have at least one active bid" },
        emptyRuns: { value: 0, ok: true, summary: "120 state bids checked" },
        evidence404: { value: 0, ok: true, summary: "80 state attachments checked" },
        requiredStateSources: 50,
      },
      account: { role: "user", tier: "free" },
    }));
    const GET = createDashboardSummaryGet({
      database: {},
      createSummary,
      now: () => new Date("2026-06-02T00:00:00.000Z"),
    });

    const response = await GET(new Request("http://localhost/api/dashboard/summary"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body.summary.briefs.newMatches.value).toBe(18);
    expect(createSummary).toHaveBeenCalledWith(
      {},
      { userId: "user_1", role: "user", tier: "free" },
      new Date("2026-06-02T00:00:00.000Z"),
    );
  });
});
