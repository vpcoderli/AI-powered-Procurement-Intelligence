"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  DatabaseZap,
  FileWarning,
  Gauge,
  Inbox,
  Layers3,
  Map,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { fetchDashboardSummary } from "@/lib/api/dashboard";
import { fetchProcurementIntelligence } from "@/lib/api/intelligence";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  getMarketingHomepageContent,
  recordHomepageAnalyticsEvent,
  type HomepageAnalyticsEvent,
} from "@/lib/marketing/homepage-content";
import type { UserRole } from "@/server/auth/entitlements";
import type { DashboardNotificationTitleKey, DashboardSummary } from "@/server/dashboard/summary";
import type { ProcurementIntelligenceSummary } from "@/server/intelligence/types";

const adminConsoleRoles: readonly UserRole[] = ["admin", "operator", "support"];

const COPY = {
  en: {
    kicker: "American Public Supply Intelligence LLC",
    title: "Command Center",
    description:
      "A daily operating view for procurement teams: what changed, what needs action, and whether the intelligence layer is healthy.",
    searchAction: "Open bid search",
    intentAction: "Review pursuits",
    publicTitle: "Procurement intelligence for U.S. suppliers",
    publicDescription:
      "Search public opportunities, save the right bids, and unlock AI workspaces after creating an account.",
    publicSearchAction: "Browse public bids",
    publicRegisterAction: "Create account",
    publicLoginAction: "Sign in",
    publicHighlights: [
      { label: "50-state coverage", note: "Public-source monitoring across state and federal opportunity feeds" },
      { label: "AI pursuit workspaces", note: "Registered users can manage qualification, evidence, and response tasks" },
      { label: "Tiered access", note: "Advanced response, knowledge, and alert workflows follow your plan level" },
      { label: "Operator review", note: "Admin users get source health, QA, and crawler controls" },
    ],
    todayBrief: "Today Brief",
    notificationInbox: "Notification Inbox",
    pipelineHealth: "Pipeline Health",
    dataTrust: "Data Trust",
    intelligenceTitle: "Product 6 Procurement intelligence",
    intelligenceDescription:
      "Deterministic local cockpit summary for ordinary users. Real LLM, embeddings, and vector search are not used here.",
    intelligenceMode: "deterministic_local",
    intelligenceUnavailable: "Procurement intelligence is temporarily unavailable.",
    cockpitMetrics: [
      { label: "Active pursuits", valueKey: "activePursuits" },
      { label: "Needs action", valueKey: "needsAction" },
      { label: "Decision queue", valueKey: "decisionQueue" },
      { label: "Stale or at risk", valueKey: "staleOrAtRisk" },
      { label: "Average match", valueKey: "averageMatchScore" },
    ] satisfies Array<{ label: string; valueKey: keyof ProcurementIntelligenceSummary["cockpit"] }>,
    topSignals: "Top signals",
    noTopSignals: "No local pursuit signals yet.",
    limitations: "Limitations",
    accountTier: "Account & Tier",
    sourceHealth: "50-state source health",
    sourceHealthDescription: "Latest crawler checks are available for production readiness review.",
    viewSources: "View sources",
    notifications: [
      { level: "Critical", titleKey: "notification_delivery_failed", description: "notification deliveries failed and need operator review." },
      { level: "Warning", titleKey: "notification_delivery_pending", description: "notifications are waiting for delivery." },
      { level: "Warning", titleKey: "search_digest_failed", description: "saved search digests failed to generate or send." },
      { level: "Info", titleKey: "search_digest_matches", description: "matched bids were included in recent saved-search digests." },
      { level: "Critical", titleKey: "evidence_refresh_required", description: "Refresh source evidence before sharing packages." },
      { level: "Warning", titleKey: "deadlines_due_soon", description: "Review qualification status and response package readiness." },
      { level: "Info", titleKey: "new_matches_available", description: "Open search to review fresh matches." },
      { level: "Info", titleKey: "source_health_clear", description: "No command-center alerts need immediate action." },
    ] satisfies Array<{
      level: string;
      titleKey: DashboardNotificationTitleKey;
      description: string;
    }>,
    briefs: [
      { label: "New matches", note: "High-fit opportunities since last digest" },
      { label: "Due soon", note: "Deadlines inside the next 7 days" },
      { label: "Evidence risks", note: "Files or source links need review" },
      { label: "Ready packages", note: "Response workspaces ready for review" },
    ],
    pipeline: [
      { label: "Saved", pipelineHref: "/saved" },
      { label: "Intent", pipelineHref: "/intents" },
      { label: "Qualifying", pipelineHref: "/intents?pipeline=qualifying" },
      { label: "Ready", pipelineHref: "/intents?pipeline=ready" },
      { label: "Blocked", pipelineHref: "/intents?pipeline=blocked" },
      { label: "Open", pipelineHref: "/intents?pipeline=open" },
      { label: "Missing docs", pipelineHref: "/intents?pipeline=missing-artifacts" },
      { label: "Exported", pipelineHref: "/intents?pipeline=exported" },
    ],
    trust: [
      { label: "State coverage", fallbackStatus: "Tracked" },
      { label: "Empty runs", fallbackStatus: "Guarded" },
      { label: "404 evidence", fallbackStatus: "Blocked from publish" },
    ],
    summaryUnavailable: "Dashboard summary is temporarily unavailable.",
    tierDescription: "Current access should guide visible actions without turning the dashboard into an upgrade page.",
    tierAction: "Manage plan",
    adminOps: "Operator Console",
    adminDescription: "Review source health, crawler runs, data QA, users, and billing operations.",
    adminAction: "Open admin console",
    userWorkspaceTitle: "Supplier Workspace",
  },
  zh: {
    kicker: "American Public Supply Intelligence LLC",
    title: "Command Center",
    description: "面向采购团队的每日作战视图：发生了什么、今天该处理什么、数据情报层是否可信。",
    searchAction: "打开招标搜索",
    intentAction: "查看投标意向",
    publicTitle: "面向美国供应商的采购情报系统",
    publicDescription: "未登录用户可以浏览公开机会；注册后可解锁保存、投标意向、AI 工作台和付费功能。",
    publicSearchAction: "浏览公开招标",
    publicRegisterAction: "注册账号",
    publicLoginAction: "登录",
    publicHighlights: [
      { label: "50 州覆盖", note: "持续监控州级和联邦公开机会来源" },
      { label: "AI 投标工作台", note: "注册用户可管理资格判断、证据和响应任务" },
      { label: "等级权限", note: "高级响应包、知识库和提醒能力按套餐开放" },
      { label: "运营审核", note: "管理员可查看来源健康、爬虫、数据 QA 和用户管理" },
    ],
    todayBrief: "Today Brief",
    notificationInbox: "Notification Inbox",
    pipelineHealth: "Pipeline Health",
    dataTrust: "Data Trust",
    intelligenceTitle: "Product 6 Procurement intelligence",
    intelligenceDescription:
      "普通用户看到的是本地 deterministic cockpit 摘要；这里不使用真实 LLM、embedding 或向量检索。",
    intelligenceMode: "deterministic_local",
    intelligenceUnavailable: "采购情报摘要暂时不可用。",
    cockpitMetrics: [
      { label: "活跃追标", valueKey: "activePursuits" },
      { label: "待处理", valueKey: "needsAction" },
      { label: "决策队列", valueKey: "decisionQueue" },
      { label: "过期或风险", valueKey: "staleOrAtRisk" },
      { label: "平均匹配", valueKey: "averageMatchScore" },
    ] satisfies Array<{ label: string; valueKey: keyof ProcurementIntelligenceSummary["cockpit"] }>,
    topSignals: "Top signals",
    noTopSignals: "暂无本地追标信号。",
    limitations: "Limitations",
    accountTier: "账户与等级",
    sourceHealth: "50 州数据源健康度",
    sourceHealthDescription: "最新爬虫巡检结果可用于上线前可信度复核。",
    viewSources: "查看数据源",
    notifications: [
      { level: "紧急", titleKey: "notification_delivery_failed", description: "条通知投递失败，需要运维复核。" },
      { level: "警告", titleKey: "notification_delivery_pending", description: "条通知正在等待投递。" },
      { level: "警告", titleKey: "search_digest_failed", description: "个保存搜索摘要生成或投递失败。" },
      { level: "信息", titleKey: "search_digest_matches", description: "个匹配标案已进入最近的保存搜索摘要。" },
      { level: "紧急", titleKey: "evidence_refresh_required", description: "共享响应包前需要刷新来源证据。" },
      { level: "警告", titleKey: "deadlines_due_soon", description: "请检查资格判断和响应包准备状态。" },
      { level: "信息", titleKey: "new_matches_available", description: "打开搜索页查看新的匹配机会。" },
      { level: "信息", titleKey: "source_health_clear", description: "当前没有需要立即处理的控制台提醒。" },
    ] satisfies Array<{
      level: string;
      titleKey: DashboardNotificationTitleKey;
      description: string;
    }>,
    briefs: [
      { label: "新增匹配", note: "上次摘要后出现的高匹配机会" },
      { label: "临近截止", note: "未来 7 天内截止" },
      { label: "证据风险", note: "文件或来源链接需要复核" },
      { label: "可审响应包", note: "响应工作区已准备好复核" },
    ],
    pipeline: [
      { label: "已保存", pipelineHref: "/saved" },
      { label: "有意向", pipelineHref: "/intents" },
      { label: "资格判断", pipelineHref: "/intents?pipeline=qualifying" },
      { label: "可提交", pipelineHref: "/intents?pipeline=ready" },
      { label: "被阻塞", pipelineHref: "/intents?pipeline=blocked" },
      { label: "待处理", pipelineHref: "/intents?pipeline=open" },
      { label: "缺材料", pipelineHref: "/intents?pipeline=missing-artifacts" },
      { label: "已导出", pipelineHref: "/intents?pipeline=exported" },
    ],
    trust: [
      { label: "州覆盖", fallbackStatus: "已跟踪" },
      { label: "空抓取", fallbackStatus: "已拦截" },
      { label: "404 证据", fallbackStatus: "禁止发布" },
    ],
    summaryUnavailable: "控制台摘要暂时不可用。",
    tierDescription: "当前账户等级只提示可用动作，不把控制台做成营销升级页。",
    tierAction: "管理套餐",
    adminOps: "运营控制台",
    adminDescription: "复核来源健康、爬虫运行、数据 QA、用户和计费运营。",
    adminAction: "打开管理员后台",
    userWorkspaceTitle: "供应商工作区",
  },
};

const notificationIcons = [FileWarning, CalendarClock, Bell];
const briefIcons = [TrendingUp, CalendarClock, AlertTriangle, CheckCircle2];
const placeholderValue = "—";
const fallbackNotifications: DashboardSummary["notifications"] = [
  { id: "source-health-clear", level: "info", titleKey: "source_health_clear", count: 0 },
];

function notificationTitle(
  notification: DashboardSummary["notifications"][number],
  notificationCopy: (typeof COPY)["en"]["notifications"],
) {
  const base = notificationCopy.find((entry) => entry.titleKey === notification.titleKey) ?? notificationCopy[3];

  if (notification.titleKey === "source_health_clear") return base.description;

  return `${notification.count} ${base.description}`;
}

const lifecycleIcons = [Search, BookOpen, ShieldCheck, Layers3, ArrowRight, Sparkles];
const productIcons = [ShieldCheck, Search, CheckCircle2, Layers3, BookOpen];

function MarketingLink({
  href,
  children,
  className,
  eventName,
  eventNames,
  eventMetadata,
}: {
  href: string;
  children: React.ReactNode;
  className: string;
  eventName?: HomepageAnalyticsEvent;
  eventNames?: HomepageAnalyticsEvent[];
  eventMetadata?: Record<string, string>;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (eventName) recordHomepageAnalyticsEvent(eventName, eventMetadata);
        for (const nextEventName of eventNames ?? []) {
          recordHomepageAnalyticsEvent(nextEventName, eventMetadata);
        }
      }}
    >
      {children}
    </Link>
  );
}

function PublicHome({ language }: { language: "en" | "zh" }) {
  const content = getMarketingHomepageContent(language);
  const requestDemo = content.finalCta.secondaryCta;
  const sectionNav = content.nav.filter((item) => item.key !== "sign_in" && item.key !== "start_free");
  const signInNav = content.nav.find((item) => item.key === "sign_in");
  const startFreeNav = content.nav.find((item) => item.key === "start_free");

  useEffect(() => {
    recordHomepageAnalyticsEvent("view_homepage");
  }, []);

  return (
    <div className="winbids-workspace">
      <nav
        className="marketing-navigation winbids-hero-panel flex flex-wrap items-center justify-between gap-3 py-3"
        aria-label="Marketing navigation"
      >
        <div className="flex flex-wrap items-center gap-2">
          {sectionNav.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="Anonymous account actions">
          {signInNav && (
            <MarketingLink
              href="/login"
              className="inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              {signInNav.label}
            </MarketingLink>
          )}
          {startFreeNav && (
            <MarketingLink
              href="/register"
              eventNames={["click_start_free", "start_signup"]}
              className="winbids-primary-action min-h-9 border-0 px-3 text-sm hover:bg-blue-800"
            >
              {startFreeNav.label}
            </MarketingLink>
          )}
        </div>
      </nav>

      <section className="winbids-hero-grid" aria-label="WinBids public overview">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">{content.hero.eyebrow}</p>
          <h1 className="winbids-title">{content.hero.headline}</h1>
          <p className="winbids-lead mt-4">{content.hero.subheadline}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <MarketingLink
              href={content.hero.primaryCta.href}
              eventNames={["click_start_free", "start_signup"]}
              className={buttonVariants({ className: "winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" })}
            >
              {content.hero.primaryCta.label}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </MarketingLink>
            <MarketingLink
              href={content.hero.secondaryCta.href}
              eventName="click_see_how_it_works"
              className={buttonVariants({
                variant: "outline",
                className: "h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              {content.hero.secondaryCta.label}
            </MarketingLink>
            <MarketingLink
              href={content.hero.searchCta.href}
              eventName="click_public_search"
              className={buttonVariants({
                variant: "outline",
                className: "h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
              {content.hero.searchCta.label}
            </MarketingLink>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {content.hero.trustSignals.map((signal) => (
              <span key={signal} className="winbids-soft-pill">{signal}</span>
            ))}
          </div>
        </article>

        <div className="grid gap-3" aria-label="Public problem summary">
          {content.problem.map((item) => (
            <article key={item.key} className="winbids-metric-card">
              <AlertTriangle size={18} className="text-amber-600" aria-hidden="true" />
              <strong className="mt-4 block text-base font-black text-slate-950">{item.title}</strong>
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="winbids-hero-panel" aria-label="How WinBids works">
        <p className="winbids-kicker">{content.sections.howItWorks.eyebrow}</p>
        <h2 className="winbids-section-title mt-1">{content.sections.howItWorks.title}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {content.lifecycle.map((step, index) => {
            const Icon = lifecycleIcons[index];
            return (
              <article key={step.key} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <strong className="mt-4 block text-base font-black text-slate-950">{step.title}</strong>
                <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{step.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="product-map" className="winbids-hero-panel" aria-label="Product map">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="winbids-kicker">{content.sections.productMap.eyebrow}</p>
            <h2 className="winbids-section-title mt-1">{content.sections.productMap.title}</h2>
          </div>
          <Map className="h-6 w-6 text-blue-700" aria-hidden="true" />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {content.productMap.map((item, index) => {
            const Icon = productIcons[index];
            return (
              <article key={item.key} className="winbids-metric-card">
                <Icon className="h-5 w-5 text-blue-700" aria-hidden="true" />
                <strong className="mt-4 block text-base font-black text-slate-950">{item.title}</strong>
                <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{item.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="knowledge-station" className="winbids-hero-panel" aria-label="Knowledge Station">
        <p className="winbids-kicker">{content.sections.knowledgeStation.eyebrow}</p>
        <h2 className="winbids-section-title mt-1">{content.knowledgeStation.title}</h2>
        <p className="winbids-lead mt-4">{content.knowledgeStation.body}</p>
      </section>

      <section id="pricing" className="winbids-hero-panel" aria-label="Pricing preview">
        <p className="winbids-kicker">{content.sections.pricing.eyebrow}</p>
        <h2 className="winbids-section-title mt-1">{content.sections.pricing.title}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {content.pricingTiers.map((tier) => (
            <article key={tier.key} className="winbids-metric-card flex flex-col">
              <span className="winbids-soft-pill self-start">{tier.price}</span>
              <strong className="mt-4 block text-base font-black text-slate-950">{tier.title}</strong>
              <p className="mt-3 flex-1 text-xs font-semibold leading-5 text-slate-500">{tier.body}</p>
              <MarketingLink
                href={tier.cta.href}
                eventName="click_pricing_tier"
                eventMetadata={{ tier: tier.key }}
                className="mt-5 inline-flex min-h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {tier.cta.label}
              </MarketingLink>
            </article>
          ))}
        </div>
      </section>

      <section id="resources" className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="winbids-hero-panel" aria-label="Resources">
          <p className="winbids-kicker">{content.sections.resources.eyebrow}</p>
          <h2 className="winbids-section-title mt-1">{content.sections.resources.title}</h2>
          <div className="mt-5 grid gap-3">
            {content.resources.map((resource) => (
              <Link key={resource.key} href={resource.href ?? "/resources"} className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-200 hover:bg-white hover:shadow-sm">
                <strong className="block text-sm font-black text-slate-950">{resource.title}</strong>
                <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">{resource.body}</p>
              </Link>
            ))}
          </div>
        </article>

        <article className="winbids-hero-panel" aria-label="FAQ and safe claims">
          <p className="winbids-kicker">{content.sections.faq.eyebrow}</p>
          <h2 className="winbids-section-title mt-1">{content.sections.faq.title}</h2>
          <div className="safe-claims mt-5 grid gap-2">
            {content.safeClaims.map((claim) => (
              <div key={claim} className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{claim}</span>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3">
            {content.faq.map((item) => (
              <div key={item.question} className="rounded-lg border border-slate-200 bg-white p-4">
                <strong className="block text-sm font-black text-slate-950">{item.question}</strong>
                <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{item.answer}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="winbids-hero-panel" aria-label="Final call to action">
        <p className="winbids-kicker">{content.sections.finalCta.eyebrow}</p>
        <div className="mt-1 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="winbids-section-title">{content.finalCta.title}</h2>
            <p className="winbids-lead mt-4">{content.finalCta.body}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <MarketingLink
              href={content.finalCta.primaryCta.href}
              eventNames={["click_start_free", "start_signup"]}
              className={buttonVariants({ className: "winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" })}
            >
              {content.finalCta.primaryCta.label}
            </MarketingLink>
            <MarketingLink
              href={requestDemo.href}
              eventName="click_request_demo"
              className={buttonVariants({
                variant: "outline",
                className: "h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              {requestDemo.label}
            </MarketingLink>
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardLoading() {
  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label="Loading command center">
        <article className="winbids-hero-panel min-h-64 animate-pulse" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <article key={index} className="winbids-metric-card min-h-36 animate-pulse" />
          ))}
        </div>
      </section>
    </div>
  );
}

export default function CommandCenterDashboard() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const auth = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [intelligence, setIntelligence] = useState<ProcurementIntelligenceSummary | null>(null);
  const [intelligenceError, setIntelligenceError] = useState(false);
  const userId = auth.user?.id;
  const isAdminUser = auth.user ? adminConsoleRoles.includes(auth.user.role) : false;

  useEffect(() => {
    let cancelled = false;

    if (auth.isLoading || !userId) {
      return () => {
        cancelled = true;
      };
    }

    Promise.allSettled([
      fetchDashboardSummary(),
      fetchProcurementIntelligence(),
    ])
      .then(([summaryResult, intelligenceResult]) => {
        if (cancelled) return;

        if (summaryResult.status === "fulfilled") {
          setSummary(summaryResult.value);
          setSummaryError(false);
        } else {
          setSummary(null);
          setSummaryError(true);
        }

        if (intelligenceResult.status === "fulfilled") {
          setIntelligence(intelligenceResult.value);
          setIntelligenceError(false);
        } else {
          setIntelligence(null);
          setIntelligenceError(true);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(true);
        setIntelligence(null);
        setIntelligenceError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.isLoading, userId]);

  if (auth.isLoading) return <DashboardLoading />;
  if (!auth.user) return <PublicHome language={language} />;

  const briefValues = [
    summary?.briefs.newMatches.value,
    summary?.briefs.dueSoon.value,
    summary?.briefs.evidenceRisks.value,
    summary?.briefs.readyPackages.value,
  ];
  const pipelineValues = [
    summary?.pipeline.saved,
    summary?.pipeline.intent,
    summary?.pipeline.qualifying,
    summary?.pipeline.ready,
    summary?.pipeline.blocked,
    summary?.pipeline.open,
    summary?.pipeline.missingArtifacts,
    summary?.pipeline.exported,
  ];
  const trustValues = [
    {
      value: summary?.dataTrust.stateCoverage.value,
      status: summary?.dataTrust.stateCoverage.summary,
    },
    {
      value: summary?.dataTrust.emptyRuns.value,
      status: summary?.dataTrust.emptyRuns.summary,
    },
    {
      value: summary?.dataTrust.evidence404.value,
      status: summary?.dataTrust.evidence404.summary,
    },
  ];
  const notifications = summary?.notifications ?? [];
  const intelligenceCockpitValues = {
    activePursuits: intelligence?.cockpit.activePursuits,
    needsAction: intelligence?.cockpit.needsAction,
    decisionQueue: intelligence?.cockpit.decisionQueue,
    staleOrAtRisk: intelligence?.cockpit.staleOrAtRisk,
    averageMatchScore: intelligence?.cockpit.averageMatchScore,
  };

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label="WinBids command overview">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">{copy.kicker}</p>
          <h1 className="winbids-title">{copy.title}</h1>
          <p className="winbids-lead mt-4">{copy.description}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/search" className={buttonVariants({ className: "winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" })}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {copy.searchAction}
            </Link>
            <Link
              href="/intents"
              className={buttonVariants({
                variant: "outline",
                className: "h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              {copy.intentAction}
            </Link>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2" aria-label={copy.todayBrief}>
          {copy.briefs.map((brief, index) => {
            const Icon = briefIcons[index];
            return (
              <article key={brief.label} className="winbids-metric-card">
                <Icon size={18} className="text-blue-700" aria-hidden="true" />
                <strong className="mt-4 block text-3xl font-black text-slate-950">
                  {briefValues[index] ?? placeholderValue}
                </strong>
                <span className="mt-1 block text-xs font-black uppercase text-slate-500">{brief.label}</span>
                <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{brief.note}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="flex flex-col gap-5">
          <section className="winbids-hero-panel" aria-label={copy.notificationInbox}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="winbids-kicker">{copy.todayBrief}</p>
                <h2 className="winbids-section-title mt-1">{copy.notificationInbox}</h2>
              </div>
              <Inbox className="h-5 w-5 text-blue-700" aria-hidden="true" />
            </div>
            {summaryError && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                {copy.summaryUnavailable}
              </p>
            )}
            <div className="mt-5 grid gap-3">
              {(notifications.length > 0 ? notifications : fallbackNotifications).map((notification, index) => {
                const text = copy.notifications.find((entry) => entry.titleKey === notification.titleKey) ?? copy.notifications[3];
                const Icon = notificationIcons[index % notificationIcons.length];
                return (
                  <article key={notification.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div>
                        <span className="winbids-soft-pill">{text.level}</span>
                        <h3 className="mt-2 text-sm font-black text-slate-950">{notificationTitle(notification, copy.notifications)}</h3>
                        <p className="mt-1 text-sm font-medium leading-6 text-slate-500">{text.description}</p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="winbids-hero-panel" aria-label={copy.intelligenceTitle}>
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="winbids-kicker">Product 6</p>
                <h2 className="winbids-section-title mt-1">{copy.intelligenceTitle}</h2>
                <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-slate-500">
                  {copy.intelligenceDescription}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="winbids-soft-pill">{intelligence?.mode ?? copy.intelligenceMode}</span>
                <span className="winbids-soft-pill">llm: {intelligence?.sourcePolicy.llm ?? "not_used"}</span>
              </div>
            </div>
            {intelligenceError && (
              <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                {copy.intelligenceUnavailable}
              </p>
            )}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {copy.cockpitMetrics.map((metric) => (
                <article key={metric.valueKey} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <strong className="block text-2xl font-black text-slate-950">
                    {intelligenceCockpitValues[metric.valueKey] ?? placeholderValue}
                    {metric.valueKey === "averageMatchScore" && intelligenceCockpitValues[metric.valueKey] !== undefined ? "%" : ""}
                  </strong>
                  <span className="mt-1 block text-xs font-black uppercase text-slate-500">{metric.label}</span>
                </article>
              ))}
            </div>
            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.42fr)]">
              <div>
                <h3 className="text-sm font-black uppercase text-slate-500">{copy.topSignals}</h3>
                <div className="mt-3 grid gap-3">
                  {(intelligence?.topSignals.length ?? 0) > 0 ? (
                    intelligence?.topSignals.map((signal) => (
                      <Link
                        key={signal.intentId}
                        href={`/intents/${signal.intentId}`}
                        className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="winbids-soft-pill">{signal.severity}</span>
                          <span className="winbids-soft-pill">{signal.signalType}</span>
                          <span className="text-xs font-black uppercase text-slate-500">{signal.matchScore}% match</span>
                        </div>
                        <strong className="mt-3 block text-sm font-black text-slate-950">{signal.title}</strong>
                        <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{signal.reason}</p>
                      </Link>
                    ))
                  ) : (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                      {copy.noTopSignals}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-slate-500">{copy.limitations}</h3>
                <div className="mt-3 grid gap-2">
                  {(intelligence?.limitations ?? [
                    "Local deterministic read model only; no live LLM, embeddings, vector database, or external enrichment.",
                  ]).map((limitation) => (
                    <p key={limitation} className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs font-bold leading-5 text-blue-900">
                      {limitation}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <article className="winbids-hero-panel" aria-label={copy.pipelineHealth}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="winbids-kicker">Pipeline</p>
                  <h2 className="winbids-section-title mt-1">{copy.pipelineHealth}</h2>
                </div>
                <Gauge className="h-5 w-5 text-blue-700" aria-hidden="true" />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                {copy.pipeline.map((item, index) => (
                  <Link
                    key={item.label}
                    href={item.pipelineHref}
                    className="rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-blue-200 hover:bg-white hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                  >
                    <strong className="block text-2xl font-black text-slate-950">
                      {pipelineValues[index] ?? placeholderValue}
                    </strong>
                    <span className="mt-1 block text-xs font-black uppercase text-slate-500">{item.label}</span>
                  </Link>
                ))}
              </div>
            </article>

            <article className="winbids-hero-panel" aria-label={copy.dataTrust}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="winbids-kicker">Governance</p>
                  <h2 className="winbids-section-title mt-1">{copy.dataTrust}</h2>
                </div>
                <ShieldCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
              </div>
              <div className="mt-5 grid gap-3">
                {copy.trust.map((item, index) => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                    <div>
                      <strong className="block text-sm font-black text-slate-950">{item.label}</strong>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">
                        {trustValues[index].status ?? item.fallbackStatus}
                      </span>
                    </div>
                    <span className="text-lg font-black text-slate-950">
                      {trustValues[index].value ?? placeholderValue}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </main>

        <aside className="flex flex-col gap-5">
          {isAdminUser && (
            <article className="winbids-hero-panel">
              <DatabaseZap className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <p className="winbids-kicker mt-4">{copy.dataTrust}</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">{copy.sourceHealth}</h2>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{copy.sourceHealthDescription}</p>
              <Link
                href="/admin"
                className={buttonVariants({
                  variant: "outline",
                  className: "mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                })}
              >
                {copy.viewSources}
              </Link>
            </article>
          )}

          <article className="winbids-hero-panel">
            <p className="winbids-kicker">Access</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {isAdminUser ? copy.adminOps : copy.accountTier}
            </h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{copy.tierDescription}</p>
            <Link
              href="/settings"
              className={buttonVariants({
                variant: "outline",
                className: "mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
              })}
            >
              {copy.tierAction}
            </Link>
          </article>
          {isAdminUser && (
            <article className="winbids-hero-panel">
              <ShieldCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <p className="winbids-kicker mt-4">{copy.userWorkspaceTitle}</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">{copy.adminOps}</h2>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{copy.adminDescription}</p>
              <Link
                href="/admin"
                className={buttonVariants({
                  variant: "outline",
                  className: "mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                })}
              >
                {copy.adminAction}
              </Link>
            </article>
          )}
        </aside>
      </section>
    </div>
  );
}
