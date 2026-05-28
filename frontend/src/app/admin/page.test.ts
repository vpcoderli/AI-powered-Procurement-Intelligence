import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin page", () => {
  it("renders user access controls alongside crawler operations", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(page).toContain("listAdminUsers");
    expect(page).toContain("updateAdminUserAccess");
    expect(page).toContain('t("admin.users")');
    expect(page).toContain("USER_ROLES");
    expect(page).toContain("ACCOUNT_TIERS");
  });
});
