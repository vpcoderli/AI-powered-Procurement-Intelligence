"use client";

import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/server/auth/entitlements";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { AdminAccessState } from "@/components/admin/AdminStateCards";

const ADMIN_CONSOLE_USER_ROLES: UserRole[] = ["admin", "operator", "support"];

export default function AdminPage() {
  const { t } = useLanguage();
  const { user, isLoading: isAuthLoading } = useAuth();
  const canAccessAdminConsole = Boolean(user && ADMIN_CONSOLE_USER_ROLES.includes(user.role));

  if (isAuthLoading) {
    return (
      <AdminAccessState
        code="loading"
        title={t("admin.authLoading")}
        description={t("admin.authLoadingDescription")}
      />
    );
  }

  if (!user) {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.loginRequiredTitle")}
        description={t("admin.loginRequiredDescription")}
        action={{ href: "/login", label: t("admin.loginAction") }}
      />
    );
  }

  if (!canAccessAdminConsole) {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenTitle")}
        description={t("admin.forbiddenDescription")}
        action={{ href: "/", label: t("admin.returnToDashboard") }}
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{t("admin.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("admin.description")}</p>
      </div>
    </main>
  );
}
