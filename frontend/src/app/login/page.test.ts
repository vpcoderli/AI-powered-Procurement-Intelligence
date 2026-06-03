import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("login page", () => {
  it("links to the password reset request page", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("/forgot-password");
    expect(page).toContain("forgotPassword");
  });

  it("uses the shared WinBids auth shell", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../../components/auth/AuthPageShell.tsx", import.meta.url), "utf8");

    expect(page).toContain("AuthPageShell");
    expect(page).toContain('mode="login"');
    expect(page).toContain("winbids-primary-action");
    expect(shell).toContain("winbids-workspace");
    expect(shell).toContain("winbids-hero-panel");
    expect(shell).toContain("winbids-metric-card");
  });
});
