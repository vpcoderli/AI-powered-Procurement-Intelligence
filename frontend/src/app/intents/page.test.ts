import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent pages", () => {
  it("lists intents and links to workspace details", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchIntents");
    expect(page).toContain("/intents/");
    expect(page).toContain("Intent to Bid");
  });

  it("loads intent workspace details and guards status updates", () => {
    const detailPage = readFileSync(new URL("[id]/page.tsx", import.meta.url), "utf8");

    expect(detailPage).toContain("fetchIntent");
    expect(detailPage).toContain("updateIntentStatus");
    expect(detailPage).toContain("mountedRef");
    expect(detailPage).toContain("saveRequestRef");
    expect(detailPage).toContain("onValueChange={(value)");
    expect(detailPage).toContain("prototypeWorkspace");
    expect(detailPage).toContain("submissionReadinessItems");
    expect(detailPage).toContain("submissionPath");
    expect(detailPage).toContain("Intent Workspace");
    expect(detailPage).toContain("Submission Path");
  });
});
