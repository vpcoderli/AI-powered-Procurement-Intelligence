import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("login page", () => {
  it("links to the password reset request page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("/forgot-password");
    expect(page).toContain("forgotPassword");
  });
});
