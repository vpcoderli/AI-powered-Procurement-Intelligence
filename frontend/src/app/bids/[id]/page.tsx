"use client";

import { cloneElement, isValidElement, type ComponentProps, type ReactElement } from "react";
import { useParams, useRouter } from "next/navigation";
import { MOCK_BIDS } from "@/lib/mock-data";
import { useSavedBids } from "@/context/SavedBidsContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button as BaseButton, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowLeft, Star, ExternalLink, Building2, Calendar, Clock, FileText, Paperclip, Download } from "lucide-react";

type ButtonProps = ComponentProps<typeof BaseButton> & {
  asChild?: boolean;
};

function Button({ asChild, children, className, variant, size, ...props }: ButtonProps) {
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;

    return cloneElement(child, {
      ...props,
      className: cn(buttonVariants({ variant, size, className }), child.props.className),
    });
  }

  return (
    <BaseButton className={className} variant={variant} size={size} {...props}>
      {children}
    </BaseButton>
  );
}

export default function BidDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { isSaved, toggleSaveBid } = useSavedBids();
  const { t } = useLanguage();
  
  // Handling the id parameter unwrapping per Next.js 15+ patterns if needed,
  // but for simple client components useParams() is fine.
  const bidId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  
  const bid = MOCK_BIDS.find(b => b.id === bidId);
  const saved = isSaved(bidId);

  if (!bid) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
        <h2 className="text-xl font-semibold text-gray-700">{t("detail.notFoundTitle")}</h2>
        <p className="text-sm text-gray-500">{t("detail.notFoundDescription")}</p>
        <Button onClick={() => router.back()} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("detail.backToResults")}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-16 pt-4">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="-ml-4 text-slate-500 hover:text-slate-900 font-medium">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("detail.backToResults")}
        </Button>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => toggleSaveBid(bidId)} className="border-slate-200 hover:bg-slate-50 text-slate-700">
            <Star className={`mr-2 h-4 w-4 ${saved ? 'fill-slate-900 text-slate-900' : 'text-slate-400'}`} />
            {saved ? t("bid.saved") : t("bid.save")}
          </Button>
          <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm transition-all">
            <a href={bid.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewSource")}
            </a>
          </Button>
        </div>
      </div>

      {/* Title & Badge */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="rounded-md font-medium border-slate-200 text-slate-600 bg-slate-50 px-2.5 py-1">
            {bid.source}
          </Badge>
          <span className="text-sm font-medium text-slate-500 flex items-center gap-1.5 uppercase tracking-wider">
            <Building2 size={14} className="text-slate-400" /> {bid.issuerName}
          </span>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-slate-900 leading-tight tracking-tight">{bid.title}</h1>
      </div>

      {/* Metadata Grid (Receipt Style) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Building2 size={14}/> {t("bid.issuerType")}
          </span>
          <span className="font-medium text-slate-900 text-lg">{bid.issuerType === 'federal' ? t("dashboard.federal") : t("dashboard.state")}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar size={14}/> {t("dashboard.publishedDate")}
          </span>
          <span className="font-medium text-slate-900 text-lg">{bid.publishedDate}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Clock size={14}/> {t("bid.deadline")}
          </span>
          <span className="font-medium text-slate-900 text-lg">{bid.deadlineDate}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <FileText size={14}/> {t("detail.estimatedValue")}
          </span>
          <span className="font-semibold text-slate-900 text-lg">{bid.amount || '—'}</span>
        </div>
      </div>

      {/* Description */}
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900">{t("detail.detailedDescription")}</CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed">
            {bid.fullDescription || bid.description}
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Building2 size={18} className="text-slate-400" /> {t("bid.contact")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.contact")}</span>
              <span className="font-medium text-slate-900">{bid.contactName}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.email")}</span>
              <a href={`mailto:${bid.contactEmail}`} className="font-medium text-slate-900 hover:text-slate-600">
                {bid.contactEmail}
              </a>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.phone")}</span>
              <a href={`tel:${bid.contactPhone}`} className="font-medium text-slate-900 hover:text-slate-600">
                {bid.contactPhone}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Paperclip size={18} className="text-slate-400" /> {t("detail.attachments")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          {bid.attachments && bid.attachments.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {bid.attachments.map((file, idx) => (
                <li key={idx} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:shadow-sm transition-all group">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-100 text-slate-600 rounded-md group-hover:bg-slate-900 group-hover:text-white transition-colors">
                      <FileText size={20} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-medium text-sm text-slate-900">{file.name}</span>
                      <span className="text-xs font-medium text-slate-500 mt-0.5">{file.size}</span>
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium">
                    <a href={file.url} target="_blank" rel="noreferrer">
                      <Download size={16} className="mr-2" /> {t("detail.download")}
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-slate-500 font-medium italic p-6 bg-white rounded-lg border border-dashed border-slate-300 text-center">
              {t("detail.noAttachments")}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
