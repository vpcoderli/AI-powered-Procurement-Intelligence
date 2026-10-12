import { describe, expect, it } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { generateIntentBrief } from "./brief-generator";
import { toServerBidFixture } from "@/server/bids/test-fixtures";

const usableMatch = {
  bidId: "1", score: 72, confidence: "medium" as const,
  components: { geography: 10, keywords: 20, category: 10, certifications: 0, contractValue: 10, deadline: 15 },
  explanation: "Good fit.", riskNotes: [], missingProfileHints: [],
};

describe("intent brief generator", () => {
  it("refuses to generate a procurement brief from placeholder content", () => {
    expect(() => generateIntentBrief({ bid: toServerBidFixture({
      ...MOCK_BIDS[0], description: "Description:", fullDescription: "Please log in to view details.",
    }), match: usableMatch })).toThrow("valid procurement description");
  });

  it("does not claim discovered attachment links are verified files", () => {
    const result = generateIntentBrief({ bid: toServerBidFixture(MOCK_BIDS[0]), match: usableMatch });
    expect(result.aiBidBrief).toContain("attachment links discovered");
    expect(result.aiBidBrief).toContain("0 verified files");
    expect(result.aiBidBrief).not.toMatch(/attachments? available/);
    expect(result.riskFlags).toContain("No verified attachment files are available.");
  });
  it("generates a brief, checklist, dates, and risk flags", () => {
    const result = generateIntentBrief({
      bid: toServerBidFixture(MOCK_BIDS[0]),
      match: {
        bidId: MOCK_BIDS[0].id,
        score: 72,
        confidence: "medium",
        components: {
          geography: 10,
          keywords: 20,
          category: 10,
          certifications: 0,
          contractValue: 10,
          deadline: 15,
        },
        explanation: "Good fit.",
        riskNotes: ["Review attachments."],
        missingProfileHints: [],
      },
    });

    expect(result.aiBidBrief).toContain(MOCK_BIDS[0].issuerName);
    expect(result.initialChecklist).toContain("Read the full solicitation and all attachments.");
    expect(result.initialChecklist).toHaveLength(7);
    expect(result.keyDates.deadlineDate).toBe(MOCK_BIDS[0].deadlineDate);
    expect(result.riskFlags.length).toBeGreaterThan(0);
    expect(result.aiRun).toMatchObject({
      provider: "deterministic",
      model: "rules://winbids/deterministic-ai-enterprise-depth-lite",
      rulesVersion: "ai-enterprise-depth-lite-rules@2026-06-10",
      promptVersion: "intent-brief-lite@2026-06-10",
      confidence: "medium",
      cost: { currency: "USD", total: 0, estimatedUsd: 0 },
      credits: { estimated: 1, charged: 0, mode: "dry_run" },
      fallback: { used: false, reason: "no_llm_provider_configured" },
      fallbackReason: "no_llm_provider_configured",
    });
  });

  it("labels short published-to-deadline windows as response-window risk", () => {
    const result = generateIntentBrief({
      bid: toServerBidFixture({
        ...MOCK_BIDS[0],
        publishedDate: "2026-05-01",
        deadlineDate: "2026-05-07",
      }),
      match: {
        bidId: MOCK_BIDS[0].id,
        score: 72,
        confidence: "medium",
        components: {
          geography: 10,
          keywords: 20,
          category: 10,
          certifications: 0,
          contractValue: 10,
          deadline: 15,
        },
        explanation: "Good fit.",
        riskNotes: [],
        missingProfileHints: [],
      },
    });

    expect(result.riskFlags).toContain("Response window is 7 days or less.");
    expect(result.riskFlags).not.toContain("Deadline is within 7 days.");
  });
});
