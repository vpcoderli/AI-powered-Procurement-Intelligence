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
    expect(ordinaryMenuBlock).not.toContain("admin.nav_root");
    expect(ordinaryMenuBlock).not.toContain("/admin");
  });

  it("gives admin-console users one admin entry and the admin tree under /admin", () => {
    const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");
    const tree = readFileSync(new URL("admin-sidebar-tree.tsx", import.meta.url), "utf8");

    expect(sidebar).toContain("adminItems");
    expect(sidebar).toContain('title: t("admin.nav_root")');
    expect(sidebar).toContain('url: "/admin"');
    expect(sidebar).not.toContain("/admin#data-sources");
    expect(sidebar).not.toContain("/admin#configuration");
    expect(sidebar).toContain("isAdminPath(pathname)");
    expect(sidebar).toContain("<AdminSidebarTree");
    expect(tree).toContain("visibleAdminNav(role)");
    expect(tree).toContain("isActiveAdminItem(");
    expect(tree).toContain("SidebarMenuSub");
    expect(tree).toContain('t("admin.nav_backToApp")');
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
