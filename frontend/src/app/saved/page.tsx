"use client";

import { BidCard } from "@/components/bids/BidCard";
import { AuthRequiredState } from "@/components/auth/AuthRequiredState";
import { useAuth } from "@/context/AuthContext";
import { useSavedBids } from "@/context/SavedBidsContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Bookmark, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

function SavedBidsContent() {
  const { savedBids, isLoading, error } = useSavedBids();
  const { t } = useLanguage();

  const savedDescription = savedBids.length === 1
    ? t("saved.descriptionSingular").replace("{count}", String(savedBids.length))
    : t("saved.description").replace("{count}", String(savedBids.length));

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-panel flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="winbids-sidebar-mark">
            <Bookmark size={22} strokeWidth={2.5} />
          </div>
          <div>
            <p className="winbids-kicker">Saved queue</p>
            <h1 className="winbids-title">{t("saved.title")}</h1>
            <p className="winbids-lead mt-2">
              {savedDescription}
            </p>
          </div>
        </div>
        <Link href="/search" className={buttonVariants({ className: "winbids-primary-action border-0 hover:bg-blue-800" })}>
          <Search className="mr-2 h-4 w-4" /> {t("saved.browseBids")}
        </Link>
      </section>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="winbids-panel">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3 flex-1">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                  <Skeleton className="h-8 w-8 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <div className="flex gap-2 pt-4 border-t border-slate-100">
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-5 w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : error && savedBids.length === 0 ? (
        <div className="winbids-panel text-center py-16 border-dashed border-slate-300">
          <p className="text-slate-900 font-semibold mb-2">{t("dashboard.errorTitle")}</p>
          <p className="text-sm text-slate-500">{t("dashboard.errorDescription")}</p>
        </div>
      ) : savedBids.length > 0 ? (
        <div className="flex flex-col gap-4 pb-8">
          {error && (
            <div className="winbids-panel text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{t("dashboard.errorTitle")}</span>
              <span className="ml-2">{t("dashboard.errorDescription")}</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {savedBids.map(bid => (
              <BidCard key={bid.id} bid={bid} />
            ))}
          </div>
        </div>
      ) : (
        <div className="winbids-panel flex flex-col items-center justify-center py-24 px-4 text-center border-dashed border-slate-300 mt-4">
          <div className="h-16 w-16 bg-white border border-slate-100 shadow-sm rounded-full flex items-center justify-center text-slate-400 mb-5">
            <Bookmark size={28} />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">{t("saved.emptyTitle")}</h2>
          <p className="text-slate-500 font-medium max-w-md mb-8">
            {t("saved.emptyDescription")}
          </p>
          <Link
            href="/search"
            className={buttonVariants({
              className: "bg-slate-900 hover:bg-slate-800 text-white font-medium shadow-sm rounded-lg px-6 h-11",
            })}
          >
            <Search className="mr-2 h-4 w-4" /> {t("saved.browseBids")}
          </Link>
        </div>
      )}
    </div>
  );
}

export default function SavedBidsPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="winbids-workspace">
        <section className="winbids-hero-panel min-h-64 animate-pulse" />
      </div>
    );
  }

  if (!user) return <AuthRequiredState />;

  return <SavedBidsContent />;
}
