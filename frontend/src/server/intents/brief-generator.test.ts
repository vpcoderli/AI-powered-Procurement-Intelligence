import { describe, expect, it } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import { generateIntentBrief } from "./brief-generator";

describe("intent brief generator", () => {
  it("generates a brief, checklist, dates, and risk flags", () => {
    const result = generateIntentBrief({
      bid: MOCK_BIDS[0],
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
  });
});
