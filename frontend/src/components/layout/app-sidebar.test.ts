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
    expect(sidebar).toContain("ADMIN_CONSOLE_ROLES");
    expect(sidebar).not.toContain('["admin", "operator", "support"]');
    expect(sidebar).toContain("user ? authenticatedItems : anonymousItems");
    expect(sidebar).toContain("href=\"/login\"");
    expect(sidebar).toContain("href=\"/register\"");
  });

  it("keeps admin-only navigation out of the ordinary signed-in menu", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");
    const ordinaryMenuBlock = sidebar.slice(sidebar.indexOf("const ordinaryItems"), sidebar.indexOf("const adminItems"));

    expect(sidebar).toContain("ordinaryItems");
    expect(sidebar).toContain("const authenticatedItems = isAdminUser ? adminItems : ordinaryItems");
    expect(sidebar).toContain("const isAdminUser = user ? ADMIN_CONSOLE_ROLES.includes(user.role");
    expect(ordinaryMenuBlock).not.toContain("admin.title");
    expect(ordinaryMenuBlock).not.toContain("admin.sources");
    expect(ordinaryMenuBlock).not.toContain("admin.config");
  });

  it("adds a distinct admin operations cluster for admin console roles", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");
    const adminPage = readFileSync(new URL("../../app/admin/page.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain("adminItems");
    expect(sidebar).toContain('title: t("admin.title")');
    expect(sidebar).toContain('title: t("admin.sources")');
    expect(sidebar).toContain('title: t("admin.config")');
    expect(sidebar).toContain('url: "/admin#data-sources"');
    expect(sidebar).toContain('url: "/admin#configuration"');
    expect(adminPage).toContain('id="data-sources"');
    expect(adminPage).toContain('id="configuration"');
    expect(sidebar).toContain("ServerCog");
    expect(sidebar).toContain("Database");
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
