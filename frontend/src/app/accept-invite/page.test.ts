import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("accept invite page", () => {
  it("wires invitation acceptance to the auth API client", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("acceptWorkspaceInvitation");
    expect(page).toContain("acceptInvite.token");
    expect(page).toContain("acceptInvite.password");
    expect(page).toContain("acceptInvite.confirmPassword");
    expect(page).toContain("acceptInvite.accept");
    expect(page).toContain("acceptInvite.teamSeatLimitReached");
    expect(page).toContain("refreshSession");
  });
});
