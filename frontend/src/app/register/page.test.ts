import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("register page", () => {
  it("uses the shared WinBids auth shell", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../../components/auth/AuthPageShell.tsx", import.meta.url), "utf8");

    expect(page).toContain("AuthPageShell");
    expect(page).toContain('mode="register"');
    expect(page).toContain("winbids-primary-action");
    expect(shell).toContain("winbids-workspace");
    expect(shell).toContain("winbids-hero-panel");
    expect(shell).toContain("winbids-metric-card");
  });

  it("turns register?intent=demo into an explicit local demo account path", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("useSearchParams");
    expect(page).toContain('searchParams.get("intent") === "demo"');
    expect(page).toContain("demoTitle");
    expect(page).toContain("demoSubtitle");
    expect(page).toContain("demoSubmit");
    expect(page).toContain("No external email is sent");
    expect(page).toContain('fetch("/api/marketing/signup-start"');
    expect(page).toContain("leadEventId");
    expect(page).toContain("marketingIntent");
    expect(page).not.toMatch(/automatically submit|guarantee.*win|guaranteed.*award/i);
  });
});
