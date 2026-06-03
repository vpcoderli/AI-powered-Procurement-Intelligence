import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_CONSOLE_ROLES, type AdminConsoleRole } from "./entitlements";

const adminApiRoot = new URL("../../app/api/admin/", import.meta.url);

const adminOnlyRoutes = [
  "../../app/api/admin/config/route.ts",
  "../../app/api/admin/config/[id]/route.ts",
  "../../app/api/admin/data-sources/batch/route.ts",
  "../../app/api/admin/subscriptions/reconcile/route.ts",
  "../../app/api/admin/users/route.ts",
  "../../app/api/admin/users/[id]/route.ts",
  "../../app/api/admin/users/[id]/feature-overrides/route.ts",
  "../../app/api/admin/users/audit-logs/route.ts",
] as const;

const operatorMutationRoutes = [
  "../../app/api/admin/bids/qa/[id]/route.ts",
  "../../app/api/admin/bids/qa/batch/route.ts",
  "../../app/api/admin/billing/dunning/route.ts",
  "../../app/api/admin/data-sources/[id]/route.ts",
  "../../app/api/admin/data-sources/[id]/health-check/route.ts",
  "../../app/api/admin/notifications/deliver/route.ts",
] as const;

const consoleReadRoutes = [
  "../../app/api/admin/bids/qa/route.ts",
  "../../app/api/admin/crawler-logs/route.ts",
  "../../app/api/admin/data-sources/route.ts",
  "../../app/api/admin/notifications/route.ts",
  "../../app/api/admin/risk-check/route.ts",
] as const;

function routeFiles(url: URL): URL[] {
  return readdirSync(url, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);

    if (entry.isDirectory()) return routeFiles(child);
    return entry.name === "route.ts" ? [child] : [];
  });
}

function relativeAdminRoutePath(url: URL) {
  return `../../app/api/admin/${decodeURIComponent(url.href.replace(adminApiRoot.href, ""))}`;
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function roleArrayPattern(roles: readonly AdminConsoleRole[]) {
  return new RegExp(`roles:\\s*\\[${roles.map((role) => `\\s*"${role}"`).join(",")}\\s*\\]`);
}

describe("admin API role route coverage", () => {
  it("keeps every admin route behind the shared admin auth guard", () => {
    const routes = routeFiles(adminApiRoot);

    expect(routes.map(relativeAdminRoutePath).sort()).toEqual(
      [...adminOnlyRoutes, ...operatorMutationRoutes, ...consoleReadRoutes].sort(),
    );

    for (const route of routes) {
      const routeSource = readFileSync(route, "utf8");

      expect(routeSource).toContain("@/server/admin/auth");
      expect(routeSource).not.toContain("resolvePrincipal");
    }
  });

  it.each(adminOnlyRoutes)("restricts %s to full admin users", (route) => {
    const routeSource = source(route);

    expect(routeSource.includes("requireAdmin(") || roleArrayPattern(["admin"]).test(routeSource)).toBe(true);
  });

  it.each(operatorMutationRoutes)("allows %s only for admins and operators", (route) => {
    const routeSource = source(route);

    expect(routeSource).toContain("requireAdminAccess");
    expect(routeSource).toMatch(roleArrayPattern(["admin", "operator"]));
  });

  it.each(consoleReadRoutes)("allows %s only for explicit admin console roles", (route) => {
    const routeSource = source(route);

    expect(routeSource).toContain("requireAdminAccess");
    expect(routeSource).toMatch(roleArrayPattern(ADMIN_CONSOLE_ROLES));
  });
});
