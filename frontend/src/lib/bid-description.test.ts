import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getBidDescription } from "./bid-description";

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
