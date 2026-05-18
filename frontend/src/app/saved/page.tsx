"use client";

import { BidCard } from "@/components/bids/BidCard";
import { useSavedBids } from "@/context/SavedBidsContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Bookmark, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";

export default function SavedBidsPage() {
  const { savedBids, isLoading, error } = useSavedBids();
  const { t } = useLanguage();

  const savedDescription = savedBids.length === 1
    ? t("saved.descriptionSingular").replace("{count}", String(savedBids.length))
    : t("saved.description").replace("{count}", String(savedBids.length));

  return (
    <div className="flex flex-col h-full gap-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center gap-3 pb-4 border-b border-slate-200">
        <div className="p-2.5 bg-slate-100 text-slate-700 rounded-lg border border-slate-200 shadow-sm">
          <Bookmark size={22} strokeWidth={2.5} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t("saved.title")}</h1>
          <p className="text-sm text-slate-500 font-medium mt-0.5">
            {savedDescription}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-8">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
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
        <div className="text-center py-16 border border-dashed border-slate-300 bg-white rounded-xl">
          <p className="text-slate-900 font-semibold mb-2">{t("dashboard.errorTitle")}</p>
          <p className="text-sm text-slate-500">{t("dashboard.errorDescription")}</p>
        </div>
      ) : savedBids.length > 0 ? (
        <div className="flex flex-col gap-4 pb-8">
          {error && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
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
        <div className="flex flex-col items-center justify-center py-24 px-4 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50/50 mt-4">
          <div className="h-16 w-16 bg-white border border-slate-100 shadow-sm rounded-full flex items-center justify-center text-slate-400 mb-5">
            <Bookmark size={28} />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">{t("saved.emptyTitle")}</h2>
          <p className="text-slate-500 font-medium max-w-md mb-8">
            {t("saved.emptyDescription")}
          </p>
          <Link
            href="/"
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
