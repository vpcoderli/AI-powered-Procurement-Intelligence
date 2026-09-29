import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminShellState } from "./AdminShell";

describe("admin shell", () => {
  it("decides the gate in the old page's order, then the per-page role guard", () => {
    const base = { isLoading: false, hasUser: true, role: "admin", pathname: "/admin" };
    expect(adminShellState({ ...base, isLoading: true })).toBe("loading");
    expect(adminShellState({ ...base, hasUser: false, role: null })).toBe("login_required");
    expect(adminShellState({ ...base, role: "user" })).toBe("forbidden");
    expect(adminShellState({ ...base, role: "support", pathname: "/admin/users" })).toBe("forbidden_page");
    expect(adminShellState({ ...base, role: "support", pathname: "/admin/sources/x1" })).toBe("ready");
    expect(adminShellState(base)).toBe("ready");
  });

  it("keeps the layout a Server Component that renders the client shell", () => {
    const layout = readFileSync(new URL("../../app/admin/layout.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("AdminShell.tsx", import.meta.url), "utf8");
    expect(layout).not.toContain('"use client"');
    expect(layout).toContain("<AdminShell>{children}</AdminShell>");
    expect(shell.startsWith('"use client"')).toBe(true);
    expect(shell).toContain("adminBreadcrumbs(pathname)");
    expect(shell).toContain("adminPageTitleKey(pathname)");
    expect(shell).toContain("<AdminSessionProvider");
    expect(shell).toContain('t("admin.forbiddenPageTitle")');
    expect(shell).toContain('t("admin.loginRequiredTitle")');
  });
});
