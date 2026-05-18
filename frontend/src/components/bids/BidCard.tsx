"use client";

import Link from "next/link";
import { Building2, Star, Clock, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSavedBids } from "@/context/SavedBidsContext";
import type { Bid } from "@/lib/mock-data";
import { useLanguage } from "@/lib/i18n/LanguageContext";

interface BidCardProps {
  bid: Bid;
}

export function BidCard({ bid }: BidCardProps) {
  const { isSaved, toggleSaveBid } = useSavedBids();
  const { t } = useLanguage();
  const saved = isSaved(bid.id);

  return (
    <Card className="relative h-full border-slate-200 shadow-sm transition-all duration-200 ease-out hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:border-slate-300 bg-white group">
      <Link href={`/bids/${bid.id}`} className="block h-full">
        <CardContent className="p-6 flex flex-col h-full">
          <div className="flex justify-between items-start mb-4">
            <div className="flex flex-col gap-2 pr-10">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-md font-medium border-slate-200 text-slate-600 bg-slate-50 px-2 py-0.5">
                  {bid.source}
                </Badge>
                <Badge variant="secondary" className="rounded-md bg-slate-100 text-slate-600 px-2 py-0.5">
                  {bid.issuerType === "federal" ? t("dashboard.federal") : t("dashboard.state")}
                </Badge>
                <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
                  <Building2 size={12} className="text-slate-400" />
                  {bid.issuerName}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-slate-900 leading-snug group-hover:text-slate-700 transition-colors mt-1">
                {bid.title}
              </h3>
            </div>
          </div>

          <p className="text-sm text-slate-600 line-clamp-2 mb-6 flex-1 leading-relaxed">
            {bid.description}
          </p>

          <div className="flex flex-wrap items-center justify-between gap-4 mt-auto pt-5 border-t border-slate-100">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Clock size={14} className="text-slate-400" />
                <span>{t("bid.deadline")}: {bid.deadlineDate}</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-500">
                <Calendar size={14} className="text-slate-400" />
                <span>{t("bid.posted")}: {bid.publishedDate}</span>
              </div>
            </div>
            {bid.amount && (
              <div className="font-semibold text-slate-900 flex items-center gap-1">
                {bid.amount}
              </div>
            )}
          </div>
        </CardContent>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
        aria-label={saved ? t("bid.saved") : t("bid.save")}
        onClick={() => toggleSaveBid(bid.id)}
      >
        <Star size={18} className={saved ? "fill-slate-900 text-slate-900" : ""} />
      </Button>
    </Card>
  );
}
