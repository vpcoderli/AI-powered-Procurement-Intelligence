import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("app sidebar", () => {
  it("gates the Knowledge Station library navigation item by feature entitlement", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain('"/knowledge"');
    expect(sidebar).toContain('"knowledge_station"');
    expect(sidebar).toContain('"knowledge.library"');
  });

  it("uses different navigation groups for anonymous, signed-in, and admin users", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain("anonymousItems");
    expect(sidebar).toContain("authenticatedItems");
    expect(sidebar).toContain("adminConsoleRoles");
    expect(sidebar).toContain("user ? authenticatedItems : anonymousItems");
    expect(sidebar).toContain("href=\"/login\"");
    expect(sidebar).toContain("href=\"/register\"");
  });

  it("provides a visible authenticated logout action that clears the session and returns to login", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain("LogOut");
    expect(sidebar).toContain("useRouter");
    expect(sidebar).toContain("const { user, logout } = useAuth()");
    expect(sidebar).toContain("handleLogout");
    expect(sidebar).toContain("await logout()");
    expect(sidebar).toContain('router.push("/login")');
    expect(sidebar).toContain('t("common.logout")');
  });
});
