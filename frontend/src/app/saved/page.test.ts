import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeDirectory = new URL("./", import.meta.url);

describe("saved page", () => {
  it("uses the WinBids demo workspace styling on the real saved route", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");

    expect(page).toContain("useSavedBids");
    expect(page).toContain("winbids-workspace");
    expect(page).toContain("winbids-hero-panel");
    expect(page).toContain("winbids-panel");
  });

  it("shows an auth-required state before loading the personal saved queue", () => {
    const page = readFileSync(new URL("page.tsx", routeDirectory), "utf8");
    const authState = readFileSync(new URL("../../components/auth/AuthRequiredState.tsx", import.meta.url), "utf8");

    expect(page).toContain("AuthRequiredState");
    expect(page).toContain("useAuth");
    expect(page).toContain("SavedBidsContent");
    expect(authState).toContain('href="/login"');
    expect(authState).toContain('href="/register"');
  });
});
