"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";

const initialsFor = (nameOrEmail?: string | null) => {
  const source = nameOrEmail?.trim();
  if (!source) return "U";

  const parts = source
    .replace(/@.*/, "")
    .split(/\s+|[._-]+/)
    .filter(Boolean);

  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

export function TopbarAuthActions() {
  const { user, isLoading, logout } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const handleLogout = async () => {
    await logout();
    router.push("/login");
    router.refresh();
  };

  if (isLoading) {
    return <div className="h-8 w-28 rounded-lg border border-slate-200 bg-slate-100" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/login"
          className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950"
        >
          {t("common.login")}
        </Link>
        <Link
          href="/register"
          className="winbids-primary-action inline-flex h-8 items-center justify-center border-0 px-3 text-sm hover:bg-blue-800"
        >
          {t("common.register")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-black text-slate-700"
        title={user.displayName ?? user.email}
      >
        {initialsFor(user.displayName ?? user.email)}
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-8 border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 hover:text-slate-950"
        onClick={() => {
          void handleLogout();
        }}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t("common.logout")}</span>
      </Button>
    </div>
  );
}
