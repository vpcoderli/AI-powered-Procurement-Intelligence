import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent detail page", () => {
  it("loads and renders qualification evidence citations", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchQualificationCitations");
    expect(page).toContain("QualificationCitation");
    expect(page).toContain("qualificationCitations");
    expect(page).toContain("safeEvidenceUrl");
    expect(page).toContain('t("intentsPage.evidenceCitations")');
    expect(page).toContain('t("intentsPage.noEvidenceCitations")');
  });

  it("renders document-grounded Q&A controls", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("postQualificationQuestion");
    expect(page).toContain("qaQuestion");
    expect(page).toContain("qaAnswer");
    expect(page).toContain('useFeature("bid.brief.full.generate")');
    expect(page).toContain('t("intentsPage.askEvidenceQuestion")');
    expect(page).toContain('t("intentsPage.groundedAnswer")');
  });
});
