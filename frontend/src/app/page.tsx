"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  DatabaseZap,
  FileWarning,
  Gauge,
  Inbox,
  Search,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { fetchDashboardSummary } from "@/lib/api/dashboard";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { UserRole } from "@/server/auth/entitlements";
import type { DashboardNotificationTitleKey, DashboardSummary } from "@/server/dashboard/summary";

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

function PublicHome({ copy }: { copy: (typeof COPY)["en"] }) {
  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label="WinBids public overview">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">{copy.kicker}</p>
          <h1 className="winbids-title">{copy.publicTitle}</h1>
          <p className="winbids-lead mt-4">{copy.publicDescription}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" render={<Link href="/search" />}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {copy.publicSearchAction}
            </Button>
            <Button
              variant="outline"
              className="h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              render={<Link href="/register" />}
            >
              {copy.publicRegisterAction}
            </Button>
            <Button
              variant="outline"
              className="h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              render={<Link href="/login" />}
            >
              {copy.publicLoginAction}
            </Button>
          </div>
        </article>

        <div className="grid gap-3 sm:grid-cols-2" aria-label="Public product highlights">
          {copy.publicHighlights.map((highlight) => (
            <article key={highlight.label} className="winbids-metric-card">
              <CheckCircle2 size={18} className="text-blue-700" aria-hidden="true" />
              <strong className="mt-4 block text-base font-black text-slate-950">{highlight.label}</strong>
              <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{highlight.note}</p>
            </article>
          ))}
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
  const userId = auth.user?.id;
  const isAdminUser = auth.user ? adminConsoleRoles.includes(auth.user.role) : false;

  useEffect(() => {
    let cancelled = false;

    if (auth.isLoading || !userId) {
      return () => {
        cancelled = true;
      };
    }

    fetchDashboardSummary()
      .then((nextSummary) => {
        if (cancelled) return;
        setSummary(nextSummary);
        setSummaryError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSummary(null);
        setSummaryError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [auth.isLoading, userId]);

  if (auth.isLoading) return <DashboardLoading />;
  if (!auth.user) return <PublicHome copy={copy} />;

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

  return (
    <div className="winbids-workspace">
      <section className="winbids-hero-grid" aria-label="WinBids command overview">
        <article className="winbids-hero-panel">
          <p className="winbids-kicker">{copy.kicker}</p>
          <h1 className="winbids-title">{copy.title}</h1>
          <p className="winbids-lead mt-4">{copy.description}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="winbids-primary-action h-10 border-0 px-5 hover:bg-blue-800" render={<Link href="/search" />}>
              <Search className="h-4 w-4" aria-hidden="true" />
              {copy.searchAction}
            </Button>
            <Button
              variant="outline"
              className="h-10 border-slate-200 bg-white px-5 font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              render={<Link href="/intents" />}
            >
              <Activity className="h-4 w-4" aria-hidden="true" />
              {copy.intentAction}
            </Button>
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
              <Button
                variant="outline"
                className="mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                render={<Link href="/admin" />}
              >
                {copy.viewSources}
              </Button>
            </article>
          )}

          <article className="winbids-hero-panel">
            <p className="winbids-kicker">Access</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">
              {isAdminUser ? copy.adminOps : copy.accountTier}
            </h2>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{copy.tierDescription}</p>
            <Button
              variant="outline"
              className="mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
              render={<Link href="/settings" />}
            >
              {copy.tierAction}
            </Button>
          </article>
          {isAdminUser && (
            <article className="winbids-hero-panel">
              <ShieldCheck className="h-5 w-5 text-blue-700" aria-hidden="true" />
              <p className="winbids-kicker mt-4">{copy.userWorkspaceTitle}</p>
              <h2 className="mt-1 text-lg font-black text-slate-950">{copy.adminOps}</h2>
              <p className="mt-3 text-sm font-medium leading-6 text-slate-500">{copy.adminDescription}</p>
              <Button
                variant="outline"
                className="mt-5 h-10 w-full border-slate-200 bg-white font-black text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                render={<Link href="/admin" />}
              >
                {copy.adminAction}
              </Button>
            </article>
          )}
        </aside>
      </section>
    </div>
  );
}
