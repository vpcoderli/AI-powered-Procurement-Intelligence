"use client";

import { ExternalLink, Lock } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import type { BidDetailAccess } from "@/lib/bid-access";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { cn } from "@/lib/utils";

/** Says which detail fields the platform keeps for its members, instead of rendering blanks. */
export function BidAccessNotice({ access, sourceUrl }: { access: BidDetailAccess; sourceUrl: string }) {
  const { t } = useLanguage();
  const fields = access.restricted.map((field) => t(`detail.restrictedField_${field}`)).join(t("detail.restrictedFieldSeparator"));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2 break-words">
        <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t("detail.restrictedAccessBody").replace("{fields}", fields).replace("{platform}", access.platform)}</span>
      </p>
      {sourceUrl ? (
        <a
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full break-all sm:w-auto")}
        >
          <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewOnPlatform").replace("{platform}", access.platform)}
        </a>
      ) : null}
    </div>
  );
}
