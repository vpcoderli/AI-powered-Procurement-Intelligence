import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("supplier workflow resource route", () => {
  it("renders the Match-to-Learn supplier workflow guide with metadata", () => {
    const pageUrl = new URL("page.tsx", import.meta.url);
    const clientUrl = new URL("../resource-pages.tsx", import.meta.url);
    const contentUrl = new URL("../../../lib/marketing/resource-content.ts", import.meta.url);

    expect(existsSync(pageUrl)).toBe(true);
    expect(existsSync(clientUrl)).toBe(true);

    const page = readFileSync(pageUrl, "utf8");
    const client = readFileSync(clientUrl, "utf8");
    const content = readFileSync(contentUrl, "utf8");

    expect(page).toContain("metadata");
    expect(page).toContain("Supplier Pursuit Workflow");
    expect(page).toContain("SupplierWorkflowPage");
    expect(client).toContain("getSupplierWorkflowContent");
    expect(content).toContain("official_submission");
    expect(content).toContain("learning_loop");
    expect(content).toContain("/resources/glossary");
    expect(client).not.toMatch(/guarantee.*win|automatically submit/i);
  });
});
