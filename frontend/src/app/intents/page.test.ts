import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("intent pages", () => {
  it("lists intents and links to workspace details", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchIntents");
    expect(page).toContain("/intents/");
    expect(page).toContain("Intent to Bid");
  });
});
