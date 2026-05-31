import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("BidCard", () => {
  it("builds detail links with the bid route helper", () => {
    const source = readFileSync(new URL("BidCard.tsx", import.meta.url), "utf8");

    expect(source).toContain("bidDetailPath");
    expect(source).toContain("href={bidDetailPath(bid.id)}");
    expect(source).not.toContain("href={`/bids/${bid.id}`}");
  });
});
