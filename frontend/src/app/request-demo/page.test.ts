import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("request demo page", () => {
  it("exists as a first-class local route instead of relying on the register placeholder", () => {
    const pageUrl = new URL("page.tsx", import.meta.url);

    expect(existsSync(pageUrl)).toBe(true);

    const page = readFileSync(pageUrl, "utf8");

    expect(page).toContain("getRequestDemoContent");
    expect(page).toContain("winbids-workspace");
    expect(page).toContain("handleSubmit");
    expect(page).toContain('fetch("/api/marketing/request-demo"');
    expect(page).toContain("companyName");
    expect(page).toContain("websiteUrl");
    expect(page).toContain("lead.nextUrl");
    expect(page).toContain('href="/register?intent=demo"');
    expect(page).toContain('href="/search"');
    expect(page).not.toMatch(/sent.*email|external sales request submitted|guarantee.*win|guaranteed.*award/i);
  });

  it("keeps bilingual local-demo copy aligned and avoids unsafe claims", async () => {
    const contentUrl = new URL("../../lib/marketing/request-demo-content.ts", import.meta.url);

    expect(existsSync(contentUrl)).toBe(true);
    if (!existsSync(contentUrl)) return;

    const { getRequestDemoContent, requestDemoLanguages } = await import("@/lib/marketing/request-demo-content");

    expect(requestDemoLanguages).toEqual(["en", "zh"]);

    for (const language of requestDemoLanguages) {
      const content = getRequestDemoContent(language);
      const serialized = JSON.stringify(content);

      expect(content.primaryCta.href).toBe("/register?intent=demo");
      expect(content.secondaryCta.href).toBe("/search");
      expect(content.localOnlyNotice).toBeTruthy();
      expect(content.steps).toHaveLength(3);
      expect(serialized).not.toMatch(/automatically submit|guarantee.*win|guaranteed.*award/i);
      expect(serialized).not.toMatch(/自动提交|保证中标|保证授标/);
    }
  });
});
