import { describe, expect, it } from "vitest";
import { validateBidSourceUrl, validateStateAttachmentUrl } from "./url-validity";

describe("source URL validity", () => {
  it("accepts real https state portal URLs", () => {
    expect(validateBidSourceUrl("https://caleprocure.ca.gov/event/CA-2026-1")).toEqual([]);
  });

  it("rejects empty, malformed, local, example, and known demo URLs", () => {
    expect(validateBidSourceUrl("")).toContainEqual(expect.objectContaining({ code: "empty_url" }));
    expect(validateBidSourceUrl("not a url")).toContainEqual(expect.objectContaining({ code: "invalid_url" }));
    expect(validateBidSourceUrl("http://localhost:3000/bids/1")).toContainEqual(
      expect.objectContaining({ code: "placeholder_url" }),
    );
    expect(validateBidSourceUrl("https://example.com/bid/1")).toContainEqual(
      expect.objectContaining({ code: "placeholder_url" }),
    );
    expect(validateBidSourceUrl("https://sam.gov/opp/12345/sow.pdf")).toContainEqual(
      expect.objectContaining({ code: "placeholder_url" }),
    );
  });

  it("accepts safe local attachment download routes", () => {
    expect(validateStateAttachmentUrl("/api/bids/ca_caleprocure%3A1/attachments/sow_pdf")).toEqual([]);
  });

  it("rejects raw external attachment URLs for state risk checks", () => {
    expect(validateStateAttachmentUrl("https://sam.gov/opp/12345/sow.pdf")).toContainEqual(
      expect.objectContaining({ code: "unsafe_external_attachment" }),
    );
  });
});
