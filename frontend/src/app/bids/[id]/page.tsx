"use client";

import { cloneElement, isValidElement, useEffect, useRef, useState, type ComponentProps, type ReactElement } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useSavedBids } from "@/context/SavedBidsContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { Button as BaseButton, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { UniversalState } from "@/components/universal-state";
import { ApiError, fetchBid } from "@/lib/api/bids";
import { createIntent } from "@/lib/api/intents";
import { fetchBidMatch } from "@/lib/api/match";
import { bidIdFromRouteParam } from "@/lib/bid-routes";
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
  LogIn,
  UserPlus,
} from "lucide-react";

const ADD_TO_INTENT_FALLBACK = "Add to Intent";

type ButtonProps = ComponentProps<typeof BaseButton> & {
  asChild?: boolean;
};

type DetailAttachment = Bid["attachments"][number] & {
  checksumSha256?: string;
  originalUrl?: string;
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

function attachmentIsArchivedOpenable(file: DetailAttachment) {
  return (
    file.archiveStatus === "archived" &&
    Boolean(file.storagePath?.trim()) &&
    Boolean(file.checksumSha256?.trim())
  );
}

function archiveTone(status: string | undefined, isArchivedOpenable = false) {
  if (isArchivedOpenable) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "archived") return "border-amber-200 bg-amber-50 text-amber-700";
  if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "unavailable") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function archiveLabelKey(file: DetailAttachment) {
  const status = file.archiveStatus;

  if (attachmentIsArchivedOpenable(file)) return "detail.archiveStatus_archivedOpenable";
  if (status === "archived") return "detail.archiveStatus_archived";
  if (status === "failed") return "detail.archiveStatus_failed";
  if (status === "unavailable") return "detail.archiveStatus_unavailable";
  return "detail.archiveStatus_sourceDownloadNote";
}

function attachmentStatusDescriptionKey(file: DetailAttachment) {
  if (attachmentIsArchivedOpenable(file)) return "detail.attachmentArchivedOpenableDescription";
  if (file.archiveStatus === "failed") return "detail.attachmentFailedDescription";
  if (file.archiveStatus === "archived") return "detail.attachmentArchivedStatusDescription";
  return "detail.attachmentSourceNoteDescription";
}

function attachmentActionLabelKey(file: DetailAttachment) {
  if (attachmentIsArchivedOpenable(file)) return "detail.openArchivedAttachment";
  if (file.archiveStatus === "failed") return "detail.openArchiveStatusNote";
  if (file.archiveStatus === "archived") return "detail.openAttachmentViaWinBids";
  return "detail.openSourceDownloadNote";
}

function fallbackLabel(label: string, key: string, fallback: string) {
  return label === key ? fallback : label;
}

function isUsageLimitError(error: Error | null) {
  return error instanceof ApiError && error.code === "USAGE_LIMIT_REACHED";
}

function isAuthRequiredError(error: Error | null) {
  return error instanceof ApiError && error.code === "AUTH_REQUIRED";
}

export default function BidDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, isLoading: isAuthLoading } = useAuth();
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
  const [saveAuthPromptVisible, setSaveAuthPromptVisible] = useState(false);
  
  // Handling the id parameter unwrapping per Next.js 15+ patterns if needed,
  // but for simple client components useParams() is fine.
  const rawBidId = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';
  const bidId = rawBidId ? bidIdFromRouteParam(rawBidId) : '';
  
  const saved = isSaved(bidId);
  const canCreateIntent = Boolean(user);
  const addToIntentLabel = fallbackLabel(t("detail.pursuitAddToIntent"), "detail.pursuitAddToIntent", ADD_TO_INTENT_FALLBACK);
  const pursuitMessage = pursuitError
    ? isAuthRequiredError(pursuitError)
      ? t("detail.pursuitAuthRequired")
      : isUsageLimitError(pursuitError)
      ? t("detail.intentLimitReached")
      : t("detail.pursuitError")
    : intent
      ? t("detail.intentCreated")
      : "";

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
    if (!bidId || isCreatingIntent || !canCreateIntent) return;

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

  const handleToggleSave = () => {
    if (isAuthLoading) return;

    if (!user) {
      setSaveAuthPromptVisible(true);
      return;
    }

    void toggleSaveBid(bidId);
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
      <div className="mx-auto flex min-h-[50vh] max-w-3xl items-center justify-center">
        <UniversalState
          actions={[{ label: t("detail.backToResults"), onClick: () => router.back(), variant: "secondary" }]}
          className="w-full bg-white"
          code="empty"
          message={t("detail.notFoundDescription")}
          title={t("detail.notFoundTitle")}
        />
      </div>
    );
  }

  if (!bid) {
    return (
      <div className="max-w-4xl mx-auto pt-4">
        <UniversalState
          actions={[{ label: t("detail.backToResults"), onClick: () => router.back(), variant: "secondary" }]}
          className="bg-white"
          code="error"
          message={t("dashboard.errorDescription")}
          title={t("dashboard.errorTitle")}
        />
      </div>
    );
  }

  return (
    <div className="winbids-detail-workspace">
      {/* Header Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={() => router.back()} className="-ml-2 w-full justify-start text-slate-500 hover:text-slate-900 font-medium sm:-ml-4 sm:w-auto">
          <ArrowLeft className="mr-2 h-4 w-4" /> {t("detail.backToResults")}
        </Button>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
          <Button
            variant="outline"
            onClick={handleToggleSave}
            disabled={isAuthLoading}
            className="w-full sm:w-auto justify-center whitespace-normal border-slate-200 text-slate-700 hover:bg-slate-50"
          >
            <Star className={`mr-2 h-4 w-4 ${saved ? 'fill-slate-900 text-slate-900' : 'text-slate-400'}`} />
            {saved ? t("bid.saved") : t("bid.save")}
          </Button>
          <Button asChild className="w-full sm:w-auto justify-center whitespace-normal bg-slate-900 text-white shadow-sm transition-all hover:bg-slate-800">
            <a href={bid.sourceUrl} target="_blank" rel="noreferrer" className="break-all">
              <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewSource")}
            </a>
          </Button>
        </div>
      </div>

      {saveAuthPromptVisible && !user ? (
        <UniversalState
          actions={[
            { href: "/login", label: t("detail.pursuitSignIn") },
            { href: "/register", label: t("detail.pursuitRegister"), variant: "secondary" },
            { label: t("common.dismiss"), onClick: () => setSaveAuthPromptVisible(false), variant: "secondary" },
          ]}
          className="border-blue-100 bg-blue-50/60"
          code="permission_denied"
          message={t("detail.saveAuthDescription")}
          severity="info"
          title={t("detail.saveAuthTitle")}
        />
      ) : null}

      {/* Title & Badge */}
      <section className="winbids-hero-panel flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="rounded-md font-medium border-slate-200 text-slate-600 bg-slate-50 px-2.5 py-1">
            {bid.source}
          </Badge>
          <span className="flex min-w-0 items-center gap-1.5 break-words text-sm font-medium uppercase text-slate-500">
            <Building2 size={14} className="text-slate-400" /> {bid.issuerName}
          </span>
        </div>
        <h1 className="winbids-title break-words">{bid.title}</h1>
      </section>

      {/* Metadata Grid (Receipt Style) */}
      <div className="winbids-panel grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Building2 size={14}/> {t("bid.issuerType")}
          </span>
          <span className="break-words font-medium text-slate-900 text-lg">{bid.issuerType === 'federal' ? t("dashboard.federal") : t("dashboard.state")}</span>
        </div>
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Calendar size={14}/> {t("dashboard.publishedDate")}
          </span>
          <span className="break-words font-medium text-slate-900 text-lg">{bid.publishedDate}</span>
        </div>
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <Clock size={14}/> {t("bid.deadline")}
          </span>
          <span className="break-words font-medium text-slate-900 text-lg">{bid.deadlineDate}</span>
        </div>
        <div className="min-w-0 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
            <FileText size={14}/> {t("detail.estimatedValue")}
          </span>
          <span className="break-words font-semibold text-slate-900 text-lg">{bid.amount || '—'}</span>
        </div>
      </div>

      {/* Pursuit Panel */}
      <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden bg-white">
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
                <div className={`rounded-lg border p-5 ${scoreTone(match.score)}`}>
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
                  {pursuitError && isUsageLimitError(pursuitError) ? (
                    <UniversalState
                      actions={[{ href: "/settings", label: t("settings.billing"), variant: "secondary" }]}
                      className="border-amber-200 bg-amber-50/60 p-3 shadow-none"
                      code="plan_limit"
                      message={t("settings.availablePlansDesc")}
                      title={t("detail.intentLimitReached")}
                    />
                  ) : (
                    <div className="min-h-5 text-sm font-medium text-slate-500">
                      {pursuitMessage}
                    </div>
                  )}
                  {intent ? (
                    <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                      <Link href={`/intents/${intent.id}`}>
                        <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.openIntent")}
                      </Link>
                    </Button>
                  ) : canCreateIntent ? (
                    <Button onClick={() => void handleCreateIntent()} disabled={isCreatingIntent || isAuthLoading} className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                      {isCreatingIntent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Target className="mr-2 h-4 w-4" />}
                      {isCreatingIntent ? t("detail.creatingIntent") : addToIntentLabel}
                    </Button>
                  ) : (
                    <div className="flex w-full flex-col gap-3 sm:w-auto sm:items-end">
                      <p className="text-sm font-medium text-slate-600">
                        {isAuthLoading ? t("detail.pursuitAuthLoading") : t("detail.pursuitAuthRequired")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild className="bg-slate-900 hover:bg-slate-800 text-white shadow-sm">
                          <Link href="/login">
                            <LogIn className="mr-2 h-4 w-4" /> {t("detail.pursuitSignIn")}
                          </Link>
                        </Button>
                        <Button asChild variant="outline" className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
                          <Link href="/register">
                            <UserPlus className="mr-2 h-4 w-4" /> {t("detail.pursuitRegister")}
                          </Link>
                        </Button>
                      </div>
                    </div>
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
      <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden">
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
      <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Building2 size={18} className="text-slate-400" /> {t("bid.contact")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="min-w-0 flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.contact")}</span>
              <span className="break-words font-medium text-slate-900">{bid.contactName}</span>
            </div>
            <div className="min-w-0 flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.email")}</span>
              <a href={`mailto:${bid.contactEmail}`} className="break-all font-medium text-slate-900 hover:text-slate-600">
                {bid.contactEmail}
              </a>
            </div>
            <div className="min-w-0 flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t("bid.phone")}</span>
              <a href={`tel:${bid.contactPhone}`} className="break-words font-medium text-slate-900 hover:text-slate-600">
                {bid.contactPhone}
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Attachments */}
      <Card className="winbids-panel border-slate-200 rounded-lg overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 pb-4 pt-6 px-6">
          <CardTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Paperclip size={18} className="text-slate-400" /> {t("detail.attachments")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 bg-slate-50/50">
          {bid.attachments && bid.attachments.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {bid.attachments.map((file, idx) => (
                <li key={idx} className="flex flex-col gap-3 p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 hover:shadow-sm transition-all group sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <div className="shrink-0 p-2.5 bg-slate-100 text-slate-600 rounded-md group-hover:bg-slate-900 group-hover:text-white transition-colors">
                      <FileText size={20} />
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span className="break-words font-medium text-sm text-slate-900">{file.name}</span>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-slate-500">{file.size}</span>
                        <Badge variant="outline" className={cn("h-5 rounded-md px-1.5 text-[11px]", archiveTone(file.archiveStatus, attachmentIsArchivedOpenable(file)))}>
                          {t(archiveLabelKey(file))}
                        </Badge>
                      </div>
                      <span className="mt-1 max-w-full break-words text-xs leading-5 text-slate-500">
                        {t(attachmentStatusDescriptionKey(file))}
                      </span>
                      {file.archiveError && (
                        <span className="mt-1 max-w-full break-words text-xs text-rose-700" title={file.archiveError}>
                          {t("detail.archiveError")}: {file.archiveError}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="w-full sm:w-auto justify-center whitespace-normal text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-medium">
                    <a href={file.url} target="_blank" rel="noreferrer" className="break-all">
                      <Download size={16} className="mr-2" /> {t(attachmentActionLabelKey(file))}
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
