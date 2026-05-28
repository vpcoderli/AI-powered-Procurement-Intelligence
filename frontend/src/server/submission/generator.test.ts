import { describe, expect, it } from "vitest";
import type { Bid } from "@/server/bids/domain";
import { generateSubmissionGuidance } from "./generator";

const baseBid: Bid = {
  id: "bid_1",
  title: "Network Modernization",
  source: "SAM.gov",
  sourceUrl: "https://sam.gov/opp/example",
  issuerName: "Department of Defense",
  issuerType: "federal",
  stateCode: "US",
  originalCategory: "IT services",
  description: "Modernization services.",
  fullDescription: "Review all attachments. Addenda acknowledgement may be required.",
  amount: "$100K - $250K",
  publishedDate: "2026-05-20",
  deadlineDate: "2026-06-01",
  contactName: "Jane Buyer",
  contactEmail: "jane@example.gov",
  contactPhone: "555-0101",
  attachments: [{ name: "Solicitation.pdf", url: "https://example.gov/sol.pdf", size: "1 MB" }],
  tags: ["IT"],
  saved: false,
  isActive: true,
};

describe("submission guidance generator", () => {
  it("detects portal submission, registration, addenda, attachments, and fallback contact", () => {
    const guidance = generateSubmissionGuidance(baseBid, {
      now: new Date("2026-05-28T00:00:00.000Z"),
    });

    expect(guidance.method).toBe("external_portal");
    expect(guidance.portalUrl).toBe("https://sam.gov/opp/example");
    expect(guidance.contactEmail).toBe("jane@example.gov");
    expect(guidance.requiresRegistration).toBe(true);
    expect(guidance.requiresAddendaAcknowledgement).toBe(true);
    expect(guidance.readinessChecklist).toContain("Review every solicitation attachment before preparing the response.");
    expect(guidance.readinessChecklist).toContain("Confirm portal account access and registration before the deadline.");
    expect(guidance.riskFlags).toContain("Addenda acknowledgement may be required.");
    expect(guidance.complexityScore).toBeGreaterThanOrEqual(50);
  });

  it("flags physical delivery and missing source URL as higher complexity", () => {
    const guidance = generateSubmissionGuidance(
      {
        ...baseBid,
        source: "State Portal",
        sourceUrl: "",
        contactEmail: "",
        fullDescription: "Sealed bid. Mail one hard copy to the purchasing office.",
        attachments: [],
      },
      { now: new Date("2026-05-28T00:00:00.000Z") },
    );

    expect(guidance.method).toBe("physical_delivery");
    expect(guidance.portalUrl).toBe("");
    expect(guidance.requiresPhysicalDelivery).toBe(true);
    expect(guidance.riskFlags).toContain("Physical delivery or hard copy language detected.");
    expect(guidance.riskFlags).toContain("Source URL is missing; verify submission instructions manually.");
    expect(guidance.complexityScore).toBeGreaterThanOrEqual(80);
  });
});
