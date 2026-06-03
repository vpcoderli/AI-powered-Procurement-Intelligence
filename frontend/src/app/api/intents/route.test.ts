import { beforeEach, describe, expect, it, vi } from "vitest";
import * as principal from "@/server/auth/principal";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as intentService from "@/server/intents/service";
import type { IntentSummary } from "@/server/intents/types";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/auth/principal", () => ({
  resolvePrincipal: vi.fn(),
}));
vi.mock("@/server/intents/service", () => ({
  listUserIntents: vi.fn(),
}));

const resolvePrincipal = vi.mocked(principal.resolvePrincipal);
const listUserIntents = vi.mocked(intentService.listUserIntents);

describe("GET /api/intents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolvePrincipal.mockResolvedValue({ kind: "authenticated", userId: "user_1" });
  });

  it("requires an authenticated principal", async () => {
    resolvePrincipal.mockResolvedValueOnce({ kind: "anonymous", userId: "anon_existing" });

    const response = await GET(new Request("http://localhost/api/intents"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
    expect(listUserIntents).not.toHaveBeenCalled();
  });

  it("lists intents for the current principal", async () => {
    const intents: IntentSummary[] = [
      {
        id: "intent_1",
        userId: "user_1",
        status: "intent_added",
        bid: MOCK_BIDS[0],
        generated: {
          aiBidBrief: "Brief",
          keyDates: { publishedDate: "2026-05-01", deadlineDate: "2026-06-01" },
          initialChecklist: [],
          riskFlags: [],
        },
        match: {
          bidId: "1",
          score: 70,
          confidence: "medium",
          components: {
            geography: 20,
            keywords: 20,
            category: 10,
            certifications: 0,
            contractValue: 5,
            deadline: 15,
          },
          explanation: "Good fit.",
          riskNotes: [],
          missingProfileHints: [],
        },
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    ];
    listUserIntents.mockResolvedValueOnce(intents);

    const response = await GET(new Request("http://localhost/api/intents"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ intents });
    expect(listUserIntents).toHaveBeenCalledWith(expect.anything(), "user_1");
  });

  it("returns INTERNAL_ERROR for unexpected failures", async () => {
    listUserIntents.mockRejectedValueOnce(new Error("private detail"));

    const response = await GET(new Request("http://localhost/api/intents"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
  });
});
