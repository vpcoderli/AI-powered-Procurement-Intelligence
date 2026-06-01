import { describe, expect, it } from "vitest";
import { safeKnowledgeSourceUrl } from "./source-url";

describe("safeKnowledgeSourceUrl", () => {
  it("allows local paths and http sources but rejects protocol-relative URLs", () => {
    expect(safeKnowledgeSourceUrl("/bids/1")).toBe("/bids/1");
    expect(safeKnowledgeSourceUrl("https://sam.gov/opp/1")).toBe("https://sam.gov/opp/1");
    expect(safeKnowledgeSourceUrl("http://example.test/file.pdf")).toBe("http://example.test/file.pdf");
    expect(safeKnowledgeSourceUrl("//evil.example/path")).toBe("");
  });

  it("rejects unsupported and malformed source URLs", () => {
    expect(safeKnowledgeSourceUrl("javascript:alert(1)")).toBe("");
    expect(safeKnowledgeSourceUrl("mailto:buyer@example.com")).toBe("");
    expect(safeKnowledgeSourceUrl("not a url")).toBe("");
  });
});
