import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import {
  adminBreadcrumbs,
  adminNavLabelKeys,
  adminPageTitleKey,
  canViewAdminPath,
  isActiveAdminItem,
  isAdminConsoleRole,
  isAdminPath,
  resolveAdminRoute,
  visibleAdminNav,
} from "./admin-nav";

function visibleHrefs(role: AdminConsoleRole) {
  const view = visibleAdminNav(role);
  return [view.overview?.href, ...view.groups.flatMap((group) => group.items.map((item) => item.href))].filter(Boolean);
}

describe("admin navigation", () => {
  it("shows each role exactly the spec's menu", () => {
    expect(visibleHrefs("admin")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/sources/runs",
      "/admin/quality",
      "/admin/quality/bids",
      "/admin/users",
      "/admin/users/audit",
      "/admin/notifications",
      "/admin/growth",
      "/admin/config",
    ]);
    expect(visibleHrefs("operator")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/sources/runs",
      "/admin/quality",
      "/admin/quality/bids",
      "/admin/notifications",
      "/admin/growth",
    ]);
    expect(visibleHrefs("support")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/quality",
      "/admin/growth",
    ]);
  });

  it("drops a group that has no item for the role", () => {
    expect(visibleAdminNav("support").groups.map((group) => group.key)).toEqual(["sources", "quality", "operations"]);
    expect(visibleAdminNav("admin").groups.map((group) => group.key)).toEqual(["sources", "quality", "access", "operations"]);
  });

  it("resolves menu paths, the source detail page and trailing slashes", () => {
    expect(resolveAdminRoute("/admin")?.item.key).toBe("overview");
    expect(resolveAdminRoute("/admin/")?.item.key).toBe("overview");
    expect(resolveAdminRoute("/admin/sources/runs")?.item.key).toBe("sources.runs");
    expect(resolveAdminRoute("/admin/sources/onboarding")?.detailId).toBeNull();
    const detail = resolveAdminRoute("/admin/sources/bidnet_co_denver");
    expect(detail?.item.key).toBe("sources.list");
    expect(detail?.group?.key).toBe("sources");
    expect(detail?.detailId).toBe("bidnet_co_denver");
    expect(resolveAdminRoute("/admin/sources/a%20b")?.detailId).toBe("a b");
    expect(resolveAdminRoute("/admin/unknown")).toBeNull();
    expect(resolveAdminRoute(null)).toBeNull();
  });

  it("guards pages by role and fails closed on unknown admin paths", () => {
    expect(canViewAdminPath("support", "/admin/sources/runs")).toBe(false);
    expect(canViewAdminPath("support", "/admin/quality/bids")).toBe(false);
    expect(canViewAdminPath("support", "/admin/notifications")).toBe(false);
    expect(canViewAdminPath("support", "/admin/sources/x1")).toBe(true);
    expect(canViewAdminPath("operator", "/admin/users")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/users/audit")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/config")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/sources/runs")).toBe(true);
    expect(canViewAdminPath("admin", "/admin/unknown")).toBe(true);
    expect(canViewAdminPath("operator", "/admin/unknown")).toBe(false);
  });

  it("builds breadcrumbs and page titles", () => {
    expect(adminBreadcrumbs("/admin")).toEqual([{ labelKey: "admin.nav_root", label: null, href: null }]);
    expect(adminBreadcrumbs("/admin/quality/bids")).toEqual([
      { labelKey: "admin.nav_root", label: null, href: "/admin" },
      { labelKey: "admin.nav_group_quality", label: null, href: null },
      { labelKey: "admin.nav_qualityBids", label: null, href: null },
    ]);
    expect(adminBreadcrumbs("/admin/sources/bidnet_co_denver")).toEqual([
      { labelKey: "admin.nav_root", label: null, href: "/admin" },
      { labelKey: "admin.nav_group_sources", label: null, href: null },
      { labelKey: "admin.nav_sourcesList", label: null, href: "/admin/sources" },
      { labelKey: null, label: "bidnet_co_denver", href: null },
    ]);
    expect(adminPageTitleKey("/admin")).toBe("admin.nav_overview");
    expect(adminPageTitleKey("/admin/sources/x1")).toBe("admin.nav_sourceDetail");
    expect(adminPageTitleKey("/admin/nope")).toBe("admin.nav_root");
  });

  it("marks the list item active on the detail page", () => {
    const list = visibleAdminNav("admin").groups[0].items[0];
    expect(isActiveAdminItem(list, "/admin/sources/x1")).toBe(true);
    expect(isActiveAdminItem(list, "/admin/sources/runs")).toBe(false);
  });

  it("recognises admin paths and console roles", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/sources")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath(null)).toBe(false);
    expect(isAdminConsoleRole("support")).toBe(true);
    expect(isAdminConsoleRole("user")).toBe(false);
    expect(isAdminConsoleRole(undefined)).toBe(false);
  });

  it("has an English and a different Chinese label for every key it uses", () => {
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const key of adminNavLabelKeys()) {
      const leaf = key.replace(/^admin\./, "");
      expect(enAdmin[leaf], key).toBeTruthy();
      expect(zhAdmin[leaf], key).toBeTruthy();
      expect(zhAdmin[leaf], key).not.toBe(enAdmin[leaf]);
    }
  });
});
