import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bid detail pursuit panel", () => {
  it("loads match score and creates intent from the detail page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("fetchBidMatch");
    expect(page).toContain("createIntent");
    expect(page).toContain("Add to Intent");
    expect(page).toContain("match.score");
  });
});
