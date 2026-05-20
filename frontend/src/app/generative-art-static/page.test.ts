import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

function readRouteFile(filename: string) {
  return readFileSync(new URL(filename, routeDirectory), "utf8");
}

describe("generative art static route", () => {
  it("keeps the page isolated, static, and regenerated from the referenced demo language", () => {
    const page = readRouteFile("page.tsx");
    const styles = readRouteFile("page.module.css");

    expect(page).toContain("APSi Generative Procurement Studio");
    expect(page).toContain("Source reference: UI UX Pro Max Generative Art Platform");
    expect(page).toContain("Crawler Command Center");
    expect(page).toContain("Live UI/UE Map");
    expect(page).toContain("page.module.css");
    expect(page).not.toContain("/api/");
    expect(page).not.toContain("@/lib/api");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("#0A0A0A");
    expect(styles).toContain("#FF00FF");
    expect(styles).toContain("glassNav");
    expect(styles).toContain("prefers-reduced-motion");
  });
});
