"use client";

import { cloneElement, isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSavedBids } from "@/context/SavedBidsContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button as BaseButton, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, fetchBid } from "@/lib/api/bids";
import { createIntent } from "@/lib/api/intents";
import { fetchBidMatch } from "@/lib/api/match";
import type { Bid } from "@/lib/mock-data";
import type { IntentDetail } from "@/server/intents/types";
import type { BidMatchResult } from "@/server/match/types";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Star,
  ExternalLink,
  Building2,
  Calendar,
  Clock,
  FileText,
  Paperclip,
  Download,
  Target,
  ShieldAlert,
  CheckCircle2,
  Loader2,
  Sparkles,
} from "lucide-react";

const ADD_TO_INTENT_FALLBACK = "Add to Intent";

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

function scoreTone(score: number) {
  if (score >= 75) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (score >= 50) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-slate-600 bg-slate-50 border-slate-200";
}

function fallbackLabel(label: string, key: string, fallback: string) {
  return label === key ? fallback : label;
}

export default function BidDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { isSaved, toggleSaveBid } = useSavedBids();
  const { t } = useLanguage();
  const mountedRef = useRef(true);
  const createIntentRequestRef = useRef(0);
  const [bid, setBid] = useState<Bid | null>(null);
  const [match, setMatch] = useState<BidMatchResult | null>(null);
  const [intent, setIntent] = useState<IntentDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMatchLoading, setIsMatchLoading] = useState(false);
  const [isCreatingIntent, setIsCreatingIntent] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pursuitError, setPursuitError] = useState<Error | null>(null);
  
  // Handling the id parameter unwrapping per Next.js 15+ patterns if needed,
  // but for simple client components useParams() is fine.
  const bidId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  
  const saved = isSaved(bidId);
  const addToIntentLabel = fallbackLabel(t("detail.pursuitAddToIntent"), "detail.pursuitAddToIntent", ADD_TO_INTENT_FALLBACK);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    queueMicrotask(async () => {
      if (cancelled) return;

      setBid(null);
      setMatch(null);
      setIntent(null);
      setError(null);
      setPursuitError(null);
      setIsLoading(true);
      setIsMatchLoading(false);
      setIsCreatingIntent(false);
      createIntentRequestRef.current += 1;

      if (!bidId) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await fetchBid(bidId);
        if (cancelled || !mountedRef.current) return;

        setBid(response.bid);
        setIsLoading(false);
        setIsMatchLoading(true);

        try {
          const matchResponse = await fetchBidMatch(bidId);
          if (cancelled || !mountedRef.current) return;

          setMatch(matchResponse.match);
        } catch (err) {
          if (cancelled || !mountedRef.current) return;
          setPursuitError(err instanceof Error ? err : new Error("Failed to load pursuit match"));
        } finally {
          if (cancelled || !mountedRef.current) return;
          setIsMatchLoading(false);
        }
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        setError(err instanceof Error ? err : new Error("Failed to load bid"));
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [bidId]);

  const handleCreateIntent = async () => {
    if (!bidId || isCreatingIntent) return;

    const requestedBidId = bidId;
    const requestId = createIntentRequestRef.current + 1;
    createIntentRequestRef.current = requestId;

    setIsCreatingIntent(true);
    setPursuitError(null);

    try {
      const response = await createIntent(requestedBidId);
      if (
        !mountedRef.current ||
        createIntentRequestRef.current !== requestId ||
        requestedBidId !== bidId
      ) {
        return;
      }

      setIntent(response.intent);
      setMatch(response.intent.match);
    } catch (err) {
      if (
        !mountedRef.current ||
        createIntentRequestRef.current !== requestId ||
        requestedBidId !== bidId
      ) {
        return;
      }

      setPursuitError(err instanceof Error ? err : new Error("Failed to create intent"));
    } finally {
      if (
        mountedRef.current &&
        createIntentRequestRef.current === requestId &&
        requestedBidId === bidId
      ) {
        setIsCreatingIntent(false);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-16 pt-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-36" />
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-5 w-48" />
          </div>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-3/4" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-28" />
            </div>
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
            <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent className="p-6 bg-slate-50/50 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!bid && error instanceof ApiError && error.code === "BID_NOT_FOUND") {
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

  if (!bid) {
    return (
      <div className="max-w-4xl mx-auto pt-4">
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-slate-900 font-semibold mb-2">{t("dashboard.errorTitle")}</p>
          <p className="text-sm text-slate-500 mb-4">{t("dashboard.errorDescription")}</p>
          <Button onClick={() => router.back()} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t("detail.backToResults")}
          </Button>
        </div>
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

      {/* Pursuit Panel */}
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden bg-white">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Target size={18} className="shrink-0 text-slate-400" /> {t("detail.pursuitTitle")}
              </CardTitle>
              <p className="mt-1 text-sm text-slate-500 break-words">{t("detail.pursuitDescription")}</p>
            </div>
            {match ? (
              <Badge variant="outline" className={`w-fit rounded-md ${scoreTone(match.score)}`}>
                {t(`intentsPage.confidence.${match.confidence}`)}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          {isMatchLoading ? (
            <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
              <Skeleton className="h-32 rounded-xl" />
              <div className="space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </div>
            </div>
          ) : match ? (
            <div className="grid gap-5 lg:grid-cols-[0.55fr_1.45fr]">
              <div className={`rounded-xl border p-5 ${scoreTone(match.score)}`}>
                <p className="text-xs font-semibold uppercase">{t("detail.pursuitScore")}</p>
                <p className="mt-2 text-5xl font-bold tracking-tight">{match.score}%</p>
                <p className="mt-2 text-sm font-semibold">{t(`intentsPage.confidence.${match.confidence}`)}</p>
              </div>
              <div className="min-w-0 space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("detail.pursuitExplanation")}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700 break-words">{match.explanation}</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("detail.pursuitRiskNotes")}</p>
                    {match.riskNotes.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {match.riskNotes.map((note) => (
                          <li key={note} className="flex gap-2 text-sm leading-6 text-slate-700">
                            <ShieldAlert size={16} className="mt-1 shrink-0 text-amber-600" />
                            <span className="break-words">{note}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">{t("detail.pursuitNoRiskNotes")}</p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("detail.pursuitMissingProfile")}</p>
                    {match.missingProfileHints.length > 0 ? (
                      <ul className="mt-2 space-y-2">
                        {match.missingProfileHints.map((hint) => (
                          <li key={hint} className="text-sm leading-6 text-slate-700 break-words">
                            {hint}{" "}
                            <Link href="/profile" className="font-semibold text-slate-900 underline underline-offset-4 hover:text-slate-600">
                              {t("detail.pursuitUpdateProfile")}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">{t("detail.pursuitProfileComplete")}</p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-h-5 text-sm font-medium text-slate-500">
                    {pursuitError ? t("detail.pursuitError") : intent ? t("detail.intentCreated") : ""}
                  </div>
                  {intent ? (
                    <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                      <Link href={`/intents/${intent.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.openIntent")}
                      </Link>
                    </Button>
                  ) : (
                    <Button onClick={() => void handleCreateIntent()} disabled={isCreatingIntent} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                      {isCreatingIntent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
                      {isCreatingIntent ? t("detail.creatingIntent") : addToIntentLabel}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              {pursuitError ? t("detail.pursuitError") : t("detail.pursuitUnavailable")}
            </div>
          )}

          {intent ? (
            <div className="mt-6 grid gap-5 border-t border-slate-200 pt-6 lg:grid-cols-[1.2fr_0.8fr]">
              <section className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
                  <Sparkles size={16} className="text-slate-400" /> {t("intentsPage.brief")}
                </h3>
                <p className="mt-3 max-h-72 overflow-auto pr-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 break-words">
                  {intent.generated.aiBidBrief}
                </p>
              </section>
              <div className="grid gap-5">
                <section className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
                    <CheckCircle2 size={16} className="text-slate-400" /> {t("intentsPage.checklist")}
                  </h3>
                  <ul className="mt-3 max-h-72 overflow-auto pr-2 space-y-2">
                    {intent.generated.initialChecklist.map((item) => (
                      <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                        <CheckCircle2 size={15} className="mt-1 shrink-0 text-emerald-600" />
                        <span className="break-words">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
                <section className="min-w-0 border-t border-slate-200 pt-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
                    <ShieldAlert size={16} className="text-slate-400" /> {t("intentsPage.riskFlags")}
                  </h3>
                  {intent.generated.riskFlags.length > 0 ? (
                    <ul className="mt-3 max-h-72 overflow-auto pr-2 space-y-2">
                      {intent.generated.riskFlags.map((item) => (
                        <li key={item} className="flex gap-2 text-sm leading-6 text-slate-700">
                          <ShieldAlert size={15} className="mt-1 shrink-0 text-amber-600" />
                          <span className="break-words">{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">{t("detail.noGeneratedRiskFlags")}</p>
                  )}
                </section>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

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
