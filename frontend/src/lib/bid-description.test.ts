import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBidDescription, getBidDescriptionIssue } from "./bid-description";

describe("getBidDescription", () => {
  it.each([undefined, null, "", "   ", "  ROAD\n REPAIR "])("shows useful short content when full description is %s", (fullDescription) => {
    expect(getBidDescription({ title: "Road repair", description: "Repair bridge decks.", fullDescription })).toBe("Repair bridge decks.");
  });

  it("shows the short field when the legacy full field duplicates it", () => {
    expect(getBidDescription({ title: "Road repair", description: "Repair bridge decks.", fullDescription: "  REPAIR bridge   decks. " })).toBe("Repair bridge decks.");
  });

  it("prefers a useful full body", () => {
    expect(getBidDescription({ title: "Road repair", description: "Summary", fullDescription: "Detailed scope and delivery requirements." })).toBe("Detailed scope and delivery requirements.");
  });

  it("does not hide a longer body behind a stale short prefix in full description", () => {
    expect(getBidDescription({ title: "Road repair", description: "Repair bridge decks. Include traffic management.", fullDescription: "Repair bridge decks." })).toBe("Repair bridge decks. Include traffic management.");
  });

  it("treats a legacy echo that differs only by edge punctuation as the title", () => {
    expect(getBidDescription({ title: "Road repair", description: "Road repair.", fullDescription: "(Road repair)" })).toBe("");
    expect(getBidDescription({ title: "Road repair", description: "Road repair.", fullDescription: "Replace pavement." })).toBe("Replace pavement.");
    // Punctuation inside the text still distinguishes real content.
    expect(getBidDescription({ title: "Road repair", description: "Road repair, phase two." })).toBe("Road repair, phase two.");
  });

  it("returns an empty string when only title echoes exist", () => {
    expect(getBidDescription({ title: "Road repair", description: "road repair", fullDescription: "ROAD REPAIR" })).toBe("");
  });

  it("surfaces the detail body when the importer cleared a title-echo short description", () => {
    expect(getBidDescription({ title: "Road repair", description: "", fullDescription: "Detailed scope from the portal detail page." }))
      .toBe("Detailed scope from the portal detail page.");
  });

  it("hides legacy SAM API links even before a record is refreshed", () => {
    const link = "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=old";
    expect(getBidDescription({ title: "Cloud services", description: link, fullDescription: link })).toBe("");
    expect(getBidDescription({ description: link, fullDescription: "Provide cloud migration services." }))
      .toBe("Provide cloud migration services.");
    expect(getBidDescription({ description: "Provide cloud migration services.", fullDescription: link }))
      .toBe("Provide cloud migration services.");
  });

  it.each([
    "Description:", "Solicitation Description", "Summary", "N/A", "Description not available",
    "Please log in to view the solicitation details.", "Sign in to access this opportunity.",
    "Access denied", "Checking your browser before accessing this site.",
    "Home | About us | Contact us | Privacy policy | Terms of use",
    "https://procurement.example.gov/project/123",
    "123 Main Street, Boston, MA 02108",
    "Purchase Method: Open Market",
    "Solicitation", "Presolicitation", "Combined Synopsis/Solicitation", "Sources Sought",
    "Special Notice", "Award Notice", "Sale of Surplus Property", "IFB", "RFP", "RFQ", "ITB", "RFI",
    "Home\nPrivacy policy\nContact us",
    "<!doctype html><html><body>Login</body></html>",
  ])("does not display portal noise as procurement content: %s", (noise) => {
    expect(getBidDescription({ title: "Road repair", description: noise, fullDescription: noise })).toBe("");
    expect(getBidDescription({ title: "Road repair", description: "Replace pavement.", fullDescription: noise }))
      .toBe("Replace pavement.");
  });

  it.each(["Supply 12 pumps.", "Replace pavement.", "购买五台水泵。", "Repair pumps; log in to submit your offer.", "RFP for 12 pumps.", "Register pump warranties with the city."])(
    "accepts short real procurement content: %s", (body) => {
      expect(getBidDescription({ title: "Public works procurement", description: body })).toBe(body);
    },
  );
});

describe("getBidDescriptionIssue", () => {
  it("trims edge punctuation in linear time on the description and the title", () => {
    const run = ".".repeat(100_000);
    const started = performance.now();
    expect(getBidDescriptionIssue(`Repair${run}pumps`, "Road repair")).toBeNull();
    expect(getBidDescriptionIssue("Repair pumps", `Road${run}repair`)).toBeNull();
    // A regex trim retried from every dot of the run: about 4 s per call at this length.
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

/**
 * The crawler importer now normalizes `bids.description` to "" for title echoes and for rows
 * whose only body lives in `full_description` (see persistence-merge.ts). Any surface that
 * renders `bid.description` directly therefore shows a blank paragraph for those rows, so every
 * bid-body surface must resolve through `getBidDescription`.
 */
describe("bid body display surfaces", () => {
  it.each([
    ["src/components/bids/BidCard.tsx", "../components/bids/BidCard.tsx"],
    ["src/app/bids/[id]/page.tsx", "../app/bids/[id]/page.tsx"],
  ])("routes %s through getBidDescription", (_label, relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    expect(source).toContain('import { getBidDescription } from "@/lib/bid-description"');
    expect(source).toContain("getBidDescription(bid)");
    expect(source).not.toContain("{bid.description}");
  });
});
