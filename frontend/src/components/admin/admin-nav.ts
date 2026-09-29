import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ClipboardCheck,
  Database,
  FileSearch,
  Gauge,
  Megaphone,
  Play,
  ScrollText,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { ADMIN_CONSOLE_ROLES, type AdminConsoleRole } from "@/server/auth/entitlements";

/**
 * The admin console's menu (spec 2026-09-29 §3.1). The sidebar tree, the breadcrumb, the page
 * title and the page guard all read this one list.
 */
export interface AdminNavItem {
  /** Stable id, also the React key. */
  key: string;
  href: string;
  /** i18n key in the `admin` namespace. */
  labelKey: string;
  icon: LucideIcon;
  roles: readonly AdminConsoleRole[];
}

export interface AdminNavGroup {
  key: "sources" | "quality" | "access" | "operations";
  labelKey: string;
  icon: LucideIcon;
  items: readonly AdminNavItem[];
}

export interface AdminNavView {
  overview: AdminNavItem | null;
  groups: AdminNavGroup[];
}

export interface ResolvedAdminRoute {
  item: AdminNavItem;
  group: AdminNavGroup | null;
  /** The decoded source id on `/admin/sources/<id>`, otherwise null. */
  detailId: string | null;
}

export interface AdminBreadcrumb {
  labelKey: string | null;
  label: string | null;
  href: string | null;
}

export const ADMIN_ROOT_PATH = "/admin";

const EVERY_CONSOLE_ROLE: readonly AdminConsoleRole[] = ADMIN_CONSOLE_ROLES;
const ADMIN_AND_OPERATOR: readonly AdminConsoleRole[] = ["admin", "operator"];
const ADMIN_ONLY: readonly AdminConsoleRole[] = ["admin"];

export const ADMIN_OVERVIEW_ITEM: AdminNavItem = {
  key: "overview",
  href: ADMIN_ROOT_PATH,
  labelKey: "admin.nav_overview",
  icon: Gauge,
  roles: EVERY_CONSOLE_ROLE,
};

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    key: "sources",
    labelKey: "admin.nav_group_sources",
    icon: Database,
    items: [
      { key: "sources.list", href: "/admin/sources", labelKey: "admin.nav_sourcesList", icon: Database, roles: EVERY_CONSOLE_ROLE },
      { key: "sources.onboarding", href: "/admin/sources/onboarding", labelKey: "admin.nav_sourcesOnboarding", icon: ShieldCheck, roles: EVERY_CONSOLE_ROLE },
      { key: "sources.runs", href: "/admin/sources/runs", labelKey: "admin.nav_sourcesRuns", icon: Play, roles: ADMIN_AND_OPERATOR },
    ],
  },
  {
    key: "quality",
    labelKey: "admin.nav_group_quality",
    icon: ClipboardCheck,
    items: [
      { key: "quality.states", href: "/admin/quality", labelKey: "admin.nav_qualityStates", icon: FileSearch, roles: EVERY_CONSOLE_ROLE },
      { key: "quality.bids", href: "/admin/quality/bids", labelKey: "admin.nav_qualityBids", icon: ClipboardCheck, roles: ADMIN_AND_OPERATOR },
    ],
  },
  {
    key: "access",
    labelKey: "admin.nav_group_access",
    icon: Users,
    items: [
      { key: "access.users", href: "/admin/users", labelKey: "admin.nav_users", icon: Users, roles: ADMIN_ONLY },
      { key: "access.audit", href: "/admin/users/audit", labelKey: "admin.nav_usersAudit", icon: ScrollText, roles: ADMIN_ONLY },
    ],
  },
  {
    key: "operations",
    labelKey: "admin.nav_group_operations",
    icon: ServerCog,
    items: [
      { key: "operations.notifications", href: "/admin/notifications", labelKey: "admin.nav_notifications", icon: Bell, roles: ADMIN_AND_OPERATOR },
      { key: "operations.growth", href: "/admin/growth", labelKey: "admin.nav_growth", icon: Megaphone, roles: EVERY_CONSOLE_ROLE },
      { key: "operations.config", href: "/admin/config", labelKey: "admin.nav_config", icon: SlidersHorizontal, roles: ADMIN_ONLY },
    ],
  },
];

/** The source detail page is not a menu entry; for breadcrumbs and access it belongs to the list. */
const SOURCE_DETAIL_PATTERN = /^\/admin\/sources\/([^/]+)$/;
const SOURCE_DETAIL_TITLE_KEY = "admin.nav_sourceDetail";

export function isAdminConsoleRole(role: string | null | undefined): role is AdminConsoleRole {
  return typeof role === "string" && (ADMIN_CONSOLE_ROLES as readonly string[]).includes(role);
}

export function isAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ADMIN_ROOT_PATH || pathname.startsWith(`${ADMIN_ROOT_PATH}/`);
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function visibleAdminNav(role: AdminConsoleRole): AdminNavView {
  return {
    overview: ADMIN_OVERVIEW_ITEM.roles.includes(role) ? ADMIN_OVERVIEW_ITEM : null,
    groups: ADMIN_NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role)) })).filter(
      (group) => group.items.length > 0,
    ),
  };
}

export function resolveAdminRoute(pathname: string | null | undefined): ResolvedAdminRoute | null {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  if (path === ADMIN_OVERVIEW_ITEM.href) return { item: ADMIN_OVERVIEW_ITEM, group: null, detailId: null };

  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.href === path);
    if (item) return { item, group, detailId: null };
  }

  const detail = SOURCE_DETAIL_PATTERN.exec(path);
  if (detail) {
    const group = ADMIN_NAV_GROUPS.find((candidate) => candidate.key === "sources");
    const item = group?.items.find((candidate) => candidate.key === "sources.list");
    if (group && item) return { item, group, detailId: safeDecode(detail[1]) };
  }
  return null;
}

/** The page guard. An admin path the menu does not know is admin-only (fail closed). */
export function canViewAdminPath(role: AdminConsoleRole, pathname: string | null | undefined): boolean {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved) return role === "admin";
  return resolved.item.roles.includes(role);
}

export function adminBreadcrumbs(pathname: string | null | undefined): AdminBreadcrumb[] {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved || resolved.item === ADMIN_OVERVIEW_ITEM) {
    return [{ labelKey: "admin.nav_root", label: null, href: null }];
  }

  const crumbs: AdminBreadcrumb[] = [{ labelKey: "admin.nav_root", label: null, href: ADMIN_ROOT_PATH }];
  if (resolved.group) crumbs.push({ labelKey: resolved.group.labelKey, label: null, href: null });
  if (resolved.detailId !== null) {
    crumbs.push({ labelKey: resolved.item.labelKey, label: null, href: resolved.item.href });
    crumbs.push({ labelKey: null, label: resolved.detailId, href: null });
  } else {
    crumbs.push({ labelKey: resolved.item.labelKey, label: null, href: null });
  }
  return crumbs;
}

export function adminPageTitleKey(pathname: string | null | undefined): string {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved) return "admin.nav_root";
  return resolved.detailId !== null ? SOURCE_DETAIL_TITLE_KEY : resolved.item.labelKey;
}

export function isActiveAdminItem(item: AdminNavItem, pathname: string | null | undefined): boolean {
  return resolveAdminRoute(pathname)?.item.key === item.key;
}

/** Every i18n key the navigation renders (the dictionary test walks this list). */
export function adminNavLabelKeys(): string[] {
  return [
    "admin.nav_root",
    "admin.nav_backToApp",
    SOURCE_DETAIL_TITLE_KEY,
    ADMIN_OVERVIEW_ITEM.labelKey,
    ...ADMIN_NAV_GROUPS.flatMap((group) => [group.labelKey, ...group.items.map((item) => item.labelKey)]),
  ];
}
