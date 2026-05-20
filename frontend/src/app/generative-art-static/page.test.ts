import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

function readRouteFile(filename: string) {
  return readFileSync(new URL(filename, routeDirectory), "utf8");
}

describe("generative art static route", () => {
  it("keeps the page isolated, static, and styled for the requested concept", () => {
    const page = readRouteFile("page.tsx");
    const styles = readRouteFile("page.module.css");

    expect(page).toContain("Generative Bid Lab");
    expect(page).toContain("Minimalism + Gen Z Chaos");
    expect(page).toContain("page.module.css");
    expect(page).not.toContain("/api/");
    expect(page).not.toContain("@/lib/api");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("#EC4899");
    expect(styles).toContain("prefers-reduced-motion");
  });
});
