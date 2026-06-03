import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SavedBidsProvider", () => {
  it("does not load personal saved bids while no user is signed in", () => {
    const provider = readFileSync(new URL("SavedBidsContext.tsx", import.meta.url), "utf8");

    expect(provider).toContain("useAuth");
    expect(provider).toContain("if (!user)");
    expect(provider).toContain("fetchSavedBids");
    expect(provider.indexOf("if (!user)")).toBeLessThan(provider.indexOf("const response = await fetchSavedBids"));
  });
});
