import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

function readRouteFile(filename: string) {
  return readFileSync(new URL(filename, routeDirectory), "utf8");
}

describe("winbids demo route", () => {
  it("renders an isolated static demo from the Drive frontend prototype content", () => {
    const page = readRouteFile("page.tsx");
    const styles = readRouteFile("page.module.css");

    expect(page).toContain("WinBids MVP UX Prototype v2");
    expect(page).toContain("Evaluate Citywide Facility Maintenance Services");
    expect(page).toContain("New high-fit bids");
    expect(page).toContain("Module map");
    expect(page).toContain("AI summary");
    expect(page).toContain("Submission Path");
    expect(page).toContain("Intent Workspace");
    expect(page).toContain("page.module.css");
    expect(page).not.toContain("@/lib/api");
    expect(page).not.toContain("fetch(");
    expect(styles).toContain("demoShell");
    expect(styles).toContain("sidebar");
    expect(styles).toContain("kanban");
    expect(styles).toContain("@media");
  });
});
