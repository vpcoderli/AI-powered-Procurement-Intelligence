"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { adminBreadcrumbs, adminPageTitleKey, canViewAdminPath, isAdminConsoleRole } from "./admin-nav";
import { adminRoleFlags, AdminSessionProvider } from "./admin-session";
import { AdminAccessState } from "./AdminStateCards";

export type AdminShellState = "loading" | "login_required" | "forbidden" | "forbidden_page" | "ready";

/** The old page's gate order (loading → signed in → console role), plus the per-page role guard. */
export function adminShellState(input: {
  isLoading: boolean;
  hasUser: boolean;
  role: string | null | undefined;
  pathname: string | null;
}): AdminShellState {
  if (input.isLoading) return "loading";
  if (!input.hasUser) return "login_required";
  if (!isAdminConsoleRole(input.role)) return "forbidden";
  if (!canViewAdminPath(input.role, input.pathname)) return "forbidden_page";
  return "ready";
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const state = adminShellState({ isLoading, hasUser: Boolean(user), role: user?.role ?? null, pathname });

  if (state === "loading") {
    return <AdminAccessState code="loading" title={t("admin.authLoading")} description={t("admin.authLoadingDescription")} />;
  }
  if (state === "login_required") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.loginRequiredTitle")}
        description={t("admin.loginRequiredDescription")}
        action={{ href: "/login", label: t("admin.loginAction") }}
      />
    );
  }
  if (state === "forbidden") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenTitle")}
        description={t("admin.forbiddenDescription")}
        action={{ href: "/", label: t("admin.returnToDashboard") }}
      />
    );
  }
  if (state === "forbidden_page") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenPageTitle")}
        description={t("admin.forbiddenPageDescription")}
        action={{ href: "/admin", label: t("admin.backToOverview") }}
      />
    );
  }
  if (!user || !isAdminConsoleRole(user.role)) return null;

  const crumbs = adminBreadcrumbs(pathname);

  return (
    <AdminSessionProvider value={{ user, ...adminRoleFlags(user.role) }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
        <header className="flex flex-col gap-1">
          <nav aria-label={t("admin.breadcrumbLabel")}>
            <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
              {crumbs.map((crumb, index) => {
                const label = crumb.labelKey ? t(crumb.labelKey) : (crumb.label ?? "");
                const isLast = index === crumbs.length - 1;
                return (
                  <li key={`${index}-${label}`} className="flex items-center gap-1">
                    {index > 0 && <span aria-hidden="true">/</span>}
                    {crumb.href ? (
                      <Link href={crumb.href} className="hover:text-slate-900">
                        {label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? "page" : undefined}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{t(adminPageTitleKey(pathname))}</h1>
        </header>
        {children}
      </div>
    </AdminSessionProvider>
  );
}
