# Admin Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4,403-line single-page `/admin` with a left-navigation admin console: an accurate overview for all 1,020 sources, a server-paginated source list with facets, a source detail page, and one sub-page per existing section.

**Architecture:** Nested App Router routes under `frontend/src/app/admin/` share a Server Component `layout.tsx` that renders a client `AdminShell` (auth/role gate, breadcrumb, page title, role context). The global `AppSidebar` switches to an admin navigation tree under `/admin/**`, driven by one navigation config (`admin-nav.ts`) that also drives breadcrumbs and page guards. Each page is a thin client page that loads only its own data. New read APIs (overview, paginated list, index, detail, filtered logs) build one dialect-neutral SQL text and run it through a tiny runner on either SQLite (`db.$client`) or MySQL (`mysqlSelectMany`), so both runtimes share the exact predicates. The old page shrinks task by task and is finally replaced by the overview.

**Tech Stack:** Next.js 16.2.6 (App Router, React 19.2), TypeScript, Tailwind v4, shadcn/ui on Base UI (`@base-ui/react`), lucide-react, Drizzle ORM (SQLite) + mysql2 (MySQL), Vitest 4 (node environment, no DOM).

**Spec:** `docs/superpowers/specs/2026-09-29-admin-console-redesign-design.md` (approved by the user 2026-09-29).

## Global Constraints

Every task's requirements implicitly include this section.

- **Branch.** Work on `feat/admin-console-redesign`, created from `main` after `feat/county-phase3-governance` has merged (spec §14). Never commit to `main`.
- **Menu, routes, roles (spec §3.1, verbatim).**

  | Group | Item | Route | Visible to |
  | --- | --- | --- | --- |
  | 概览 Overview | — | `/admin` | admin, operator, support |
  | 数据源 Data sources | 源列表 Source list | `/admin/sources` | admin, operator, support |
  | 数据源 | 源详情 Source detail (not in the menu, reached from the list) | `/admin/sources/[id]` | admin, operator, support |
  | 数据源 | 接入审批 Onboarding approval | `/admin/sources/onboarding` | admin, operator, support |
  | 数据源 | 抓取运行 Crawl runs | `/admin/sources/runs` | admin, operator |
  | 数据质量 Data quality | 州门户质量 State portal quality | `/admin/quality` | admin, operator, support |
  | 数据质量 | 招标质检 Bid QA | `/admin/quality/bids` | admin, operator |
  | 用户权限 Users & access | 用户 Users | `/admin/users` | admin |
  | 用户权限 | 审计日志 Audit log | `/admin/users/audit` | admin |
  | 运营系统 Operations | 通知投递 Notification delivery | `/admin/notifications` | admin, operator |
  | 运营系统 | 增长漏斗 Growth funnel | `/admin/growth` | admin, operator, support |
  | 运营系统 | 配置 Configuration | `/admin/config` | admin |

  A role never sees a menu item it cannot open; the page itself is still guarded (direct URL → "not available for your role"), and every server route keeps its own role rule. Roles come from `ADMIN_CONSOLE_ROLES` (`@/server/auth/entitlements`).
- **One left navigation (spec §3.2).** `AppSidebar` shows the admin tree when the path is `/admin` or starts with `/admin/`: a "back to app" item on top, then the groups above filtered by role, current page highlighted, its group expanded. Elsewhere the sidebar is unchanged except that an admin-console user gets exactly one admin entry (`/admin`); the anchor entries `/admin#data-sources` and `/admin#configuration` are gone.
- **Levels (spec §4.2).** A source's level is `COALESCE(jurisdiction_level, issuer_type)`; a value outside `federal | state | county | city | township | special_district` counts as `unknown`. "Local" means any level other than federal/state (the orchestrator gate's rule, `issuer_type` as the fallback).
- **Overview definitions (spec §4.2).** scheduled = the scheduler's gate predicate (`listCrawlableSources`); awaitingApproval = local and `approval_status` NULL or `needs_review`; neverRun = `last_success_at` and `last_failure_at` both NULL; approved/blocked = `approval_status = 'approved' / 'blocked'`; crawl runs exclude `crawler_logs.source = 'attachment_repair'`; failing sources = enabled and `consecutive_failures > 0` (top 5 listed); platform pauses are worker-memory only and are not shown (the page says so).
- **List health (spec §5.1).** Priority `disabled` (not enabled) > `failing` (`consecutive_failures > 0`) > `healthy` (`last_success_at` set) > `never_run`.
- **List API (spec §5.1).** `GET /api/admin/data-sources` params `level`, `state`, `platform`, `approval` (`approved | awaiting | blocked`), `health` (`never_run | healthy | failing | disabled`) — each repeatable; `q` (id, label, jurisdiction name, case-insensitive contains); `sort` = `label | lastRun | failures | updated` with `-` prefix for descending (default `label`); `page` / `pageSize` default 1 / 50, `pageSize` ≤ 200. Response `{ items, total, page, pageSize, facets }`; each facet counts with every other dimension's filter applied and not its own. Invalid parameters (unknown value, page out of range, pageSize over the cap) → 400 `INVALID_REQUEST`. The old `{ summary, sources }` response is removed.
- **Both dialects, every time.** Every new read has a SQLite entry point and a MySQL entry point named `foo` / `fooFromMysql`. Routes pick one with the existing pattern (`resolveDatabase` + `shouldUseMysqlRuntime` + `mysql ?? resolveMysqlPool()`, copied from `frontend/src/app/api/admin/data-sources/route.ts`).
- **Admin routes.** Every new or changed `frontend/src/app/api/admin/**/route.ts` imports `@/server/admin/auth`, calls `requireAdminAccess(db, request, { roles: [...] })` with a LITERAL roles array, never `resolvePrincipal`; errors are `{ error: { code, message } }` with SCREAMING_SNAKE codes; every new route file is added to exactly one array in `frontend/src/server/auth/role-route-coverage.test.ts` and satisfies `frontend/src/server/db/mysql-route-coverage.test.ts`. Console-read roles are `["admin", "operator", "support"]` in that order.
- **Governance boundary (spec §9, §13).** No change to phase-3 governance rules, approval writes, the precheck queue, or the crawler gate. The new pages reuse the phase-3 panels and APIs unchanged.
- **No new libraries (spec §13).** No UI library, admin framework, chart library or global state library; bars are CSS; no polling or auto-refresh; no mobile-specific redesign (the existing sidebar collapse is kept).
- **i18n (spec §11).** Every new user-visible string goes through `t()` with keys in BOTH `frontend/src/lib/i18n/dictionaries/en.ts` and `zh.ts` (`zh` is typed `typeof en`), inside the existing flat `admin` namespace unless a task says otherwise; zh values must not be byte-identical to en; `t()` does not interpolate — callers use `.replace("{count}", …)`.
- **Tests.** Vitest runs in the node environment with no DOM and no Testing Library: component tests are (a) pure exported helpers tested directly, (b) source-text assertions via `readFileSync(new URL("X.tsx", import.meta.url), "utf8")`, or (c) `renderToStaticMarkup` for context-free components only. Import `describe/it/expect/vi` from `vitest` (`globals: false`). Server tests use `createTestDatabase({ seed: false })` from `@/server/db/test-utils` with `await testDb.cleanup()` in `afterEach`; MySQL twins use fake stores whose `query` resolves `[rows]` (and `execute` resolves `[{ affectedRows }]`), and assert the SQL at `mock.calls[i][0]`. No network, no real MySQL.
- **Next.js 16.** Pages under `/admin` are Client Components (`"use client"`). A page that calls `useSearchParams()` renders its content inside `<Suspense>` (otherwise `next build` fails with "Missing Suspense boundary with useSearchParams"). The dynamic page `/admin/sources/[id]` reads its id with `useParams()` from `next/navigation`. `frontend/src/app/admin/layout.tsx` stays a Server Component and renders the client `AdminShell`.
- **Effects.** ESLint's `react-hooks/set-state-in-effect` is an error: effects start loads inside `queueMicrotask(() => { … })`, as the existing admin code does.
- **Gates for every task (from `frontend/`).** The task's own test files with `npx vitest run <files>`; `npm run lint`; the non-test type gate `npx tsc -p tsconfig.json --noEmit --incremental false 2>&1 | grep 'error TS' | grep -E -v '\.test\.(ts|tsx)\('` must print nothing; tasks that add or change a page or layout also run `npm run build`. The final task runs the full `npm run test`. Never source `frontend/.env.local` for any command (it points at a live MySQL).
- **Commits.** One or more commits per task with explicit pathspecs; never stage `.DS_Store`, `services/.DS_Store`, `ops-evidence/`, `frontend/data/`, `data/`. **Do not add a `Co-Authored-By` trailer** (repository owner's rule: Claude must not appear as a GitHub contributor — it overrides any attribution reminder in your environment).

## Decisions this plan adds (beyond the spec text — confirm at plan review)

1. **Strangler order.** The old `frontend/src/app/admin/page.tsx` stays at `/admin` and shrinks task by task (each migration task moves one section out and deletes it there); Task 14 replaces what is left with the overview. There are no temporary API routes. Between Task 11 and Task 13 the branch has no source-list page (the old table is retired before the paginated one lands); that is internal to the branch.
2. **One SQL text for both dialects.** Overview, list, index and detail queries are built once as dialect-neutral SQL (`COALESCE`, `CASE`, `SUM`, `LIKE … ESCAPE '!'`, `LIMIT ? OFFSET ?`) and executed through `AdminSqlRunner` (`db.$client.prepare(sql).all(...)` on SQLite — the same raw-client pattern as `server/events/event-log.ts` — and `mysqlSelectMany` on MySQL). "scheduled" reuses the scheduler's MySQL WHERE text, extracted to `CRAWLABLE_SOURCE_WHERE_SQL`, and a parity test pins it equal to Drizzle's `listCrawlableSources`.
3. **Overview sections fail independently.** Each of `coverage`, `pipeline`, `crawlHealth`, `bids` is `T | null`, with `errors[section] = { code: "SECTION_FAILED", message }` and a server-side `console.error`; the page shows an error card for a null section only (spec §10).
4. **pendingQa** = the bid-QA page's "needs review" count (`listAdminBidQaItems*(…, { limit: 1 }).summary.needsReview`), because `bid-qa-repository.ts` has no SQL predicate for it; it costs the same as opening the QA page.
5. **Throttle events** = 24-hour `failure` rows whose `(error_code, error_message)` pass `isThrottleFailure` — the exact check `isPlatformThrottleSignature` applies, extracted in `platform-deferral.ts`. A log row does not store stderr, so this is a lower bound; runs that left no log row (timeouts) are not counted.
6. **Open bids by level** = `COALESCE(bids.jurisdiction_level, bids.issuer_type)` (the importer stamps the source's level on every crawled bid); bids have no source-id column, so no join.
7. **Pipeline** lists every provider family that has local sources except the display fallbacks `public_portal / state_portal / federal_portal` (they cannot hold a platform review since the phase-3 fix wave), reading local rows through a light loader (no logs, events or health snapshots).
8. **Approval facet = gate view.** `approved` (`approval_status = 'approved'`, or NULL on a federal/state row, which the scheduler runs), `awaiting` (`needs_review`, or NULL on a local row), `blocked`. List items carry `approvalState` with these values (the spec's `approvalStatus` field, renamed for what it holds).
9. **Index API** (`GET /api/admin/data-sources/index`, admin + operator) accepts the list's full filter set (a superset of the spec's `level`, `state`), returns `{ items, total, truncated }` capped at 5,000 rows, and each item carries `issuerType`, `jurisdictionLevel` and `crawlerSourceId` so "run now" and the batch-run panel can resolve crawler ids. It is registered in `operatorMutationRoutes` (the coverage test keys arrays by role set; it has no mutation).
10. **Detail.** Only state-portal rows (`issuer_type = 'state'`) use the state-keyed crawler-log and live-health candidates; today a county in California shows California's latest run and live health. The detail response adds `logSourceKeys`, `states` (level, platform, approval, health — same SQL as the list), `readiness` (bucket + reason for local sources), bid counts by lifecycle and the latest 10 bids selected by `bids.id LIKE '<source id>:%'` (the importers' own per-source selection). `AdminDataSource` gains `fipsCode` (the GEOID the spec shows).
11. **Crawler-log cursor.** `GET /api/admin/crawler-logs` adds repeatable `source` (≤ 10), `before`, and `beforeId` (tie-breaker for equal `started_at`); results order by `started_at DESC, id DESC`; the response adds `nextCursor: { before, beforeId } | null`.
12. **Old list filters are not carried over.** The client-side live-health classification / triage / recommended-action chips and the triage queue view of the old table are dropped; per-source live health and triage move to the detail page's overview tab (they only ever applied to state portals; `/admin/quality` keeps the state-portal risk view).
13. **Support loses three UI views.** Per the spec table, support no longer sees bid QA, notification delivery or crawl logs in the console (today it sees them read-only); the GET APIs keep allowing support.
14. **Onboarding families** come from `GET /api/admin/data-sources/approval-readiness` (console-read), because the index API is admin/operator only.
15. **Header actions move.** "Run state crawlers" moves to the crawl-runs page header, "Reconcile subscriptions" to the users page header.
16. **Sidebar groups** are collapsible; the group holding the current page is always open.

## File Structure

New files (all paths under `frontend/`):

| File | Responsibility | Task |
| --- | --- | --- |
| `src/components/admin/admin-nav.ts` | Menu config, role visibility, route resolution, breadcrumbs, page guard | 1 |
| `src/components/layout/admin-sidebar-tree.tsx` | Admin tree rendered by `AppSidebar` under `/admin/**` | 1 |
| `src/app/admin/layout.tsx` | Server layout → `AdminShell` | 2 |
| `src/components/admin/AdminShell.tsx` | Gate, breadcrumb, title, role context | 2 |
| `src/components/admin/admin-session.tsx` | `AdminSession` context and role flags | 2 |
| `src/components/admin/admin-format.ts` | Shared formatters and tones moved out of the old page | 2 |
| `src/components/admin/AdminStateCards.tsx` | `AdminAccessState`, `AdminSectionStateCard`, `SummaryCard`, `AdminNotice` | 2 |
| `src/components/admin/use-admin-resource.ts` | One resource's load/ready/error state with stale-response guard | 2 |
| `src/components/admin/sections/UsersSection.tsx`, `UserAuditSection.tsx`, `user-access-constants.ts` | Users and audit pages' content | 3 |
| `src/app/admin/users/page.tsx`, `src/app/admin/users/audit/page.tsx` | Thin pages | 3 |
| `src/components/admin/sections/NotificationsSection.tsx`, `GrowthFunnelSection.tsx`, `ConfigRegistrySection.tsx` | Operations pages' content | 4 |
| `src/app/admin/notifications/page.tsx`, `growth/page.tsx`, `config/page.tsx` | Thin pages | 4 |
| `src/components/admin/sections/RiskCheckSection.tsx`, `BidQaSection.tsx` | Quality pages' content | 5 |
| `src/app/admin/quality/page.tsx`, `src/app/admin/quality/bids/page.tsx` | Thin pages | 5 |
| `src/server/admin/sql-runner.ts` | `AdminSqlRunner` for SQLite and MySQL, `sqlCount` | 6 |
| `src/server/admin/data-source-list-contract.ts` | Dependency-free vocabulary shared by server and client | 6 (extended in 12) |
| `src/server/admin/data-source-sql.ts` | SQL fragments: level, local, platform, approval state, health state, scheduled | 6 (extended in 7) |
| `src/server/admin/data-source-query.ts` | Filter parsing, WHERE builder, index (6), page + facets (12) | 6, 12 |
| `src/app/api/admin/data-sources/index/route.ts` | Index API | 6 |
| `src/server/admin/overview.ts` | Overview computation, both dialects | 7 |
| `src/app/api/admin/overview/route.ts` | Overview API | 7 |
| `src/server/admin/source-detail.ts` | Detail computation, both dialects | 8 |
| `src/components/admin/sources/*` | Detail view, list view, shared source helpers | 9, 13 |
| `src/app/admin/sources/[id]/page.tsx`, `onboarding/page.tsx`, `runs/page.tsx`, `page.tsx` | Source pages | 9, 10, 13 |
| `src/components/admin/sections/OnboardingSection.tsx`, `CrawlRunsSection.tsx` | Onboarding and runs content | 10 |
| `src/components/admin/overview/*` | Overview view and helpers | 14 |

Modified: `src/components/layout/app-sidebar.tsx` (1), `src/app/admin/page.tsx` (2–5, 9–11, replaced in 14), `src/app/admin/page.test.ts(x)` (2–11, replaced in 14), `src/lib/i18n/dictionaries/{en,zh}.ts` (most UI tasks), `src/lib/api/admin.ts` + `admin.test.ts` (6–8, 12), `src/server/admin/data-sources-repository.ts` (7, 8), `src/server/crawler/source-registry.ts` (7), `src/server/crawler/platform-deferral.ts` (7), `src/app/api/admin/data-sources/route.ts` (12), `src/app/api/admin/data-sources/[id]/route.ts` (8), `src/app/api/admin/crawler-logs/route.ts` (8), `src/components/admin/JurisdictionBatchRunPanel.tsx` (10), `src/server/auth/role-route-coverage.test.ts` (6, 7), `CLAUDE.md` and ops docs (14).

## Task order

Strictly sequential (most tasks touch `page.tsx`, the dictionaries or `src/lib/api/admin.ts`): 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14, then the controller's acceptance run. Suggested implementer tiers: Tasks 1, 6, 7, 8, 12 carry complete code (standard tier is enough); Tasks 3, 4, 5, 9, 10, 11 are large moves out of `page.tsx` (standard tier); Tasks 13 and 14 are the biggest new UI (most capable tier).

### How to move a section out of `page.tsx` (Tasks 3, 4, 5, 9, 10, 11)

Line numbers below are for `page.tsx` at the start of the branch; earlier tasks shift them, so always locate a block by the **anchor text** given, not by line number.

1. Create the section component as a Client Component that owns its state: move the section's `useState` hooks, loader, handlers and helper functions into it, exactly as they are, except (a) the resource comes from `useAdminResource` instead of the page's `state` slice, (b) role flags come from `useAdminSession()`, (c) the page-wide `runMessage` becomes a local `notice` state rendered with `<AdminNotice>` at the top of the section, and (d) `!isFullyFailedDashboard &&` guards are dropped.
2. Render rule for a resource section: `status === "error" && data === null` → `AdminSectionStateCard code="error"` with the section's existing title key and a retry calling `reload`; `status === "loading" && data === null` → `AdminSectionStateCard code="loading"`; otherwise render the section with `data` (and when `status === "error"` with data, an `AdminNotice tone="error"` saying `t("admin.sectionRefreshFailed")`).
3. Delete the moved code from `page.tsx`: the JSX, the hooks, the handlers, helpers no other remaining section uses, the slice in `AdminDashboardSections` / `AdminDashboardLoaders` / `createInitialAdminSectionState` / `createRefreshingAdminSectionState` / `loadAdminDashboardSections`, and imports that become unused. `npm run lint` flags leftovers.
4. Tests: run `src/app/admin/page.test.ts` and `page.test.tsx`. Every assertion that now fails because it names moved code moves to the new section's test file (read the new file instead of `page.tsx`); an assertion that names code this task deliberately deletes is removed and listed in your report. Adjust the two behavioural tests of `loadAdminDashboardSections` / `isAdminDashboardFullyFailed` to the remaining slices. Component tests that read `../../app/admin/page.tsx` (`CrawlerConfigPanel.test.ts`, `JurisdictionBatchRunPanel.test.ts`, `SourcePrecheckPanel.test.ts`) are re-pointed in the task that moves the mount they check.
5. Pages are thin: `export default function X() { return <XSection />; }` with `"use client"` at the top.

---
### Task 1: Admin navigation model and sidebar tree

**Files:**
- Create: `frontend/src/components/admin/admin-nav.ts`
- Create: `frontend/src/components/admin/admin-nav.test.ts`
- Create: `frontend/src/components/layout/admin-sidebar-tree.tsx`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Modify: `frontend/src/components/layout/app-sidebar.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `frontend/src/lib/i18n/dictionaries/zh.ts`

**Interfaces:**
- Consumes: `ADMIN_CONSOLE_ROLES`, `type AdminConsoleRole` from `@/server/auth/entitlements`; sidebar primitives from `@/components/ui/sidebar`.
- Produces (used by Tasks 2, 13, 14): `isAdminConsoleRole(role): role is AdminConsoleRole`, `isAdminPath(pathname): boolean`, `visibleAdminNav(role): AdminNavView`, `resolveAdminRoute(pathname): ResolvedAdminRoute | null`, `canViewAdminPath(role, pathname): boolean`, `adminBreadcrumbs(pathname): AdminBreadcrumb[]`, `adminPageTitleKey(pathname): string`, `isActiveAdminItem(item, pathname): boolean`, `adminNavLabelKeys(): string[]`, `ADMIN_OVERVIEW_ITEM`, `ADMIN_NAV_GROUPS`; component `AdminSidebarTree({ role, pathname })`.

- [ ] **Step 1: Add the navigation i18n keys**

Append these keys at the end of the `admin` object in `en.ts` (after `subscriptionReconcileFailed`) and the same keys with the Chinese values at the end of `admin` in `zh.ts`:

| key | en | zh |
| --- | --- | --- |
| `nav_root` | Admin console | 管理后台 |
| `nav_backToApp` | Back to app | 返回前台 |
| `nav_overview` | Overview | 概览 |
| `nav_group_sources` | Data sources | 数据源 |
| `nav_sourcesList` | Source list | 源列表 |
| `nav_sourceDetail` | Source detail | 源详情 |
| `nav_sourcesOnboarding` | Onboarding approval | 接入审批 |
| `nav_sourcesRuns` | Crawl runs | 抓取运行 |
| `nav_group_quality` | Data quality | 数据质量 |
| `nav_qualityStates` | State portal quality | 州门户质量 |
| `nav_qualityBids` | Bid QA | 招标质检 |
| `nav_group_access` | Users & access | 用户权限 |
| `nav_users` | Users | 用户 |
| `nav_usersAudit` | Audit log | 审计日志 |
| `nav_group_operations` | Operations | 运营系统 |
| `nav_notifications` | Notification delivery | 通知投递 |
| `nav_growth` | Growth funnel | 增长漏斗 |
| `nav_config` | Configuration | 配置 |

- [ ] **Step 2: Write the failing navigation test**

Create `frontend/src/components/admin/admin-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import {
  adminBreadcrumbs,
  adminNavLabelKeys,
  adminPageTitleKey,
  canViewAdminPath,
  isActiveAdminItem,
  isAdminConsoleRole,
  isAdminPath,
  resolveAdminRoute,
  visibleAdminNav,
} from "./admin-nav";

function visibleHrefs(role: AdminConsoleRole) {
  const view = visibleAdminNav(role);
  return [view.overview?.href, ...view.groups.flatMap((group) => group.items.map((item) => item.href))].filter(Boolean);
}

describe("admin navigation", () => {
  it("shows each role exactly the spec's menu", () => {
    expect(visibleHrefs("admin")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/sources/runs",
      "/admin/quality",
      "/admin/quality/bids",
      "/admin/users",
      "/admin/users/audit",
      "/admin/notifications",
      "/admin/growth",
      "/admin/config",
    ]);
    expect(visibleHrefs("operator")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/sources/runs",
      "/admin/quality",
      "/admin/quality/bids",
      "/admin/notifications",
      "/admin/growth",
    ]);
    expect(visibleHrefs("support")).toEqual([
      "/admin",
      "/admin/sources",
      "/admin/sources/onboarding",
      "/admin/quality",
      "/admin/growth",
    ]);
  });

  it("drops a group that has no item for the role", () => {
    expect(visibleAdminNav("support").groups.map((group) => group.key)).toEqual(["sources", "quality", "operations"]);
    expect(visibleAdminNav("admin").groups.map((group) => group.key)).toEqual(["sources", "quality", "access", "operations"]);
  });

  it("resolves menu paths, the source detail page and trailing slashes", () => {
    expect(resolveAdminRoute("/admin")?.item.key).toBe("overview");
    expect(resolveAdminRoute("/admin/")?.item.key).toBe("overview");
    expect(resolveAdminRoute("/admin/sources/runs")?.item.key).toBe("sources.runs");
    expect(resolveAdminRoute("/admin/sources/onboarding")?.detailId).toBeNull();
    const detail = resolveAdminRoute("/admin/sources/bidnet_co_denver");
    expect(detail?.item.key).toBe("sources.list");
    expect(detail?.group?.key).toBe("sources");
    expect(detail?.detailId).toBe("bidnet_co_denver");
    expect(resolveAdminRoute("/admin/sources/a%20b")?.detailId).toBe("a b");
    expect(resolveAdminRoute("/admin/unknown")).toBeNull();
    expect(resolveAdminRoute(null)).toBeNull();
  });

  it("guards pages by role and fails closed on unknown admin paths", () => {
    expect(canViewAdminPath("support", "/admin/sources/runs")).toBe(false);
    expect(canViewAdminPath("support", "/admin/quality/bids")).toBe(false);
    expect(canViewAdminPath("support", "/admin/notifications")).toBe(false);
    expect(canViewAdminPath("support", "/admin/sources/x1")).toBe(true);
    expect(canViewAdminPath("operator", "/admin/users")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/users/audit")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/config")).toBe(false);
    expect(canViewAdminPath("operator", "/admin/sources/runs")).toBe(true);
    expect(canViewAdminPath("admin", "/admin/unknown")).toBe(true);
    expect(canViewAdminPath("operator", "/admin/unknown")).toBe(false);
  });

  it("builds breadcrumbs and page titles", () => {
    expect(adminBreadcrumbs("/admin")).toEqual([{ labelKey: "admin.nav_root", label: null, href: null }]);
    expect(adminBreadcrumbs("/admin/quality/bids")).toEqual([
      { labelKey: "admin.nav_root", label: null, href: "/admin" },
      { labelKey: "admin.nav_group_quality", label: null, href: null },
      { labelKey: "admin.nav_qualityBids", label: null, href: null },
    ]);
    expect(adminBreadcrumbs("/admin/sources/bidnet_co_denver")).toEqual([
      { labelKey: "admin.nav_root", label: null, href: "/admin" },
      { labelKey: "admin.nav_group_sources", label: null, href: null },
      { labelKey: "admin.nav_sourcesList", label: null, href: "/admin/sources" },
      { labelKey: null, label: "bidnet_co_denver", href: null },
    ]);
    expect(adminPageTitleKey("/admin")).toBe("admin.nav_overview");
    expect(adminPageTitleKey("/admin/sources/x1")).toBe("admin.nav_sourceDetail");
    expect(adminPageTitleKey("/admin/nope")).toBe("admin.nav_root");
  });

  it("marks the list item active on the detail page", () => {
    const list = visibleAdminNav("admin").groups[0].items[0];
    expect(isActiveAdminItem(list, "/admin/sources/x1")).toBe(true);
    expect(isActiveAdminItem(list, "/admin/sources/runs")).toBe(false);
  });

  it("recognises admin paths and console roles", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/sources")).toBe(true);
    expect(isAdminPath("/administrator")).toBe(false);
    expect(isAdminPath(null)).toBe(false);
    expect(isAdminConsoleRole("support")).toBe(true);
    expect(isAdminConsoleRole("user")).toBe(false);
    expect(isAdminConsoleRole(undefined)).toBe(false);
  });

  it("has an English and a different Chinese label for every key it uses", () => {
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const key of adminNavLabelKeys()) {
      const leaf = key.replace(/^admin\./, "");
      expect(enAdmin[leaf], key).toBeTruthy();
      expect(zhAdmin[leaf], key).toBeTruthy();
      expect(zhAdmin[leaf], key).not.toBe(enAdmin[leaf]);
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/admin/admin-nav.test.ts`
Expected: FAIL — `Failed to resolve import "./admin-nav"`.

- [ ] **Step 4: Implement the navigation model**

Create `frontend/src/components/admin/admin-nav.ts`:

```ts
import type { LucideIcon } from "lucide-react";
import {
  Bell,
  ClipboardCheck,
  Database,
  FileSearch,
  Gauge,
  Megaphone,
  Play,
  ScrollText,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { ADMIN_CONSOLE_ROLES, type AdminConsoleRole } from "@/server/auth/entitlements";

/**
 * The admin console's menu (spec 2026-09-29 §3.1). The sidebar tree, the breadcrumb, the page
 * title and the page guard all read this one list.
 */
export interface AdminNavItem {
  /** Stable id, also the React key. */
  key: string;
  href: string;
  /** i18n key in the `admin` namespace. */
  labelKey: string;
  icon: LucideIcon;
  roles: readonly AdminConsoleRole[];
}

export interface AdminNavGroup {
  key: "sources" | "quality" | "access" | "operations";
  labelKey: string;
  icon: LucideIcon;
  items: readonly AdminNavItem[];
}

export interface AdminNavView {
  overview: AdminNavItem | null;
  groups: AdminNavGroup[];
}

export interface ResolvedAdminRoute {
  item: AdminNavItem;
  group: AdminNavGroup | null;
  /** The decoded source id on `/admin/sources/<id>`, otherwise null. */
  detailId: string | null;
}

export interface AdminBreadcrumb {
  labelKey: string | null;
  label: string | null;
  href: string | null;
}

export const ADMIN_ROOT_PATH = "/admin";

const EVERY_CONSOLE_ROLE: readonly AdminConsoleRole[] = ADMIN_CONSOLE_ROLES;
const ADMIN_AND_OPERATOR: readonly AdminConsoleRole[] = ["admin", "operator"];
const ADMIN_ONLY: readonly AdminConsoleRole[] = ["admin"];

export const ADMIN_OVERVIEW_ITEM: AdminNavItem = {
  key: "overview",
  href: ADMIN_ROOT_PATH,
  labelKey: "admin.nav_overview",
  icon: Gauge,
  roles: EVERY_CONSOLE_ROLE,
};

export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    key: "sources",
    labelKey: "admin.nav_group_sources",
    icon: Database,
    items: [
      { key: "sources.list", href: "/admin/sources", labelKey: "admin.nav_sourcesList", icon: Database, roles: EVERY_CONSOLE_ROLE },
      { key: "sources.onboarding", href: "/admin/sources/onboarding", labelKey: "admin.nav_sourcesOnboarding", icon: ShieldCheck, roles: EVERY_CONSOLE_ROLE },
      { key: "sources.runs", href: "/admin/sources/runs", labelKey: "admin.nav_sourcesRuns", icon: Play, roles: ADMIN_AND_OPERATOR },
    ],
  },
  {
    key: "quality",
    labelKey: "admin.nav_group_quality",
    icon: ClipboardCheck,
    items: [
      { key: "quality.states", href: "/admin/quality", labelKey: "admin.nav_qualityStates", icon: FileSearch, roles: EVERY_CONSOLE_ROLE },
      { key: "quality.bids", href: "/admin/quality/bids", labelKey: "admin.nav_qualityBids", icon: ClipboardCheck, roles: ADMIN_AND_OPERATOR },
    ],
  },
  {
    key: "access",
    labelKey: "admin.nav_group_access",
    icon: Users,
    items: [
      { key: "access.users", href: "/admin/users", labelKey: "admin.nav_users", icon: Users, roles: ADMIN_ONLY },
      { key: "access.audit", href: "/admin/users/audit", labelKey: "admin.nav_usersAudit", icon: ScrollText, roles: ADMIN_ONLY },
    ],
  },
  {
    key: "operations",
    labelKey: "admin.nav_group_operations",
    icon: ServerCog,
    items: [
      { key: "operations.notifications", href: "/admin/notifications", labelKey: "admin.nav_notifications", icon: Bell, roles: ADMIN_AND_OPERATOR },
      { key: "operations.growth", href: "/admin/growth", labelKey: "admin.nav_growth", icon: Megaphone, roles: EVERY_CONSOLE_ROLE },
      { key: "operations.config", href: "/admin/config", labelKey: "admin.nav_config", icon: SlidersHorizontal, roles: ADMIN_ONLY },
    ],
  },
];

/** The source detail page is not a menu entry; for breadcrumbs and access it belongs to the list. */
const SOURCE_DETAIL_PATTERN = /^\/admin\/sources\/([^/]+)$/;
const SOURCE_DETAIL_TITLE_KEY = "admin.nav_sourceDetail";

export function isAdminConsoleRole(role: string | null | undefined): role is AdminConsoleRole {
  return typeof role === "string" && (ADMIN_CONSOLE_ROLES as readonly string[]).includes(role);
}

export function isAdminPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ADMIN_ROOT_PATH || pathname.startsWith(`${ADMIN_ROOT_PATH}/`);
}

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function visibleAdminNav(role: AdminConsoleRole): AdminNavView {
  return {
    overview: ADMIN_OVERVIEW_ITEM.roles.includes(role) ? ADMIN_OVERVIEW_ITEM : null,
    groups: ADMIN_NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => item.roles.includes(role)) })).filter(
      (group) => group.items.length > 0,
    ),
  };
}

export function resolveAdminRoute(pathname: string | null | undefined): ResolvedAdminRoute | null {
  if (!pathname) return null;
  const path = normalizePath(pathname);
  if (path === ADMIN_OVERVIEW_ITEM.href) return { item: ADMIN_OVERVIEW_ITEM, group: null, detailId: null };

  for (const group of ADMIN_NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.href === path);
    if (item) return { item, group, detailId: null };
  }

  const detail = SOURCE_DETAIL_PATTERN.exec(path);
  if (detail) {
    const group = ADMIN_NAV_GROUPS.find((candidate) => candidate.key === "sources");
    const item = group?.items.find((candidate) => candidate.key === "sources.list");
    if (group && item) return { item, group, detailId: safeDecode(detail[1]) };
  }
  return null;
}

/** The page guard. An admin path the menu does not know is admin-only (fail closed). */
export function canViewAdminPath(role: AdminConsoleRole, pathname: string | null | undefined): boolean {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved) return role === "admin";
  return resolved.item.roles.includes(role);
}

export function adminBreadcrumbs(pathname: string | null | undefined): AdminBreadcrumb[] {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved || resolved.item === ADMIN_OVERVIEW_ITEM) {
    return [{ labelKey: "admin.nav_root", label: null, href: null }];
  }

  const crumbs: AdminBreadcrumb[] = [{ labelKey: "admin.nav_root", label: null, href: ADMIN_ROOT_PATH }];
  if (resolved.group) crumbs.push({ labelKey: resolved.group.labelKey, label: null, href: null });
  if (resolved.detailId !== null) {
    crumbs.push({ labelKey: resolved.item.labelKey, label: null, href: resolved.item.href });
    crumbs.push({ labelKey: null, label: resolved.detailId, href: null });
  } else {
    crumbs.push({ labelKey: resolved.item.labelKey, label: null, href: null });
  }
  return crumbs;
}

export function adminPageTitleKey(pathname: string | null | undefined): string {
  const resolved = resolveAdminRoute(pathname);
  if (!resolved) return "admin.nav_root";
  return resolved.detailId !== null ? SOURCE_DETAIL_TITLE_KEY : resolved.item.labelKey;
}

export function isActiveAdminItem(item: AdminNavItem, pathname: string | null | undefined): boolean {
  return resolveAdminRoute(pathname)?.item.key === item.key;
}

/** Every i18n key the navigation renders (the dictionary test walks this list). */
export function adminNavLabelKeys(): string[] {
  return [
    "admin.nav_root",
    "admin.nav_backToApp",
    SOURCE_DETAIL_TITLE_KEY,
    ADMIN_OVERVIEW_ITEM.labelKey,
    ...ADMIN_NAV_GROUPS.flatMap((group) => [group.labelKey, ...group.items.map((item) => item.labelKey)]),
  ];
}
```

- [ ] **Step 5: Run the navigation test**

Run: `cd frontend && npx vitest run src/components/admin/admin-nav.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Build the sidebar tree**

Create `frontend/src/components/layout/admin-sidebar-tree.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { AdminConsoleRole } from "@/server/auth/entitlements";
import { isActiveAdminItem, resolveAdminRoute, visibleAdminNav } from "@/components/admin/admin-nav";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

/** The admin console's tree (spec §3.2): back to the app, the overview, then the role's groups. */
export function AdminSidebarTree({ role, pathname }: { role: AdminConsoleRole; pathname: string }) {
  const { t } = useLanguage();
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const view = visibleAdminNav(role);
  const activeGroupKey = resolveAdminRoute(pathname)?.group?.key ?? null;
  const overview = view.overview;
  const overviewActive = overview ? isActiveAdminItem(overview, pathname) : false;

  const toggleGroup = (key: string) => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="winbids-sidebar-link"
                render={
                  <Link href="/">
                    <ArrowLeft />
                    <span>{t("admin.nav_backToApp")}</span>
                  </Link>
                }
              />
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-white/50">{t("admin.nav_root")}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {overview && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={overviewActive}
                  className={`winbids-sidebar-link ${overviewActive ? "winbids-sidebar-link-active" : ""}`}
                  render={
                    <Link href={overview.href}>
                      <overview.icon />
                      <span>{t(overview.labelKey)}</span>
                    </Link>
                  }
                />
              </SidebarMenuItem>
            )}
            {view.groups.map((group) => {
              // The group that holds the current page is always open (plan decision 16).
              const open = group.key === activeGroupKey || openGroups.has(group.key);
              return (
                <SidebarMenuItem key={group.key}>
                  <SidebarMenuButton className="winbids-sidebar-link" aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                    <group.icon />
                    <span>{t(group.labelKey)}</span>
                    {open ? <ChevronDown className="ml-auto" /> : <ChevronRight className="ml-auto" />}
                  </SidebarMenuButton>
                  {open && (
                    <SidebarMenuSub>
                      {group.items.map((item) => {
                        const active = isActiveAdminItem(item, pathname);
                        return (
                          <SidebarMenuSubItem key={item.key}>
                            <SidebarMenuSubButton
                              isActive={active}
                              className={`winbids-sidebar-link ${active ? "winbids-sidebar-link-active" : ""}`}
                              render={
                                <Link href={item.href}>
                                  <item.icon />
                                  <span>{t(item.labelKey)}</span>
                                </Link>
                              }
                            />
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
```

- [ ] **Step 7: Switch `AppSidebar`**

In `frontend/src/components/layout/app-sidebar.tsx`:
1. Remove `Database` and `ServerCog` from the lucide import (they become unused). Keep the line `import { ADMIN_CONSOLE_ROLES } from "@/server/auth/entitlements"` exactly as it is (a test asserts it), and add below the other imports:
   ```tsx
   import { AdminSidebarTree } from "@/components/layout/admin-sidebar-tree"
   import { isAdminConsoleRole, isAdminPath } from "@/components/admin/admin-nav"
   ```
2. Replace the `adminItems` array with a single admin entry:
   ```tsx
     const adminItems = [
       ...ordinaryItems,
       {
         title: t("admin.nav_root"),
         url: "/admin",
         icon: ShieldCheck,
       },
     ];
   ```
3. After `const items = user ? authenticatedItems : anonymousItems;` add:
   ```tsx
     const adminRole = isAdminUser && user && isAdminConsoleRole(user.role) ? user.role : null;
     const showAdminTree = adminRole !== null && isAdminPath(pathname);
   ```
4. Wrap the existing `<SidebarGroup>…</SidebarGroup>` inside `<SidebarContent>` so that the admin tree replaces it on admin paths:
   ```tsx
         <SidebarContent>
           {showAdminTree && adminRole ? (
             <AdminSidebarTree role={adminRole} pathname={pathname ?? ""} />
           ) : (
             <SidebarGroup>
               {/* the existing group, unchanged */}
             </SidebarGroup>
           )}
         </SidebarContent>
   ```
   Leave the header, footer and the existing `const isAdminUser = user ? ADMIN_CONSOLE_ROLES.includes(…)` line unchanged.

- [ ] **Step 8: Update the sidebar source tests**

In `frontend/src/components/layout/app-sidebar.test.ts`:
- In "keeps admin-only navigation out of the ordinary signed-in menu", replace the three `ordinaryMenuBlock` assertions with:
  ```ts
      expect(ordinaryMenuBlock).not.toContain("admin.nav_root");
      expect(ordinaryMenuBlock).not.toContain("/admin");
  ```
- Replace the whole test "adds a distinct admin operations cluster for admin console roles" (it read `app/admin/page.tsx` for `id="data-sources"` / `id="configuration"`, which this redesign removes) with:
  ```ts
    it("gives admin-console users one admin entry and the admin tree under /admin", () => {
      const sidebar = readFileSync(new URL("app-sidebar.tsx", import.meta.url), "utf8");
      const tree = readFileSync(new URL("admin-sidebar-tree.tsx", import.meta.url), "utf8");

      expect(sidebar).toContain("adminItems");
      expect(sidebar).toContain('title: t("admin.nav_root")');
      expect(sidebar).toContain('url: "/admin"');
      expect(sidebar).not.toContain("/admin#data-sources");
      expect(sidebar).not.toContain("/admin#configuration");
      expect(sidebar).toContain("isAdminPath(pathname)");
      expect(sidebar).toContain("<AdminSidebarTree");
      expect(tree).toContain("visibleAdminNav(role)");
      expect(tree).toContain("isActiveAdminItem(");
      expect(tree).toContain("SidebarMenuSub");
      expect(tree).toContain('t("admin.nav_backToApp")');
    });
  ```

- [ ] **Step 9: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin/admin-nav.test.ts src/components/layout/app-sidebar.test.ts src/app/layout.test.ts src/app/local-mvp-auth-tier-boundaries.test.ts src/app/page.test.ts`
Expected: PASS.
Run: `npm run lint` (0 errors) and the non-test type gate (prints nothing).

- [ ] **Step 10: Commit**

```bash
git add frontend/src/components/admin/admin-nav.ts frontend/src/components/admin/admin-nav.test.ts frontend/src/components/layout/admin-sidebar-tree.tsx frontend/src/components/layout/app-sidebar.tsx frontend/src/components/layout/app-sidebar.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): navigation model and admin sidebar tree"
```

---

### Task 2: Admin layout shell and shared admin kit

**Files:**
- Create: `frontend/src/app/admin/layout.tsx`
- Create: `frontend/src/components/admin/AdminShell.tsx`, `frontend/src/components/admin/AdminShell.test.ts`
- Create: `frontend/src/components/admin/admin-session.tsx`, `frontend/src/components/admin/admin-session.test.ts`
- Create: `frontend/src/components/admin/admin-format.ts`, `frontend/src/components/admin/admin-format.test.ts`
- Create: `frontend/src/components/admin/AdminStateCards.tsx`, `frontend/src/components/admin/AdminStateCards.test.tsx`
- Create: `frontend/src/components/admin/use-admin-resource.ts`, `frontend/src/components/admin/use-admin-resource.test.ts`
- Modify: `frontend/src/app/admin/page.tsx` (import the moved helpers instead of defining them)
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: Task 1's `adminBreadcrumbs`, `adminPageTitleKey`, `canViewAdminPath`, `isAdminConsoleRole`; `useAuth()` from `@/context/AuthContext` (`{ user: PublicUser | null; isLoading: boolean }`); `PublicUser` from `@/lib/api/auth`; `UniversalState` from `@/components/universal-state`.
- Produces (used by every later UI task):
  - `useAdminSession(): AdminSession` where `AdminSession = { user: PublicUser; role: AdminConsoleRole; isAdmin: boolean; isOperator: boolean; canRunOperations: boolean; canManageUsers: boolean; canManageConfig: boolean }`; `adminRoleFlags(role)`.
  - `useAdminResource<T>(load: () => Promise<T>, options?: { enabled?: boolean }): { status: "loading" | "error" | "ready"; data: T | null; error: unknown; reload: () => Promise<void>; setData: (update: (data: T | null) => T | null) => void }` — `load` must be memoized with `useCallback`; a new identity reloads.
  - `formatDate`, `formatDateInputValue`, `endOfDayIsoFromDateInput`, `statusTone`, `compactErrorMessage`, `fallbackMessage` from `@/components/admin/admin-format`.
  - `AdminAccessState`, `AdminSectionStateCard`, `SummaryCard`, `AdminNotice` from `@/components/admin/AdminStateCards`.

- [ ] **Step 1: Add the shell i18n keys**

Append at the end of `admin` in both dictionaries:

| key | en | zh |
| --- | --- | --- |
| `breadcrumbLabel` | Breadcrumb | 面包屑导航 |
| `forbiddenPageTitle` | This page is not available for your role | 当前角色无权访问此页面 |
| `forbiddenPageDescription` | Your back-office role cannot open this page. Pick a page you can use from the menu. | 你的后台角色无法打开此页面，请从菜单中选择可访问的页面。 |
| `backToOverview` | Back to overview | 返回概览 |
| `sectionRefreshFailed` | Refresh failed; showing the last loaded data. | 刷新失败，显示的是上次加载的数据。 |

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/components/admin/admin-format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  compactErrorMessage,
  endOfDayIsoFromDateInput,
  fallbackMessage,
  formatDate,
  formatDateInputValue,
  statusTone,
} from "./admin-format";

describe("admin formatters", () => {
  it("formats dates and date inputs", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDateInputValue(null)).toBe("");
    expect(formatDateInputValue("not a date")).toBe("");
    expect(formatDateInputValue("2026-09-29T10:00:00.000Z")).toBe("2026-09-29");
    expect(endOfDayIsoFromDateInput("2026-09-29")).toBe("2026-09-29T23:59:59.000Z");
    expect(endOfDayIsoFromDateInput("")).toBeNull();
    expect(endOfDayIsoFromDateInput("2026-13-45")).toBeNull();
  });

  it("maps a run status to a tone", () => {
    expect(statusTone("success")).toContain("emerald");
    expect(statusTone("running")).toContain("sky");
    expect(statusTone("locked")).toContain("sky");
    expect(statusTone("failure")).toContain("rose");
    expect(statusTone(null)).toContain("slate");
  });

  it("shortens long messages and reads a log's fallback reason", () => {
    expect(compactErrorMessage("x".repeat(96))).toBe("x".repeat(96));
    expect(compactErrorMessage("x".repeat(97))).toBe(`${"x".repeat(93)}...`);
    expect(fallbackMessage(null)).toBeNull();
    expect(fallbackMessage({ fallbackSource: "fixture", fallbackReason: "portal down" } as never)).toBe("portal down");
    expect(fallbackMessage({ fallbackSource: null, fallbackReason: "ignored" } as never)).toBeNull();
  });
});
```

Create `frontend/src/components/admin/admin-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { adminRoleFlags } from "./admin-session";

describe("adminRoleFlags", () => {
  it("matches the old page's role flags", () => {
    expect(adminRoleFlags("admin")).toEqual({ role: "admin", isAdmin: true, isOperator: false, canRunOperations: true, canManageUsers: true, canManageConfig: true });
    expect(adminRoleFlags("operator")).toEqual({ role: "operator", isAdmin: false, isOperator: true, canRunOperations: true, canManageUsers: false, canManageConfig: false });
    expect(adminRoleFlags("support")).toEqual({ role: "support", isAdmin: false, isOperator: false, canRunOperations: false, canManageUsers: false, canManageConfig: false });
  });
});
```

Create `frontend/src/components/admin/use-admin-resource.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resourceFailed, resourceLoading, resourceReady } from "./use-admin-resource";

describe("admin resource transitions", () => {
  it("keeps the previous data while loading and after a failure", () => {
    const ready = resourceReady([1, 2]);
    expect(ready).toEqual({ status: "ready", data: [1, 2], error: null });
    expect(resourceLoading(ready)).toEqual({ status: "loading", data: [1, 2], error: null });
    const boom = new Error("boom");
    expect(resourceFailed(ready, boom)).toEqual({ status: "error", data: [1, 2], error: boom });
    expect(resourceFailed({ status: "loading", data: null, error: null }, boom).data).toBeNull();
  });
});
```

Create `frontend/src/components/admin/AdminStateCards.test.tsx`:

```tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Database } from "lucide-react";
import { describe, expect, it } from "vitest";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "./AdminStateCards";

describe("admin state cards", () => {
  it("renders a summary card", () => {
    const html = renderToStaticMarkup(<SummaryCard label="Sources" value={1020} icon={Database} />);
    expect(html).toContain("Sources");
    expect(html).toContain("1020");
  });

  it("renders a notice only when there is a message", () => {
    expect(renderToStaticMarkup(<AdminNotice message={null} />)).toBe("");
    expect(renderToStaticMarkup(<AdminNotice message="Saved." />)).toContain('role="status"');
    expect(renderToStaticMarkup(<AdminNotice message="Failed." tone="error" />)).toContain('role="alert"');
  });

  it("renders a section state card through UniversalState", () => {
    const html = renderToStaticMarkup(
      <AdminSectionStateCard actionLabel="Retry" code="error" message="Could not load." title="Users" />,
    );
    expect(html).toContain('data-state-code="error"');
    expect(html).toContain("Could not load.");
  });
});
```

Create `frontend/src/components/admin/AdminShell.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminShellState } from "./AdminShell";

describe("admin shell", () => {
  it("decides the gate in the old page's order, then the per-page role guard", () => {
    const base = { isLoading: false, hasUser: true, role: "admin", pathname: "/admin" };
    expect(adminShellState({ ...base, isLoading: true })).toBe("loading");
    expect(adminShellState({ ...base, hasUser: false, role: null })).toBe("login_required");
    expect(adminShellState({ ...base, role: "user" })).toBe("forbidden");
    expect(adminShellState({ ...base, role: "support", pathname: "/admin/users" })).toBe("forbidden_page");
    expect(adminShellState({ ...base, role: "support", pathname: "/admin/sources/x1" })).toBe("ready");
    expect(adminShellState(base)).toBe("ready");
  });

  it("keeps the layout a Server Component that renders the client shell", () => {
    const layout = readFileSync(new URL("../../app/admin/layout.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("AdminShell.tsx", import.meta.url), "utf8");
    expect(layout).not.toContain('"use client"');
    expect(layout).toContain("<AdminShell>{children}</AdminShell>");
    expect(shell.startsWith('"use client"')).toBe(true);
    expect(shell).toContain("adminBreadcrumbs(pathname)");
    expect(shell).toContain("adminPageTitleKey(pathname)");
    expect(shell).toContain("<AdminSessionProvider");
    expect(shell).toContain('t("admin.forbiddenPageTitle")');
    expect(shell).toContain('t("admin.loginRequiredTitle")');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/admin-format.test.ts src/components/admin/admin-session.test.ts src/components/admin/use-admin-resource.test.ts src/components/admin/AdminStateCards.test.tsx src/components/admin/AdminShell.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 4: Implement the kit**

Create `frontend/src/components/admin/admin-format.ts` (bodies moved verbatim from `page.tsx`; `expiresAtFromDateInput` and `deadlineFromDateInput` had identical bodies and become one function):

```ts
import type { AdminCrawlerLog } from "@/lib/api/admin";

export function formatDate(value: string | null) {
  if (!value) return "-";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateInputValue(value: string | null) {
  if (!value) return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

/** A yyyy-mm-dd input value as the last second of that day in UTC (override expiry, QA deadline). */
export function endOfDayIsoFromDateInput(value: string) {
  if (!value) return null;

  const date = new Date(`${value}T23:59:59.000Z`);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toISOString();
}

export function statusTone(status: string | null | undefined) {
  if (status === "success") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "running" || status === "locked") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function compactErrorMessage(message: string) {
  return message.length > 96 ? `${message.slice(0, 93)}...` : message;
}

export function fallbackMessage(log: AdminCrawlerLog | null | undefined) {
  if (!log?.fallbackSource) return null;

  return log.fallbackReason ? compactErrorMessage(log.fallbackReason) : null;
}
```

Create `frontend/src/components/admin/AdminStateCards.tsx`:

```tsx
"use client";

import type { LucideIcon } from "lucide-react";
import { UniversalState } from "@/components/universal-state";

export function AdminAccessState({
  code,
  title,
  description,
  action,
}: {
  code: "loading" | "permission_denied";
  title: string;
  description: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pb-8">
      <UniversalState
        actions={action ? [{ href: action.href, label: action.label }] : undefined}
        className="bg-white p-6"
        code={code}
        message={description}
        title={title}
      />
    </div>
  );
}

export function AdminSectionStateCard({
  action,
  actionLabel,
  code,
  message,
  title,
}: {
  action?: () => void;
  actionLabel: string;
  code: "error" | "loading";
  message: string;
  title: string;
}) {
  return (
    <UniversalState
      actions={action ? [{ label: actionLabel, onClick: action }] : undefined}
      className="bg-white"
      code={code}
      message={message}
      title={title}
    />
  );
}

export function SummaryCard({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <Icon size={18} className="text-slate-400" />
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">{value}</div>
    </div>
  );
}

/** The old page's single `runMessage` banner, now one per section. */
export function AdminNotice({ message, tone = "info" }: { message: string | null; tone?: "info" | "error" }) {
  if (!message) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-lg border px-4 py-3 text-sm font-medium shadow-sm ${
        tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-700"
      }`}
    >
      {message}
    </div>
  );
}
```

Create `frontend/src/components/admin/admin-session.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { PublicUser } from "@/lib/api/auth";
import type { AdminConsoleRole } from "@/server/auth/entitlements";

export interface AdminRoleFlags {
  role: AdminConsoleRole;
  isAdmin: boolean;
  isOperator: boolean;
  /** Crawler runs, prechecks, triage, crawler config, notification delivery, bid QA writes. */
  canRunOperations: boolean;
  /** Users, audit log, per-source approve/hold. */
  canManageUsers: boolean;
  canManageConfig: boolean;
}

export interface AdminSession extends AdminRoleFlags {
  user: PublicUser;
}

/** The old page's role flags (page.tsx: isAdmin, isOperator, canRunOperations, canManageUsers, canManageConfig). */
export function adminRoleFlags(role: AdminConsoleRole): AdminRoleFlags {
  const isAdmin = role === "admin";
  const isOperator = role === "operator";
  return {
    role,
    isAdmin,
    isOperator,
    canRunOperations: isAdmin || isOperator,
    canManageUsers: isAdmin,
    canManageConfig: isAdmin,
  };
}

const AdminSessionContext = createContext<AdminSession | null>(null);

export const AdminSessionProvider = AdminSessionContext.Provider;

export function useAdminSession(): AdminSession {
  const session = useContext(AdminSessionContext);
  if (!session) throw new Error("useAdminSession must be used inside AdminShell");
  return session;
}
```

Create `frontend/src/components/admin/use-admin-resource.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AdminResourceStatus = "loading" | "error" | "ready";

export interface AdminResourceState<T> {
  status: AdminResourceStatus;
  data: T | null;
  error: unknown;
}

export function resourceLoading<T>(previous: AdminResourceState<T>): AdminResourceState<T> {
  return { status: "loading", data: previous.data, error: null };
}

export function resourceReady<T>(data: T): AdminResourceState<T> {
  return { status: "ready", data, error: null };
}

export function resourceFailed<T>(previous: AdminResourceState<T>, error: unknown): AdminResourceState<T> {
  return { status: "error", data: previous.data, error };
}

/**
 * One admin resource: loads on mount and whenever `load` changes identity (memoize it with
 * useCallback over the filters it reads), keeps the previous data while reloading and after a
 * failure, and drops a response that arrives after a newer request started.
 */
export function useAdminResource<T>(load: () => Promise<T>, options: { enabled?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<AdminResourceState<T>>({ status: "loading", data: null, error: null });
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = latestRequest.current + 1;
    latestRequest.current = request;
    setState((previous) => resourceLoading(previous));
    try {
      const data = await load();
      if (latestRequest.current === request) setState(resourceReady(data));
    } catch (error) {
      if (latestRequest.current === request) setState((previous) => resourceFailed(previous, error));
    }
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    queueMicrotask(() => {
      void reload();
    });
  }, [enabled, reload]);

  const setData = useCallback((update: (data: T | null) => T | null) => {
    setState((previous) => ({ ...previous, data: update(previous.data) }));
  }, []);

  return { ...state, reload, setData };
}
```

- [ ] **Step 5: Implement the shell and the layout**

Create `frontend/src/components/admin/AdminShell.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { adminBreadcrumbs, adminPageTitleKey, canViewAdminPath, isAdminConsoleRole } from "./admin-nav";
import { adminRoleFlags, AdminSessionProvider } from "./admin-session";
import { AdminAccessState } from "./AdminStateCards";

export type AdminShellState = "loading" | "login_required" | "forbidden" | "forbidden_page" | "ready";

/** The old page's gate order (loading → signed in → console role), plus the per-page role guard. */
export function adminShellState(input: {
  isLoading: boolean;
  hasUser: boolean;
  role: string | null | undefined;
  pathname: string | null;
}): AdminShellState {
  if (input.isLoading) return "loading";
  if (!input.hasUser) return "login_required";
  if (!isAdminConsoleRole(input.role)) return "forbidden";
  if (!canViewAdminPath(input.role, input.pathname)) return "forbidden_page";
  return "ready";
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const state = adminShellState({ isLoading, hasUser: Boolean(user), role: user?.role ?? null, pathname });

  if (state === "loading") {
    return <AdminAccessState code="loading" title={t("admin.authLoading")} description={t("admin.authLoadingDescription")} />;
  }
  if (state === "login_required") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.loginRequiredTitle")}
        description={t("admin.loginRequiredDescription")}
        action={{ href: "/login", label: t("admin.loginAction") }}
      />
    );
  }
  if (state === "forbidden") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenTitle")}
        description={t("admin.forbiddenDescription")}
        action={{ href: "/", label: t("admin.returnToDashboard") }}
      />
    );
  }
  if (state === "forbidden_page") {
    return (
      <AdminAccessState
        code="permission_denied"
        title={t("admin.forbiddenPageTitle")}
        description={t("admin.forbiddenPageDescription")}
        action={{ href: "/admin", label: t("admin.backToOverview") }}
      />
    );
  }
  if (!user || !isAdminConsoleRole(user.role)) return null;

  const crumbs = adminBreadcrumbs(pathname);

  return (
    <AdminSessionProvider value={{ user, ...adminRoleFlags(user.role) }}>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-8">
        <header className="flex flex-col gap-1">
          <nav aria-label={t("admin.breadcrumbLabel")}>
            <ol className="flex flex-wrap items-center gap-1 text-sm text-slate-500">
              {crumbs.map((crumb, index) => {
                const label = crumb.labelKey ? t(crumb.labelKey) : (crumb.label ?? "");
                const isLast = index === crumbs.length - 1;
                return (
                  <li key={`${index}-${label}`} className="flex items-center gap-1">
                    {index > 0 && <span aria-hidden="true">/</span>}
                    {crumb.href ? (
                      <Link href={crumb.href} className="hover:text-slate-900">
                        {label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? "page" : undefined}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          <h1 className="text-2xl font-semibold tracking-normal text-slate-950">{t(adminPageTitleKey(pathname))}</h1>
        </header>
        {children}
      </div>
    </AdminSessionProvider>
  );
}
```

Create `frontend/src/app/admin/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/AdminShell";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
```

- [ ] **Step 6: Point the old page at the kit**

In `frontend/src/app/admin/page.tsx` delete the local definitions of `formatDate`, `formatDateInputValue`, `expiresAtFromDateInput`, `deadlineFromDateInput`, `statusTone`, `compactErrorMessage`, `fallbackMessage`, `SummaryCard`, `AdminAccessState` and `AdminSectionStateCard`, add

```tsx
import {
  compactErrorMessage,
  endOfDayIsoFromDateInput,
  fallbackMessage,
  formatDate,
  formatDateInputValue,
  statusTone,
} from "@/components/admin/admin-format";
import { AdminAccessState, AdminSectionStateCard, SummaryCard } from "@/components/admin/AdminStateCards";
```

and replace the calls `expiresAtFromDateInput(` and `deadlineFromDateInput(` with `endOfDayIsoFromDateInput(`. Remove imports that become unused (`UniversalState` stays only if something else still renders it — lint tells you). Behaviour is unchanged; the page still renders its own header and gate until Task 14 (the shell's header now also appears above it on `/admin`, which is expected during the migration).

- [ ] **Step 7: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, then `npm run build` (the new layout must prerender).
Expected: all clean; the build lists `/admin` as before.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/admin/layout.tsx frontend/src/app/admin/page.tsx frontend/src/components/admin/AdminShell.tsx frontend/src/components/admin/AdminShell.test.ts frontend/src/components/admin/admin-session.tsx frontend/src/components/admin/admin-session.test.ts frontend/src/components/admin/admin-format.ts frontend/src/components/admin/admin-format.test.ts frontend/src/components/admin/AdminStateCards.tsx frontend/src/components/admin/AdminStateCards.test.tsx frontend/src/components/admin/use-admin-resource.ts frontend/src/components/admin/use-admin-resource.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): admin layout shell with role guard and shared admin kit"
```

---
### Task 3: Users and audit-log pages

Follow "How to move a section out of `page.tsx`" above.

**Files:**
- Create: `frontend/src/components/admin/sections/user-access-constants.ts`
- Create: `frontend/src/components/admin/sections/UsersSection.tsx`, `UsersSection.test.ts`
- Create: `frontend/src/components/admin/sections/UserAuditSection.tsx`, `UserAuditSection.test.ts`
- Create: `frontend/src/app/admin/users/page.tsx`, `frontend/src/app/admin/users/audit/page.tsx`
- Create: `frontend/src/app/admin/admin-pages.test.ts`
- Modify: `frontend/src/app/admin/page.tsx`, `frontend/src/app/admin/page.test.ts`

**Interfaces:**
- Consumes: Task 2's `useAdminSession`, `useAdminResource`, `AdminNotice`, `AdminSectionStateCard`, `formatDate`, `formatDateInputValue`, `endOfDayIsoFromDateInput`; client helpers `listAdminUsers`, `createAdminUser`, `updateAdminUser`, `listAdminUserFeatureOverrides`, `updateAdminUserFeatureOverride`, `reconcileAdminSubscriptions`, `listAdminUserAuditLogs` (unchanged).
- Produces: `UsersSection`, `UserAuditSection`, pure helpers `featureOverrideFormValues(data, feature)`, `formatAuditChanges(log)`, `auditLogRequestFor(filters)`; constants `USER_ROLES`, `ACCOUNT_TIERS`, `OVERRIDABLE_FEATURES`.

What moves (anchors in `page.tsx`; line numbers at the branch start):

| Piece | Anchor / lines | Goes to |
| --- | --- | --- |
| `USER_ROLES`, `ACCOUNT_TIERS`, `OVERRIDABLE_FEATURES` (L231, 233, 236-242) | `const USER_ROLES: UserRole[]` | `user-access-constants.ts` (exported) |
| `AUDIT_ACTOR_KINDS`, `AUDIT_ACTIONS` (L234-235) | `const AUDIT_ACTOR_KINDS` | `UserAuditSection.tsx` |
| types `UserFilters`, `InvitationDraft`, `DEFAULT_INVITATION_DRAFT`, `featureOverrideFormValues` (L135-140, 149-154, 271-276, 445-455) | `type UserFilters =` | `UsersSection.tsx` (`featureOverrideFormValues` exported) |
| type `UserAuditFilters`, `formatAuditChanges` (L142-147, 850-872) | `type UserAuditFilters =` | `UserAuditSection.tsx` (`formatAuditChanges` exported) |
| state `pendingUserId`, `userFilters`, `userAuditFilters`, `invitationDraft`, `invitedTemporaryPassword`, `isInvitingUser`, `inviteError`, `isReconcilingSubscriptions`, the seven `featureOverride*` / `isLoadingFeatureOverrides` / `isUpdatingFeatureOverride` hooks (L1605, 1620-1621, 1625-1628, 1631-1638) | `const [pendingUserId` | users hooks → `UsersSection`; `userAuditFilters` → `UserAuditSection` |
| `auditLogRequest` callback (L1652-1658) | `const auditLogRequest = useCallback` | `UserAuditSection.tsx` as the exported pure `auditLogRequestFor(filters)` with the same body |
| handlers `updateUserAccess`, `syncFeatureOverrideForm`, `openFeatureOverrides`, `selectedFeatureOverride`, `saveFeatureOverride`, `handleCreateAdminUser`, `reconcileSubscriptions` (L2277-2368, 2443-2487, 2518-2545) | `const updateUserAccess = async` | `UsersSection` |
| `refreshUsers`, `refreshUserAuditLogs` (L2370-2418) | `const refreshUsers = async` | replaced by each resource's `reload` |
| JSX users block (L3160-3529) | `{!isFullyFailedDashboard && canManageUsers && state.users.status === "error" && (` through the end of the `state.users.status === "ready"` block | `UsersSection` body |
| JSX audit block (L3598-3722) | `{!isFullyFailedDashboard && canManageUsers && state.userAuditLogs.status === "error" && (` through the end of the `state.userAuditLogs.status === "ready"` block | `UserAuditSection` body |
| header "Reconcile subscriptions" button (L2606-2616) | `onClick={reconcileSubscriptions}` | top-right of the `UsersSection` section header |

Behaviour changes on purpose: the users page no longer refreshes the audit log after a mutation (the audit page loads its own); typing in a filter reloads only that section and the section stays mounted while it reloads.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/admin/sections/UsersSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { featureOverrideFormValues } from "./UsersSection";

describe("users section", () => {
  it("prefills the override form from the stored override", () => {
    expect(featureOverrideFormValues(null, "submission_guidance")).toEqual({ reason: "", expiresAt: "" });
    const data = {
      overrides: [{ featureKey: "submission_guidance", reason: "Pilot", expiresAt: "2026-12-31T23:59:59.000Z" }],
    } as never;
    expect(featureOverrideFormValues(data, "submission_guidance")).toEqual({ reason: "Pilot", expiresAt: "2026-12-31" });
  });

  it("owns its data and its header action", () => {
    const source = readFileSync(new URL("UsersSection.tsx", import.meta.url), "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("listAdminUsers(userFilters)");
    expect(source).toContain("useAdminResource(loadUsers)");
    expect(source).toContain("createAdminUser(");
    expect(source).toContain("updateAdminUserFeatureOverride(");
    expect(source).toContain("reconcileAdminSubscriptions(");
    expect(source).toContain('t("admin.inviteUser")');
    expect(source).not.toContain("listAdminUserAuditLogs");
  });
});
```

Create `frontend/src/components/admin/sections/UserAuditSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditLogRequestFor, formatAuditChanges } from "./UserAuditSection";

describe("user audit section", () => {
  it("builds the audit-log request from the filters", () => {
    expect(auditLogRequestFor({})).toMatchObject({ limit: 10 });
    expect(auditLogRequestFor({ target: "  a@b.c  " }).target).toBe("a@b.c");
  });

  it("describes changes", () => {
    expect(formatAuditChanges({ changes: [] } as never)).toBe("-");
    expect(formatAuditChanges({ changes: [{ field: "role", before: "user", after: "admin" }] } as never)).toBe("role: user -> admin");
  });

  it("loads its own logs", () => {
    const source = readFileSync(new URL("UserAuditSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminUserAuditLogs(auditLogRequestFor(userAuditFilters))");
    expect(source).toContain("useAdminResource(");
  });
});
```

Create `frontend/src/app/admin/admin-pages.test.ts` — later tasks append rows to `PAGES`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGES: Array<[file: string, section: string]> = [
  ["users/page.tsx", "<UsersSection />"],
  ["users/audit/page.tsx", "<UserAuditSection />"],
];

describe("admin pages", () => {
  it.each(PAGES)("%s is a thin client page rendering %s", (file, section) => {
    const page = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(page.startsWith('"use client"')).toBe(true);
    expect(page).toContain(section);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/sections src/app/admin/admin-pages.test.ts`
Expected: FAIL — modules and pages do not exist.

- [ ] **Step 3: Create the constants module**

Create `frontend/src/components/admin/sections/user-access-constants.ts` (values exactly as in `page.tsx`):

```ts
import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";

export const USER_ROLES: UserRole[] = ["user", "admin", "operator", "support"];
export const ACCOUNT_TIERS: AccountTier[] = ["free", "pro", "business", "enterprise"];
export const OVERRIDABLE_FEATURES: FeatureKey[] = [
  "submission_guidance",
  "compliance_manifest",
  "pursue_no_bid",
  "quote_workflow",
  "knowledge_station",
];
```

The audit-only constants move into `UserAuditSection.tsx` unchanged:

```ts
const AUDIT_ACTOR_KINDS: AdminUserAuditActorKind[] = ["admin", "local-bypass", "self-service"];
const AUDIT_ACTIONS: AdminUserAuditAction[] = ["user_access_updated", "user_invited", "user_self_deleted"];

type UserAuditFilters = {
  actorKind?: AdminUserAuditActorKind;
  action?: AdminUserAuditAction;
  target?: string;
  featureKey?: FeatureKey;
};
```

`page.tsx`'s `ADMIN_CONSOLE_USER_ROLES` stays until Task 14 (the old gate still uses it).

- [ ] **Step 4: Create `UsersSection`**

Create `frontend/src/components/admin/sections/UsersSection.tsx` with this frame, then fill the marked places with the moved code from the table above:

```tsx
"use client";

import { type FormEvent, useCallback, useState } from "react";
import { RefreshCw, Search, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createAdminUser,
  listAdminUserFeatureOverrides,
  listAdminUsers,
  reconcileAdminSubscriptions,
  updateAdminUser as updateAdminUserAccess,
  updateAdminUserFeatureOverride,
  type AdminUser,
  type AdminUserFeatureOverridesResponse,
  type AdminUserFilterStatus,
  type UpdateAdminUserInput,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";
import { endOfDayIsoFromDateInput, formatDate, formatDateInputValue } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { ACCOUNT_TIERS, OVERRIDABLE_FEATURES, USER_ROLES } from "./user-access-constants";

type UserFilters = {
  q?: string;
  role?: UserRole;
  tier?: AccountTier;
  status?: AdminUserFilterStatus;
};

type InvitationDraft = {
  email: string;
  displayName: string;
  role: UserRole;
  tier: AccountTier;
};

const DEFAULT_INVITATION_DRAFT: InvitationDraft = {
  email: "",
  displayName: "",
  role: "user",
  tier: "free",
};

export function featureOverrideFormValues(data: AdminUserFeatureOverridesResponse | null, feature: FeatureKey) {
  const override = data?.overrides.find((item) => item.featureKey === feature);

  return {
    reason: override?.reason ?? "",
    expiresAt: formatDateInputValue(override?.expiresAt ?? null),
  };
}

export function UsersSection() {
  const { t } = useLanguage();
  const [userFilters, setUserFilters] = useState<UserFilters>({});
  const loadUsers = useCallback(() => listAdminUsers(userFilters).then((response) => response.users), [userFilters]);
  const users = useAdminResource(loadUsers);
  const [notice, setNotice] = useState<string | null>(null);
  // moved state hooks (pendingUserId, invitation*, invite*, isReconcilingSubscriptions, featureOverride*)

  // moved handlers, with these substitutions:
  //   setRunMessage(x)                          → setNotice(x)
  //   setState(... users: sectionReady(rows))   → users.setData(() => rows)  (or an updater over the previous rows)
  //   the follow-up listAdminUserAuditLogs(...) calls and their state writes → deleted
  //   reconcileSubscriptions's listAdminUsers(userFilters) refresh           → await users.reload()
  //   expiresAtFromDateInput / endOfDayIsoFromDateInput                      → endOfDayIsoFromDateInput

  const userRows = users.data ?? [];

  if (users.status === "error" && users.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void users.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.users")}
      />
    );
  }
  if (users.status === "loading" && users.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.users")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminNotice message={notice} />
      {users.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {/* moved: the <section> of the users block (L3179-3529) with `users` → `userRows`; its header row
          gains the moved "Reconcile subscriptions" <Button> (same markup as the old page header button) */}
    </div>
  );
}
```

- [ ] **Step 5: Create `UserAuditSection`**

Create `frontend/src/components/admin/sections/UserAuditSection.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { History, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listAdminUserAuditLogs,
  type AdminUserAuditAction,
  type AdminUserAuditActorKind,
  type AdminUserAuditLog,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import type { FeatureKey } from "@/server/auth/entitlements";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { OVERRIDABLE_FEATURES } from "./user-access-constants";

// moved: AUDIT_ACTOR_KINDS, AUDIT_ACTIONS, type UserAuditFilters (Step 3)

/** The old page's auditLogRequest callback, as a pure function. */
export function auditLogRequestFor(filters: UserAuditFilters) {
  return {
    limit: 10,
    actorKind: filters.actorKind,
    action: filters.action,
    target: filters.target?.trim() || undefined,
    featureKey: filters.featureKey,
  };
}

export function formatAuditChanges(log: AdminUserAuditLog) {
  if (log.changes.length === 0) return "-";

  return log.changes
    .map((change) => {
      if (change.field !== "featureOverride") {
        return `${change.field}: ${String(change.before)} -> ${String(change.after)}`;
      }

      const formatOverrideState = (value: typeof change.before) => {
        if (!value) return "default";

        const parts = [value.isEnabled ? "enabled" : "disabled"];
        if (value.reason) parts.push(`reason=${value.reason}`);
        if (value.expiresAt) parts.push(`expires=${formatDate(value.expiresAt)}`);

        return parts.join(" ");
      };

      return `${change.featureKey}: ${formatOverrideState(change.before)} -> ${formatOverrideState(change.after)}`;
    })
    .join(", ");
}

export function UserAuditSection() {
  const { t } = useLanguage();
  const [userAuditFilters, setUserAuditFilters] = useState<UserAuditFilters>({});
  const loadLogs = useCallback(
    () => listAdminUserAuditLogs(auditLogRequestFor(userAuditFilters)).then((response) => response.logs),
    [userAuditFilters],
  );
  const logs = useAdminResource(loadLogs);
  const userAuditLogs = logs.data ?? [];

  if (logs.status === "error" && logs.data === null) {
    return (
      <AdminSectionStateCard
        action={() => void logs.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.userAuditLogs")}
      />
    );
  }
  if (logs.status === "loading" && logs.data === null) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.userAuditLogs")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {logs.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {/* moved: the <section> of the audit block (L3620-3722) */}
    </div>
  );
}
```

Remove any import the moved JSX does not use (lint reports it).

- [ ] **Step 6: Create the pages**

`frontend/src/app/admin/users/page.tsx`:

```tsx
"use client";

import { UsersSection } from "@/components/admin/sections/UsersSection";

export default function AdminUsersPage() {
  return <UsersSection />;
}
```

`frontend/src/app/admin/users/audit/page.tsx`:

```tsx
"use client";

import { UserAuditSection } from "@/components/admin/sections/UserAuditSection";

export default function AdminUserAuditPage() {
  return <UserAuditSection />;
}
```

- [ ] **Step 7: Remove the moved code from `page.tsx` and migrate its tests**

Apply step 3 and step 4 of "How to move a section": delete everything in the table from `page.tsx` (including the `users` and `userAuditLogs` slices, `userFilters` and `auditLogRequest` from `load`'s dependencies, the header Reconcile button, and the now-unused client-helper imports). `canManageUsers` stays (the sources section still uses it). Then run `npx vitest run src/app/admin` and move each failing `page.test.ts` assertion that names users/audit code (L19-39 and L164-186 at the branch start) into `UsersSection.test.ts` or `UserAuditSection.test.ts`.

- [ ] **Step 8: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build` (two new routes appear).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/admin/sections frontend/src/app/admin/users frontend/src/app/admin/admin-pages.test.ts frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts
git commit -m "feat(admin): users and audit-log pages"
```

---

### Task 4: Notification, growth and configuration pages

Follow "How to move a section out of `page.tsx`".

**Files:**
- Create: `frontend/src/components/admin/sections/NotificationsSection.tsx`, `NotificationsSection.test.ts`
- Create: `frontend/src/components/admin/sections/GrowthFunnelSection.tsx`, `GrowthFunnelSection.test.ts`
- Create: `frontend/src/components/admin/sections/ConfigRegistrySection.tsx`, `ConfigRegistrySection.test.ts`
- Create: `frontend/src/app/admin/notifications/page.tsx`, `frontend/src/app/admin/growth/page.tsx`, `frontend/src/app/admin/config/page.tsx`
- Modify: `frontend/src/app/admin/page.tsx`, `page.test.ts`, `page.test.tsx`, `frontend/src/app/admin/admin-pages.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: Task 2's kit; client helpers `listAdminNotifications`, `deliverAdminNotifications`, `getAdminMarketingFunnel`, `listAdminConfigEntries`, `updateAdminConfigEntry` (unchanged).
- Produces: `NotificationsSection`, `GrowthFunnelSection`, `ConfigRegistrySection` (self-loading, no props).

What moves:

| Piece | Anchor (lines at branch start) | Goes to |
| --- | --- | --- |
| notification state `isDeliveringNotifications` (L1630), handler `deliverNotifications` (L2489-2516), `refreshNotifications` (L2420-2441, replaced by `reload`), JSX (L3531-3596) | `{!isFullyFailedDashboard && state.notifications.status === "error" && (` | `NotificationsSection` (resource: `listAdminNotifications({ limit: 10 }).then((response) => response.notifications)`; after delivery call `reload()` instead of the explicit list fetch) |
| funnel JSX (L2655-2718) | `{!isFullyFailedDashboard && state.marketingFunnel.status === "error" && (` | `GrowthFunnelSection` (resource: `getAdminMarketingFunnel().then((response) => response.summary)`) |
| `ConfigRegistrySection` component (L920-1106) with `ConfigEditDraft` (L212-216), `ConfigRegistryStatus` (L130-133), `MARKETING_CONTENT_*` constants (L266-270), `formatConfigScope`, `configStatusTone`, `formatConfigValueJson`, `isMarketingContentConfigEntry`, `configDraftFor` (L894-918); page state `configRegistryStatus`, `configEditDrafts`, `savingConfigEntryId` (L1594-1599); `refreshConfigRegistry` (L1660-1671); handlers `updateConfigEditDraft`, `handleConfigRegistrySave` (L1758-1809); mount (L2752-2763) | `function ConfigRegistrySection(` | one self-loading `ConfigRegistrySection` in `sections/ConfigRegistrySection.tsx`: resource `listAdminConfigEntries().then((response) => response.entries)`; the old props become locals (`configEntries = resource.data ?? []`, `isLoading = resource.status === "loading"`, `isError = resource.status === "error"`, `onRefresh = reload`, `onDraftChange = updateConfigEditDraft`, `onSave = handleConfigRegistrySave`); a successful save updates the entry with `setData` exactly as the old code updated `configRegistryStatus.configEntries` |

The funnel's hard-coded English becomes dictionary keys (spec §7, §11); the section's wrong `id="data-sources"` is dropped. The config section keeps its existing (English) copy and its `id="configuration"`.

- [ ] **Step 1: Add the growth i18n keys**

Append at the end of `admin` in both dictionaries:

| key | en | zh |
| --- | --- | --- |
| `growthFunnelTitle` | Marketing funnel | 营销漏斗 |
| `growthExportLeads` | Export leads CSV | 导出线索 CSV |
| `growthRequestDemo` | Request demo | 预约演示 |
| `growthSignupComplete` | Signup complete | 完成注册 |
| `growthProfileStarted` | Profile started | 开始填写资料 |
| `growthProfileComplete` | Profile complete | 资料已完善 |
| `growthFirstMatchedBid` | First matched bid | 首次查看匹配招标 |
| `growthLatestLeads` | Latest request-demo leads | 最新演示预约线索 |
| `growthNoLeads` | No request-demo leads recorded yet. | 暂无演示预约线索。 |

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/admin/sections/GrowthFunnelSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";

const KEYS = [
  "growthFunnelTitle",
  "growthExportLeads",
  "growthRequestDemo",
  "growthSignupComplete",
  "growthProfileStarted",
  "growthProfileComplete",
  "growthFirstMatchedBid",
  "growthLatestLeads",
  "growthNoLeads",
] as const;

describe("growth funnel section", () => {
  it("renders every label through the dictionary", () => {
    const source = readFileSync(new URL("GrowthFunnelSection.tsx", import.meta.url), "utf8");
    for (const key of KEYS) expect(source).toContain(`t("admin.${key}")`);
    for (const literal of ["Request Demo", "Signup complete", "Profile started", "Profile complete", "First matched bid", "Export leads CSV"]) {
      expect(source).not.toContain(`>${literal}<`);
      expect(source).not.toContain(`"${literal}"`);
    }
    expect(source).toContain("/api/admin/marketing/leads/export");
    expect(source).toContain("getAdminMarketingFunnel()");
    expect(source).not.toContain('id="data-sources"');
  });

  it("has distinct Chinese copy", () => {
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const key of KEYS) expect(zhAdmin[key]).not.toBe(enAdmin[key]);
  });
});
```

`frontend/src/components/admin/sections/NotificationsSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("notifications section", () => {
  it("loads its own notifications and reloads after delivery", () => {
    const source = readFileSync(new URL("NotificationsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminNotifications({ limit: 10 })");
    expect(source).toContain("deliverAdminNotifications(");
    expect(source).toContain('t("admin.notificationDelivery")');
    expect(source).toContain("reload()");
  });
});
```

`frontend/src/components/admin/sections/ConfigRegistrySection.test.ts` — start with the config assertions from `page.test.tsx` tests 1 ("loads and renders the config registry matrix with minimal states") and 2's registry literals, reading `ConfigRegistrySection.tsx` instead of `page.tsx`, plus `page.test.ts` test 2 ("surfaces marketing content CMS copy-library scope …", its 8 literals). Drop the three admin-only literals of `page.test.tsx` test 2 (`"const canManageConfig = isAdmin"`, `"if (!canManageConfig) return Promise.resolve()"`, `"{canManageConfig && !isFullyFailedDashboard && ("`): the page guard now does that job and Task 1's test pins it (`canViewAdminPath("operator", "/admin/config") === false`). Add:

```ts
  it("loads its own entries", () => {
    const source = readFileSync(new URL("ConfigRegistrySection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminConfigEntries()");
    expect(source).toContain("useAdminResource(");
  });
```

Append to `PAGES` in `frontend/src/app/admin/admin-pages.test.ts`:

```ts
  ["notifications/page.tsx", "<NotificationsSection />"],
  ["growth/page.tsx", "<GrowthFunnelSection />"],
  ["config/page.tsx", "<ConfigRegistrySection />"],
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/sections src/app/admin/admin-pages.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create the three sections**

Each file starts with `"use client"`, imports what its moved JSX needs, and follows the resource render rule. `GrowthFunnelSection`:

```tsx
"use client";

import { Activity, Bell, Download, Search, ShieldCheck, UserCog } from "lucide-react";
import { getAdminMarketingFunnel } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

const loadFunnel = () => getAdminMarketingFunnel().then((response) => response.summary);

export function GrowthFunnelSection() {
  const { t } = useLanguage();
  const funnel = useAdminResource(loadFunnel);
  const marketingFunnel = funnel.data;

  if (funnel.status === "error" && !marketingFunnel) {
    return (
      <AdminSectionStateCard
        action={() => void funnel.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={t("admin.growthFunnelTitle")}
      />
    );
  }
  if (!marketingFunnel) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.growthFunnelTitle")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {funnel.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {/* moved: the funnel <section> (L2674-2718) without id="data-sources", with
          "Marketing Funnel" → t("admin.growthFunnelTitle"), "Export leads CSV" → t("admin.growthExportLeads"),
          the five SummaryCard labels → t("admin.growthRequestDemo") / growthSignupComplete / growthProfileStarted /
          growthProfileComplete / growthFirstMatchedBid, "Latest request-demo leads" → t("admin.growthLatestLeads"),
          "No request-demo leads recorded yet." → t("admin.growthNoLeads") */}
    </div>
  );
}
```

(`loadFunnel` is a module-level constant, so its identity never changes and the resource loads once.) `NotificationsSection` and `ConfigRegistrySection` follow the same frame with the resources given in the table.

- [ ] **Step 5: Create the pages**

`frontend/src/app/admin/notifications/page.tsx`, `growth/page.tsx`, `config/page.tsx` — each:

```tsx
"use client";

import { NotificationsSection } from "@/components/admin/sections/NotificationsSection";

export default function AdminNotificationsPage() {
  return <NotificationsSection />;
}
```

(`GrowthFunnelSection` / `AdminGrowthPage`, `ConfigRegistrySection` / `AdminConfigPage`.)

- [ ] **Step 6: Remove the moved code from `page.tsx` and migrate tests**

Delete the moved pieces, the `notifications` and `marketingFunnel` slices, `configRegistryStatus` and `refreshConfigRegistry` (also from `load` and from the `isFullyFailedDashboard` expression, which becomes `areMainSectionsFullyFailed`), and `canManageConfig` if nothing uses it any more. In `page.test.tsx` remove tests 1 and 2 (moved to `ConfigRegistrySection.test.ts`); tests 3 and 4 (sources) stay until Task 11. Move the remaining failing `page.test.ts` assertions per the rule (funnel literals L28-29 become `t("admin.growthExportLeads")` / the export URL in `GrowthFunnelSection.test.ts`).

- [ ] **Step 7: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/admin/sections frontend/src/app/admin/notifications frontend/src/app/admin/growth frontend/src/app/admin/config frontend/src/app/admin/admin-pages.test.ts frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts frontend/src/app/admin/page.test.tsx frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): notification delivery, growth funnel and configuration pages"
```

---

### Task 5: State-portal quality and bid QA pages

Follow "How to move a section out of `page.tsx`".

**Files:**
- Create: `frontend/src/components/admin/sections/RiskCheckSection.tsx`, `RiskCheckSection.test.ts`
- Create: `frontend/src/components/admin/sections/BidQaSection.tsx`, `BidQaSection.test.ts`
- Create: `frontend/src/app/admin/quality/page.tsx`, `frontend/src/app/admin/quality/bids/page.tsx`
- Modify: `frontend/src/app/admin/page.tsx`, `page.test.ts`, `admin-pages.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: Task 2's kit; client helpers `getAdminRiskChecklist`, `listAdminBidQaItems`, `getAdminBidQaCorrections`, `batchUpdateAdminBidQaItems`, `updateAdminBidQaReview`; `bidDetailPath` from `@/lib/bid-routes`.
- Produces: `RiskCheckSection`, `BidQaSection`; the exported pure helpers that move with them (`filterStateDataQualityRows`, `stateDataQualityReasonOptions`, `filterStateDataQualityActionsByRecommendedAction`, `stateDataQualityActionRecommendedActionOptions`, `stateAttachmentRealRatio`, `stateDataQualityP0BlockerNotice`, `STATE_DATA_QUALITY_RISK_FILTERS`, types `StateDataQualityRiskFilter`, `StateDataQualityReasonFilter`, `RecommendedActionFilter`), and a new pure `bidQaRequestFor(filters)`.

What moves:

| Piece | Anchor (lines at branch start) | Goes to |
| --- | --- | --- |
| `RecommendedActionFilter`, `StateDataQualityRiskFilter`, `StateDataQualityReasonFilter`, `StateDataQualityFilters`, `AdminRiskSectionData` (L101-106, 189-196); `STATE_DATA_QUALITY_RISK_FILTERS`, `STATE_DATA_QUALITY_P0_BLOCKER_STATES`, `_COPY` (L262-265); the six state-data-quality helpers (L539-589); `riskCheckTone`, `riskReportFilename`, `riskDetailBidHref`, `RiskDetailItem`, `stateDataQualityRiskTone`, `stateDataQualityRiskFilterLabel`, `StateDataQualityMatrix`, `RiskCheck` (L1108-1536) | `function RiskCheck(` | `RiskCheckSection.tsx` (exports kept) |
| `isRefreshingRiskReport` (L1629), `refreshRiskReport` (L2016-2044), `exportRiskReport` (L2046-2058), JSX (L2720-2750) | `{!isFullyFailedDashboard && state.risk.status === "error" && (` | `RiskCheckSection` (resource: `getAdminRiskChecklist().then(toRiskSectionData)` where `toRiskSectionData` is the mapping `loadAdminDashboardSections` used: `{ report, history, trend, stateDataQuality: value.stateDataQuality ?? null }`; the refresh button calls `reload` while `isRefreshingRiskReport` is set, as before) |
| `BidQaCorrectionDraft`, `BidQaFilters` (L156-172), `DEFAULT_BID_QA_FILTERS` (L218-229), `reviewStatusLabel`, `displayStatusLabel`, `displayStatusTone` (L377-389), `bidQaCorrectionDraftFor` (L438-443), `qualityTone`, `reviewTone` (L697-708) | `const DEFAULT_BID_QA_FILTERS` | `BidQaSection.tsx` |
| state `pendingBidQaId`, `pendingBidQaBatch`, `bidQaFilters`, `selectedBidQaIds`, `correctionHistoryBidId`, `correctionHistoryItems`, `isLoadingCorrectionHistory`, `correctionDrafts` (L1606-1609, 1616-1619); `bidQaRequest` (L1673-1685) → exported pure `bidQaRequestFor(filters)` with the same body; handlers L2060-2063 and L2121-2275; JSX (L2765-3158) | `{!isFullyFailedDashboard && state.bidQa.status === "error" && (` | `BidQaSection` (resource: `useCallback(() => listAdminBidQaItems(bidQaRequestFor(bidQaFilters)), [bidQaFilters])`; `refreshBidQa` becomes `reload`; the derived `visibleSelectedBidQaIds` keeps the batch actions on visible rows) |

`RecommendedActionFilter` is still used by the sources section until Task 11: import it into `page.tsx` from `RiskCheckSection`.

The matrix heading changes from the hard-coded "50-state data quality matrix" to `t("admin.stateQualityMatrixTitle")` (spec §7); `StateDataQualityMatrix` reads `t` with `useLanguage()`. The rest of the matrix copy stays as it is.

- [ ] **Step 1: Add the i18n key**

Append at the end of `admin`: `stateQualityMatrixTitle` — en "State portal data quality (50 states)", zh "州级门户数据质量（50 个州）".

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/admin/sections/RiskCheckSection.test.ts`: move `page.test.ts` tests 8, 9 and 10 ("filters state data quality action rows by recommended action", "filters state data quality matrix rows by P0/P1/P2 and reason code", "describes CA FL IL NY TX P0 blockers …") here, replacing their `await import("./page")` with a static import from `./RiskCheckSection`; move the matrix and risk source assertions (branch-start `page.test.ts` L40-52 and L66-88) reading `RiskCheckSection.tsx`; add:

```ts
  it("titles the matrix as the 50-state portal quality view and loads its own report", () => {
    const source = readFileSync(new URL("RiskCheckSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('t("admin.stateQualityMatrixTitle")');
    expect(source).not.toContain("50-state data quality matrix");
    expect(source).toContain("getAdminRiskChecklist()");
    expect(source).toContain("useAdminResource(");
  });
```

`frontend/src/components/admin/sections/BidQaSection.test.ts`: move the QA source assertions (branch-start `page.test.ts` L89-107, including `"setSelectedBidQaIds([])"`) reading `BidQaSection.tsx`, and add (export `DEFAULT_BID_QA_FILTERS` from the section for it):

```ts
import { bidQaRequestFor, DEFAULT_BID_QA_FILTERS } from "./BidQaSection";

  it("builds the QA list request from the filters", () => {
    expect(bidQaRequestFor(DEFAULT_BID_QA_FILTERS)).toEqual({
      limit: 10,
      q: undefined,
      stateCode: undefined,
      reviewStatus: undefined,
      displayStatus: undefined,
      sourceConfidence: undefined,
      minQualityScore: undefined,
      maxQualityScore: undefined,
      reviewerId: undefined,
      reviewedFrom: undefined,
      reviewedTo: undefined,
    });
    const request = bidQaRequestFor({
      ...DEFAULT_BID_QA_FILTERS,
      stateCode: " co ",
      minQualityScore: "40",
      reviewedFrom: "2026-09-01",
      reviewedTo: "2026-09-29",
    });
    expect(request.stateCode).toBe("CO");
    expect(request.minQualityScore).toBe(40);
    expect(request.reviewedFrom).toBe("2026-09-01T00:00:00.000Z");
    expect(request.reviewedTo).toBe("2026-09-29T23:59:59.999Z");
  });
```

`bidQaRequestFor(filters: BidQaFilters)` has exactly the body of the old `bidQaRequest` callback (L1673-1685) with `bidQaFilters` renamed to `filters`.

Append to `PAGES` in `admin-pages.test.ts`:

```ts
  ["quality/page.tsx", "<RiskCheckSection />"],
  ["quality/bids/page.tsx", "<BidQaSection />"],
```

- [ ] **Step 3: Run them to verify they fail**

Run: `cd frontend && npx vitest run src/components/admin/sections src/app/admin/admin-pages.test.ts`
Expected: FAIL.

- [ ] **Step 4: Create the two sections and pages**

Same frame as Task 4 (`"use client"`, `useAdminResource`, render rule, `AdminNotice` for the old `runMessage` writes). Pages `frontend/src/app/admin/quality/page.tsx` (`AdminQualityPage` → `<RiskCheckSection />`) and `frontend/src/app/admin/quality/bids/page.tsx` (`AdminBidQaPage` → `<BidQaSection />`), each a `"use client"` thin page.

- [ ] **Step 5: Remove the moved code from `page.tsx` and migrate tests**

Delete the moved pieces and the `risk` and `bidQa` slices. The remaining slices are `dataSources` and `crawlerLogs`; keep `loadAdminDashboardSections`' behavioural tests working over those two.

- [ ] **Step 6: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/admin/sections frontend/src/app/admin/quality frontend/src/app/admin/admin-pages.test.ts frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): state-portal quality and bid QA pages"
```

---
### Task 6: Shared SQL runner, source query vocabulary and the index API

**Files:**
- Create: `frontend/src/server/admin/sql-runner.ts`, `sql-runner.test.ts`
- Create: `frontend/src/server/admin/data-source-list-contract.ts`
- Create: `frontend/src/server/admin/data-source-sql.ts`
- Create: `frontend/src/server/admin/data-source-query.ts`, `data-source-query.test.ts`
- Create: `frontend/src/app/api/admin/data-sources/index/route.ts`, `route.test.ts`
- Modify: `frontend/src/server/auth/role-route-coverage.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`, `frontend/src/lib/api/admin.test.ts`

**Interfaces:**
- Consumes: `mysqlSelectMany` (`@/server/db/mysql-runtime`), `stateCrawlerSourceIdForAdminSource` (`@/lib/state-crawler-sources`), `requireAdminAccess`.
- Produces:
  - `AdminSqlRunner { all<T>(sql: string, values?: readonly SqlValue[]): Promise<T[]> }`, `SqlValue = string | number`, `MysqlSqlReader`, `sqliteSqlRunner(db)`, `mysqlSqlRunner(mysql)`, `sqlCount(value): number`.
  - Contract (dependency-free): `COVERAGE_LEVELS`, `CoverageLevel`, `isCoverageLevel`, `coverageLevelOf`, `SOURCE_APPROVAL_STATES`, `SourceApprovalState`, `SOURCE_HEALTH_STATES`, `SourceHealthState`, `SourceFacetKey`, `SourceListFilters`, `emptySourceListFilters()`, `AdminDataSourceIndexItem`, `AdminDataSourceIndexResponse`, `SOURCE_LIST_MAX_QUERY_LENGTH`, `SOURCE_FILTER_MAX_VALUES`, `SOURCE_INDEX_MAX_ROWS`.
  - SQL fragments: `LEVEL_SQL`, `LOCAL_SOURCE_SQL`, `PLATFORM_SQL`, `APPROVAL_STATE_SQL`, `HEALTH_STATE_SQL`.
  - Query: `DataSourceQueryError`, `parseSourceListFilters(params)`, `likeContainsPattern(q)`, `sourceFilterWhere(filters, except?) → { sql, values }`, `listSourceIndex(runner, filters)`, `listAdminDataSourceIndex(db, filters)`, `listAdminDataSourceIndexFromMysql(mysql, filters)`.
  - Route `GET /api/admin/data-sources/index` (admin, operator).
  - Client: `listAdminDataSourceIndex(filters?: Partial<SourceListFilters>)`; `buildQueryString` accepts string arrays (repeated keys).

- [ ] **Step 1: Write the failing runner test**

Create `frontend/src/server/admin/sql-runner.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner } from "./sql-runner";

describe("admin SQL runner", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("runs parameterised SQL on SQLite", async () => {
    const rows = await sqliteSqlRunner(testDb.db).all<{ total: number; label: string }>("SELECT COUNT(*) AS total, ? AS label", ["x"]);
    expect(rows).toEqual([{ total: 0, label: "x" }]);
  });

  it("passes SQL and values to mysql2's query", async () => {
    const query = vi.fn(async () => [[{ total: "3" }]] as [unknown[]]);
    const rows = await mysqlSqlRunner({ query }).all<{ total: string }>("SELECT COUNT(*) AS total FROM t WHERE a = ?", ["b"]);
    expect(rows).toEqual([{ total: "3" }]);
    expect(query).toHaveBeenCalledWith("SELECT COUNT(*) AS total FROM t WHERE a = ?", ["b"]);
  });

  it("reads counts from either driver", () => {
    expect(sqlCount(4)).toBe(4);
    expect(sqlCount("12")).toBe(12);
    expect(sqlCount(null)).toBe(0);
    expect(sqlCount("n/a")).toBe(0);
  });
});
```

Run: `cd frontend && npx vitest run src/server/admin/sql-runner.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 2: Implement the runner**

Create `frontend/src/server/admin/sql-runner.ts`:

```ts
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";

export type SqlValue = string | number;
export type MysqlSqlReader = Parameters<typeof mysqlSelectMany>[0];

/**
 * Runs one dialect-neutral SELECT on either runtime (plan decision 2). The admin overview, source
 * list, index and detail build their SQL once and execute it through this, so SQLite and MySQL
 * share the exact text.
 */
export interface AdminSqlRunner {
  all<T>(sql: string, values?: readonly SqlValue[]): Promise<T[]>;
}

export function sqliteSqlRunner(db: AppDatabase): AdminSqlRunner {
  return {
    async all<T>(sql: string, values: readonly SqlValue[] = []) {
      return db.$client.prepare(sql).all(...values) as T[];
    },
  };
}

export function mysqlSqlRunner(mysql: MysqlSqlReader): AdminSqlRunner {
  return {
    all<T>(sql: string, values: readonly SqlValue[] = []) {
      return mysqlSelectMany<T>(mysql, sql, [...values]);
    },
  };
}

/** COUNT/SUM come back as numbers from better-sqlite3 and as numbers or decimal strings from mysql2. */
export function sqlCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
```

Run the runner test — Expected: PASS.

- [ ] **Step 3: Create the contract and the SQL fragments**

Create `frontend/src/server/admin/data-source-list-contract.ts`:

```ts
/**
 * Vocabulary of the admin source list, index and overview (spec 2026-09-29 §4.2, §5.1).
 * No imports on purpose: client components import these values.
 */
export const COVERAGE_LEVELS = ["federal", "state", "county", "city", "township", "special_district", "unknown"] as const;
export type CoverageLevel = (typeof COVERAGE_LEVELS)[number];

export const SOURCE_APPROVAL_STATES = ["approved", "awaiting", "blocked"] as const;
export type SourceApprovalState = (typeof SOURCE_APPROVAL_STATES)[number];

export const SOURCE_HEALTH_STATES = ["never_run", "healthy", "failing", "disabled"] as const;
export type SourceHealthState = (typeof SOURCE_HEALTH_STATES)[number];

export type SourceFacetKey = "level" | "state" | "platform" | "approval" | "health";

export const SOURCE_LIST_MAX_QUERY_LENGTH = 100;
export const SOURCE_FILTER_MAX_VALUES = 60;
export const SOURCE_INDEX_MAX_ROWS = 5000;

export interface SourceListFilters {
  levels: CoverageLevel[];
  states: string[];
  platforms: string[];
  approvals: SourceApprovalState[];
  healths: SourceHealthState[];
  q: string | null;
}

export function emptySourceListFilters(): SourceListFilters {
  return { levels: [], states: [], platforms: [], approvals: [], healths: [], q: null };
}

export interface AdminDataSourceIndexItem {
  id: string;
  label: string;
  stateCode: string;
  level: CoverageLevel;
  issuerType: string;
  jurisdictionLevel: string | null;
  providerFamily: string;
  approvalState: SourceApprovalState;
  isEnabled: boolean;
  crawlerSourceId: string | null;
}

export interface AdminDataSourceIndexResponse {
  items: AdminDataSourceIndexItem[];
  total: number;
  truncated: boolean;
}

export function isCoverageLevel(value: string): value is CoverageLevel {
  return (COVERAGE_LEVELS as readonly string[]).includes(value);
}

export function coverageLevelOf(value: string | null | undefined): CoverageLevel {
  return typeof value === "string" && isCoverageLevel(value) ? value : "unknown";
}
```

Create `frontend/src/server/admin/data-source-sql.ts`:

```ts
import { COVERAGE_LEVELS } from "./data-source-list-contract";

/*
 * SQL fragments shared by the admin overview, source list, index and detail. Plain SQL that both
 * SQLite and MySQL accept; each fragment is parenthesised so it can be embedded in SELECT, WHERE
 * and GROUP BY alike. They read columns that data_sources has (LEVEL_SQL also works on bids,
 * which carries jurisdiction_level and issuer_type too).
 */
const KNOWN_LEVELS_SQL = COVERAGE_LEVELS.filter((level) => level !== "unknown")
  .map((level) => `'${level}'`)
  .join(", ");

/** Spec §4.2: jurisdiction_level, else issuer_type; anything outside the known levels is 'unknown'. */
export const LEVEL_SQL = `(CASE WHEN COALESCE(jurisdiction_level, issuer_type) IN (${KNOWN_LEVELS_SQL}) THEN COALESCE(jurisdiction_level, issuer_type) ELSE 'unknown' END)`;

/** The orchestrator gate's "local": any level other than federal/state, issuer_type as the fallback. */
export const LOCAL_SOURCE_SQL = `(COALESCE(jurisdiction_level, issuer_type) NOT IN ('federal', 'state'))`;

/** data-sources-repository's defaultProviderFamily for a NULL provider_family. */
export const PLATFORM_SQL = `(COALESCE(provider_family, CASE WHEN issuer_type = 'state' THEN 'state_portal' WHEN issuer_type = 'federal' THEN 'federal_portal' ELSE 'public_portal' END))`;

/** Plan decision 8: the gate's view — NULL approval is approved for federal/state, awaiting for local. */
export const APPROVAL_STATE_SQL = `(CASE WHEN approval_status = 'blocked' THEN 'blocked' WHEN approval_status = 'approved' THEN 'approved' WHEN approval_status = 'needs_review' THEN 'awaiting' WHEN ${LOCAL_SOURCE_SQL} THEN 'awaiting' ELSE 'approved' END)`;

/** Spec §5.1 health, first match wins: disabled > failing > healthy > never_run. */
export const HEALTH_STATE_SQL = `(CASE WHEN is_enabled = 0 THEN 'disabled' WHEN consecutive_failures > 0 THEN 'failing' WHEN last_success_at IS NOT NULL THEN 'healthy' ELSE 'never_run' END)`;
```

- [ ] **Step 4: Write the failing query test**

Create `frontend/src/server/admin/data-source-query.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { emptySourceListFilters, type SourceListFilters } from "./data-source-list-contract";
import {
  DataSourceQueryError,
  likeContainsPattern,
  listAdminDataSourceIndex,
  listAdminDataSourceIndexFromMysql,
  parseSourceListFilters,
  sourceFilterWhere,
} from "./data-source-query";

const NOW = "2026-09-29T08:00:00.000Z";

function row(id: string, overrides: Partial<typeof dataSources.$inferInsert> = {}): typeof dataSources.$inferInsert {
  return {
    id,
    label: id,
    issuerType: "county",
    stateCode: "CO",
    jurisdictionLevel: "county",
    providerFamily: "bidnet",
    isEnabled: 1,
    cadence: "daily",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const ROWS = [
  row("ca_state", { label: "California Cal eProcure", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", lastSuccessAt: NOW }),
  row("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null }),
  row("bidnet_co_denver", { label: "City and County of Denver", jurisdictionName: "Denver", approvalStatus: "approved", lastSuccessAt: NOW }),
  row("bidnet_co_aurora", { label: "City of Aurora", issuerType: "city", jurisdictionLevel: "city", jurisdictionName: "Aurora" }),
  row("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 2, lastFailureAt: NOW }),
  row("bidnet_oh_block", { label: "Blocked County", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
  row("odd_level", { label: "Odd 100% match", issuerType: "municipal", jurisdictionLevel: null, stateCode: "TX", providerFamily: "periscope" }),
];

function filters(overrides: Partial<SourceListFilters>): SourceListFilters {
  return { ...emptySourceListFilters(), ...overrides };
}

describe("parseSourceListFilters", () => {
  it("reads repeated, normalised values", () => {
    const parsed = parseSourceListFilters(
      new URLSearchParams("level=county&level=city&level=county&state=co&state=CO&platform=BidNet&approval=awaiting&health=failing&q=%20den%20"),
    );
    expect(parsed).toEqual({ levels: ["county", "city"], states: ["CO"], platforms: ["bidnet"], approvals: ["awaiting"], healths: ["failing"], q: "den" });
    expect(parseSourceListFilters(new URLSearchParams(""))).toEqual(emptySourceListFilters());
  });

  it.each([
    ["level=galaxy"],
    ["state=Colorado"],
    ["platform=bid%20net"],
    ["approval=maybe"],
    ["health=bad"],
    [`q=${"x".repeat(101)}`],
  ])("rejects %s", (query) => {
    expect(() => parseSourceListFilters(new URLSearchParams(query))).toThrow(DataSourceQueryError);
  });
});

describe("sourceFilterWhere", () => {
  it("is empty without filters and leaves out the excepted dimension", () => {
    expect(sourceFilterWhere(emptySourceListFilters())).toEqual({ sql: "", values: [] });
    const where = sourceFilterWhere(filters({ levels: ["county", "city"], states: ["CO"], q: "Den" }), "level");
    expect(where.sql).toBe(
      "WHERE state_code IN (?) AND (LOWER(id) LIKE ? ESCAPE '!' OR LOWER(label) LIKE ? ESCAPE '!' OR LOWER(COALESCE(jurisdiction_name, '')) LIKE ? ESCAPE '!')",
    );
    expect(where.values).toEqual(["CO", "%den%", "%den%", "%den%"]);
  });

  it("escapes LIKE wildcards", () => {
    expect(likeContainsPattern("100%_!x")).toBe("%100!%!_!!x%");
  });
});

describe("source index", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(ROWS).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const ids = async (applied: Partial<SourceListFilters>) =>
    (await listAdminDataSourceIndex(testDb.db, filters(applied))).items.map((item) => item.id);

  it("lists every source by label with the gate's view of approval", async () => {
    const index = await listAdminDataSourceIndex(testDb.db, emptySourceListFilters());
    expect(index.total).toBe(7);
    expect(index.truncated).toBe(false);
    expect(index.items.map((item) => item.id)).toEqual([
      "bidnet_oh_block",
      "ca_state",
      "bidnet_mi_twp",
      "bidnet_co_denver",
      "bidnet_co_aurora",
      "odd_level",
      "sam_gov",
    ]);
    expect(index.items.find((item) => item.id === "ca_state")).toEqual({
      id: "ca_state",
      label: "California Cal eProcure",
      stateCode: "CA",
      level: "state",
      issuerType: "state",
      jurisdictionLevel: null,
      providerFamily: "state_portal",
      approvalState: "approved",
      isEnabled: true,
      crawlerSourceId: "ca_caleprocure",
    });
    expect(index.items.find((item) => item.id === "sam_gov")).toMatchObject({ level: "federal", providerFamily: "federal_portal", approvalState: "approved" });
    expect(index.items.find((item) => item.id === "odd_level")).toMatchObject({ level: "unknown", approvalState: "awaiting", crawlerSourceId: null });
  });

  it("filters by every dimension", async () => {
    expect(await ids({ levels: ["county"] })).toEqual(["bidnet_oh_block", "bidnet_co_denver"]);
    expect(await ids({ approvals: ["awaiting"] })).toEqual(["bidnet_mi_twp", "bidnet_co_aurora", "odd_level"]);
    expect(await ids({ approvals: ["blocked"] })).toEqual(["bidnet_oh_block"]);
    expect(await ids({ healths: ["never_run"] })).toEqual(["bidnet_co_aurora", "odd_level", "sam_gov"]);
    expect(await ids({ healths: ["failing", "disabled"] })).toEqual(["bidnet_oh_block", "bidnet_mi_twp"]);
    expect(await ids({ platforms: ["state_portal", "federal_portal"] })).toEqual(["ca_state", "sam_gov"]);
    expect(await ids({ states: ["CO"], levels: ["city"] })).toEqual(["bidnet_co_aurora"]);
    expect(await ids({ q: "DENVER" })).toEqual(["bidnet_co_denver"]);
    expect(await ids({ q: "%" })).toEqual(["odd_level"]);
  });

  it("runs the same SQL on MySQL and reads string flags", async () => {
    const query = vi.fn(async () => [[
      { id: "x", label: "X", state_code: "CO", issuer_type: "county", jurisdiction_level: "county", coverage_level: "county", platform: "bidnet", approval_state: "awaiting", is_enabled: "1" },
    ]] as [unknown[]]);
    const index = await listAdminDataSourceIndexFromMysql({ query }, filters({ levels: ["county"] }));
    expect(index.items).toEqual([
      { id: "x", label: "X", stateCode: "CO", level: "county", issuerType: "county", jurisdictionLevel: "county", providerFamily: "bidnet", approvalState: "awaiting", isEnabled: true, crawlerSourceId: null },
    ]);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain("FROM data_sources WHERE");
    expect(sql).toContain("LIMIT 5001");
    expect(values).toEqual(["county"]);
  });
});
```

Run: `cd frontend && npx vitest run src/server/admin/data-source-query.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 5: Implement the query module (filters, WHERE, index)**

Create `frontend/src/server/admin/data-source-query.ts`:

```ts
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";
import type { AppDatabase } from "@/server/db/client";
import {
  COVERAGE_LEVELS,
  SOURCE_APPROVAL_STATES,
  SOURCE_FILTER_MAX_VALUES,
  SOURCE_HEALTH_STATES,
  SOURCE_INDEX_MAX_ROWS,
  SOURCE_LIST_MAX_QUERY_LENGTH,
  coverageLevelOf,
  type AdminDataSourceIndexItem,
  type AdminDataSourceIndexResponse,
  type SourceApprovalState,
  type SourceFacetKey,
  type SourceListFilters,
} from "./data-source-list-contract";
import { APPROVAL_STATE_SQL, HEALTH_STATE_SQL, LEVEL_SQL, PLATFORM_SQL } from "./data-source-sql";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner, type MysqlSqlReader, type SqlValue } from "./sql-runner";

/** A list/index parameter the API cannot honour; routes answer 400 INVALID_REQUEST. */
export class DataSourceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataSourceQueryError";
  }
}

export interface SqlFragment {
  sql: string;
  values: SqlValue[];
}

const STATE_PATTERN = /^[A-Z]{2}$/;
const PLATFORM_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

function distinctValues(params: URLSearchParams, key: string, normalize: (value: string) => string = (value) => value): string[] {
  const values = Array.from(new Set(params.getAll(key).map((value) => normalize(value.trim())).filter(Boolean)));
  if (values.length > SOURCE_FILTER_MAX_VALUES) {
    throw new DataSourceQueryError(`at most ${SOURCE_FILTER_MAX_VALUES} ${key} values`);
  }
  return values;
}

function allowedValues<T extends string>(values: string[], allowed: readonly T[], key: string): T[] {
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) throw new DataSourceQueryError(`unknown ${key}: ${value}`);
  }
  return values as T[];
}

function matchingValues(values: string[], pattern: RegExp, key: string): string[] {
  for (const value of values) {
    if (!pattern.test(value)) throw new DataSourceQueryError(`invalid ${key}: ${value}`);
  }
  return values;
}

/** Spec §5.1 filters, shared by the paginated list and the index. */
export function parseSourceListFilters(params: URLSearchParams): SourceListFilters {
  const q = params.get("q")?.trim() ?? "";
  if (q.length > SOURCE_LIST_MAX_QUERY_LENGTH) {
    throw new DataSourceQueryError(`q must be at most ${SOURCE_LIST_MAX_QUERY_LENGTH} characters`);
  }

  return {
    levels: allowedValues(distinctValues(params, "level"), COVERAGE_LEVELS, "level"),
    states: matchingValues(distinctValues(params, "state", (value) => value.toUpperCase()), STATE_PATTERN, "state"),
    platforms: matchingValues(distinctValues(params, "platform", (value) => value.toLowerCase()), PLATFORM_PATTERN, "platform"),
    approvals: allowedValues(distinctValues(params, "approval"), SOURCE_APPROVAL_STATES, "approval"),
    healths: allowedValues(distinctValues(params, "health"), SOURCE_HEALTH_STATES, "health"),
    q: q || null,
  };
}

/** `%q%` in lower case with LIKE's wildcards escaped by `!` (use with `ESCAPE '!'`). */
export function likeContainsPattern(query: string): string {
  return `%${query.toLowerCase().replace(/[!%_]/g, (character) => `!${character}`)}%`;
}

/** WHERE clause for the filters; `except` leaves one dimension out (facet counts). */
export function sourceFilterWhere(filters: SourceListFilters, except?: SourceFacetKey): SqlFragment {
  const clauses: string[] = [];
  const values: SqlValue[] = [];
  const addIn = (key: SourceFacetKey, expression: string, list: readonly string[]) => {
    if (key === except || list.length === 0) return;
    clauses.push(`${expression} IN (${list.map(() => "?").join(", ")})`);
    values.push(...list);
  };

  addIn("level", LEVEL_SQL, filters.levels);
  addIn("state", "state_code", filters.states);
  addIn("platform", PLATFORM_SQL, filters.platforms);
  addIn("approval", APPROVAL_STATE_SQL, filters.approvals);
  addIn("health", HEALTH_STATE_SQL, filters.healths);
  if (filters.q) {
    const pattern = likeContainsPattern(filters.q);
    clauses.push(
      "(LOWER(id) LIKE ? ESCAPE '!' OR LOWER(label) LIKE ? ESCAPE '!' OR LOWER(COALESCE(jurisdiction_name, '')) LIKE ? ESCAPE '!')",
    );
    values.push(pattern, pattern, pattern);
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "", values };
}

interface IndexRow {
  id: string;
  label: string;
  state_code: string;
  issuer_type: string;
  jurisdiction_level: string | null;
  coverage_level: string;
  platform: string;
  approval_state: string;
  is_enabled: unknown;
}

function toIndexItem(row: IndexRow): AdminDataSourceIndexItem {
  return {
    id: row.id,
    label: row.label,
    stateCode: row.state_code,
    level: coverageLevelOf(row.coverage_level),
    issuerType: row.issuer_type,
    jurisdictionLevel: row.jurisdiction_level ?? null,
    providerFamily: row.platform,
    approvalState: row.approval_state as SourceApprovalState,
    isEnabled: sqlCount(row.is_enabled) === 1,
    crawlerSourceId: stateCrawlerSourceIdForAdminSource({ issuerType: row.issuer_type, stateCode: row.state_code }),
  };
}

/** Every matching source (spec §5.1 index), capped at SOURCE_INDEX_MAX_ROWS. */
export async function listSourceIndex(runner: AdminSqlRunner, filters: SourceListFilters): Promise<AdminDataSourceIndexResponse> {
  const where = sourceFilterWhere(filters);
  const rows = await runner.all<IndexRow>(
    `SELECT id, label, state_code, issuer_type, jurisdiction_level, ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, is_enabled FROM data_sources ${where.sql} ORDER BY LOWER(label) ASC, id ASC LIMIT ${SOURCE_INDEX_MAX_ROWS + 1}`,
    where.values,
  );
  const items = rows.slice(0, SOURCE_INDEX_MAX_ROWS).map(toIndexItem);
  return { items, total: items.length, truncated: rows.length > SOURCE_INDEX_MAX_ROWS };
}

export function listAdminDataSourceIndex(db: AppDatabase, filters: SourceListFilters) {
  return listSourceIndex(sqliteSqlRunner(db), filters);
}

export function listAdminDataSourceIndexFromMysql(mysql: MysqlSqlReader, filters: SourceListFilters) {
  return listSourceIndex(mysqlSqlRunner(mysql), filters);
}
```

Run: `cd frontend && npx vitest run src/server/admin/data-source-query.test.ts` — Expected: PASS.

- [ ] **Step 6: Write the failing route test**

Create `frontend/src/app/api/admin/data-sources/index/route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { createAdminDataSourceIndexGet } from "./route";

const NOW = "2026-09-29T08:00:00.000Z";
const URL_BASE = "http://localhost/api/admin/data-sources/index";

describe("GET /api/admin/data-sources/index", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values([
        { id: "bidnet_co_aurora", label: "City of Aurora", issuerType: "city", stateCode: "CO", jurisdictionLevel: "city", providerFamily: "bidnet", isEnabled: 1, cadence: "daily", createdAt: NOW, updatedAt: NOW },
        { id: "bidnet_co_denver", label: "Denver", issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", providerFamily: "bidnet", approvalStatus: "approved", isEnabled: 1, cadence: "daily", createdAt: NOW, updatedAt: NOW },
      ])
      .run();
  });

  afterEach(async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    await testDb.cleanup();
  });

  it("requires an admin or operator session", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(URL_BASE));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "FORBIDDEN", message: "Admin access is required." } });
  });

  it("returns the filtered index", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(`${URL_BASE}?level=city`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: "bidnet_co_aurora", level: "city", approvalState: "awaiting" })],
      total: 1,
      truncated: false,
    });
  });

  it("answers 400 INVALID_REQUEST for an unknown filter value", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const response = await createAdminDataSourceIndexGet(testDb.db)(new Request(`${URL_BASE}?approval=maybe`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("reads MySQL when a store is injected", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
    const query = vi.fn(async () => [[]] as [unknown[]]);
    const response = await createAdminDataSourceIndexGet(testDb.db, { query })(new Request(URL_BASE));
    expect(response.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
```

Run it — Expected: FAIL (route missing).

- [ ] **Step 7: Implement the route and register it**

Create `frontend/src/app/api/admin/data-sources/index/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  DataSourceQueryError,
  listAdminDataSourceIndex,
  listAdminDataSourceIndexFromMysql,
  parseSourceListFilters,
} from "@/server/admin/data-source-query";
import type { MysqlSqlReader } from "@/server/admin/sql-runner";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }
  if (error instanceof DataSourceQueryError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

/** Spec §5.1: every source matching the list's filters, for "run a whole level/state" and "queue all N". */
export function createAdminDataSourceIndexGet(database?: AppDatabase, mysql?: MysqlSqlReader) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator"] });
      const filters = parseSourceListFilters(new URL(request.url).searchParams);
      return NextResponse.json(
        shouldUseMysqlRuntime()
          ? await listAdminDataSourceIndexFromMysql(mysql ?? resolveMysqlPool(), filters)
          : await listAdminDataSourceIndex(resolvedDb, filters),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourceIndexGet();
```

In `frontend/src/server/auth/role-route-coverage.test.ts`, add `"../../app/api/admin/data-sources/index/route.ts"` to `operatorMutationRoutes` (plan decision 9: the arrays are keyed by role set).

- [ ] **Step 8: Add the client helper**

In `frontend/src/lib/api/admin.ts`:
1. Import the types: `import type { AdminDataSourceIndexResponse, SourceListFilters } from "@/server/admin/data-source-list-contract";` and add both to the `export type { … }` list.
2. Replace `buildQueryString` so it can repeat a key:

```ts
type QueryValue = string | number | readonly string[] | null | undefined;

function buildQueryString(params: Record<string, QueryValue>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") {
      for (const item of value) {
        if (item !== "") searchParams.append(key, item);
      }
      continue;
    }
    searchParams.set(key, String(value));
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function sourceFilterParams(filters: Partial<SourceListFilters>): Record<string, QueryValue> {
  return {
    level: filters.levels,
    state: filters.states,
    platform: filters.platforms,
    approval: filters.approvals,
    health: filters.healths,
    q: filters.q,
  };
}

/** Spec §5.1 index (admin, operator): every source matching the list's filters. */
export async function listAdminDataSourceIndex(filters: Partial<SourceListFilters> = {}) {
  const response = await fetch(`/api/admin/data-sources/index${buildQueryString(sourceFilterParams(filters))}`);

  return parseResponse<AdminDataSourceIndexResponse>(response);
}
```

Add to `frontend/src/lib/api/admin.test.ts` (import `listAdminDataSourceIndex`):

```ts
  it("requests the source index with repeated filter parameters", async () => {
    const body = { items: [], total: 0, truncated: false };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminDataSourceIndex({ levels: ["county", "city"], states: ["CO"], q: "den" })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/index?level=county&level=city&state=CO&q=den");
  });
```

- [ ] **Step 9: Run the tests and gates**

Run: `cd frontend && npx vitest run src/server/admin/sql-runner.test.ts src/server/admin/data-source-query.test.ts src/app/api/admin/data-sources/index/route.test.ts src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts src/lib/api/admin.test.ts`
Expected: PASS. Then `npm run lint` and the non-test type gate.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/server/admin/sql-runner.ts frontend/src/server/admin/sql-runner.test.ts frontend/src/server/admin/data-source-list-contract.ts frontend/src/server/admin/data-source-sql.ts frontend/src/server/admin/data-source-query.ts frontend/src/server/admin/data-source-query.test.ts frontend/src/app/api/admin/data-sources/index frontend/src/server/auth/role-route-coverage.test.ts frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts
git commit -m "feat(admin-api): shared SQL runner, source filters and the data-source index API"
```

---

### Task 7: Overview API

**Files:**
- Modify: `frontend/src/server/crawler/source-registry.ts`, `source-registry.test.ts`
- Modify: `frontend/src/server/crawler/platform-deferral.ts`, `platform-deferral.test.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts`, `data-sources-repository.test.ts`
- Modify: `frontend/src/server/admin/data-source-sql.ts`
- Create: `frontend/src/server/admin/overview.ts`, `overview.test.ts`
- Create: `frontend/src/app/api/admin/overview/route.ts`, `route.test.ts`
- Modify: `frontend/src/server/auth/role-route-coverage.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`, `admin.test.ts`

**Interfaces:**
- Consumes: Task 6's runner, contract and fragments; `summarizeApprovalReadiness`, `ApprovalReadinessBucket` (`./ledgered-approval`); `listPlatformReviews`, `listPlatformReviewsFromMysql`, `EffectivePlatformReview`, `PlatformReview`, `MysqlPlatformReviewsStore` (`./platform-reviews-repository`); `isSyntheticProviderFamily` (`./synthetic-provider-families`, added by the phase-3 fix wave); `listAdminBidQaItems`, `listAdminBidQaItemsFromMysql` (`./bid-qa-repository`).
- Produces:
  - `CRAWLABLE_SOURCE_WHERE_SQL` (source-registry), `SCHEDULED_SQL` (data-source-sql).
  - `isThrottleFailure({ errorCode, errorMessage }): boolean` (platform-deferral).
  - `listLocalLedgerSources(db)`, `listLocalLedgerSourcesFromMysql(mysql)` → `AdminDataSource[]` (local rows, no logs/events/health).
  - `AdminOverview` and its section types; `computeAdminOverview(deps)`, `getAdminOverview(db, now?)`, `getAdminOverviewFromMysql(mysql, now?)`, `AdminOverviewMysqlStore`; exported SQL constants and fold helpers.
  - Route `GET /api/admin/overview` (console read).
  - Client `getAdminOverview()`.

- [ ] **Step 1: Extract the scheduler predicate and pin it**

In `frontend/src/server/crawler/source-registry.ts`, add above `listCrawlableSourcesFromMysql`:

```ts
/**
 * The scheduler's governance predicate as SQL. listCrawlableSourcesFromMysql uses it verbatim and
 * the admin overview counts "in the crawl schedule" with it on both runtimes (spec 2026-09-29 §4.2).
 * It must stay equivalent to listCrawlableSources' Drizzle predicate; source-registry.test.ts pins
 * the two against the same rows.
 */
export const CRAWLABLE_SOURCE_WHERE_SQL = `is_enabled = 1
        AND (approved_for_ingestion IS NULL OR approved_for_ingestion = 1)
        AND (
          approval_status = 'approved'
          OR (
            approval_status IS NULL
            AND ((jurisdiction_level IS NULL AND issuer_type IN ('federal', 'state')) OR jurisdiction_level IN ('federal', 'state'))
          )
        )
        AND (legal_review_status IS NULL OR legal_review_status IN ('approved_public', 'approved'))`;
```

and change `listCrawlableSourcesFromMysql`'s query to `WHERE ${CRAWLABLE_SOURCE_WHERE_SQL}` (same text, no behaviour change).

Append to `frontend/src/server/crawler/source-registry.test.ts` (it already has `sourceRow`):

```ts
describe("CRAWLABLE_SOURCE_WHERE_SQL", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("selects exactly the rows listCrawlableSources returns", () => {
    testDb.db
      .insert(dataSources)
      .values([
        sourceRow({ id: "approved_state" }),
        sourceRow({ id: "null_state", approvalStatus: null, approvedForIngestion: null, legalReviewStatus: null }),
        sourceRow({ id: "federal", issuerType: "federal", stateCode: "US", approvalStatus: null }),
        sourceRow({ id: "held_state", approvalStatus: "needs_review" }),
        sourceRow({ id: "disabled", isEnabled: 0 }),
        sourceRow({ id: "denied", approvedForIngestion: 0 }),
        sourceRow({ id: "legal_restricted", legalReviewStatus: "restricted" }),
        sourceRow({ id: "county_null", issuerType: "county", jurisdictionLevel: "county", approvalStatus: null }),
        sourceRow({ id: "county_approved", issuerType: "county", jurisdictionLevel: "county" }),
        sourceRow({ id: "legacy_county", issuerType: "county", jurisdictionLevel: null, approvalStatus: null }),
        sourceRow({ id: "state_level", issuerType: "county", jurisdictionLevel: "state", approvalStatus: null }),
      ])
      .run();

    const viaDrizzle = listCrawlableSources(testDb.db).map((source) => source.id).sort();
    const viaSql = (testDb.db.$client.prepare(`SELECT id FROM data_sources WHERE ${CRAWLABLE_SOURCE_WHERE_SQL}`).all() as { id: string }[])
      .map((row) => row.id)
      .sort();
    expect(viaSql).toEqual(viaDrizzle);
    expect(viaSql).toEqual(["approved_state", "county_approved", "federal", "null_state", "state_level"]);
  });
});
```

(`CrawlableSource` exposes the row id as `id`; if its field is named differently, map that field.) Import `CRAWLABLE_SOURCE_WHERE_SQL` at the top of the test.

- [ ] **Step 2: Extract the throttle check**

In `frontend/src/server/crawler/platform-deferral.ts`, `isPlatformThrottleSignature` is `if (result.status !== "failure") return false; const input = buildCrawlerFailureInput(result.runner);` followed by the throttle checks (the challenge-error code check, then — after the phase-3 fix wave — the `HtmlPageError` check where the FIRST status token of the message decides). Move those checks, unchanged, into a new exported function and call it:

```ts
/** isPlatformThrottleSignature's check for a failed run's error code and message — a crawler_logs row stores both. */
export function isThrottleFailure(input: { errorCode: string | null; errorMessage: string | null }): boolean {
  // the statements that followed `const input = buildCrawlerFailureInput(result.runner);`, moved verbatim
}

export function isPlatformThrottleSignature(result: RunCrawlerSourceOnceResult): boolean {
  if (result.status !== "failure") return false;
  const input = buildCrawlerFailureInput(result.runner);
  return isThrottleFailure({ errorCode: input.errorCode ?? null, errorMessage: input.errorMessage ?? null });
}
```

Every existing `isPlatformThrottleSignature` test must still pass unchanged. Append to `platform-deferral.test.ts`:

```ts
describe("isThrottleFailure", () => {
  it("applies the platform throttle rule to a log row's code and message", () => {
    expect(isThrottleFailure({ errorCode: "BidNetChallengeError", errorMessage: null })).toBe(true);
    expect(isThrottleFailure({ errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 429: slow down" })).toBe(true);
    expect(isThrottleFailure({ errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 404: body says code 403" })).toBe(false);
    expect(isThrottleFailure({ errorCode: "EmptyCrawlerResultError", errorMessage: "status 429" })).toBe(false);
    expect(isThrottleFailure({ errorCode: null, errorMessage: null })).toBe(false);
  });
});
```

- [ ] **Step 3: Add the light local-source loader**

In `frontend/src/server/admin/data-sources-repository.ts` add (import `and`, `isNotNull`, `notInArray` from `drizzle-orm`):

```ts
/**
 * Local (gated) rows as full DTOs without logs, live health or approval history — the governance
 * inputs of the ledgered readiness rules, for the admin overview's pipeline (plan decision 7).
 */
export async function listLocalLedgerSources(db: AppDatabase): Promise<AdminDataSource[]> {
  return db
    .select()
    .from(dataSources)
    .where(and(isNotNull(dataSources.jurisdictionLevel), notInArray(dataSources.jurisdictionLevel, ["federal", "state"])))
    .orderBy(dataSources.label)
    .all()
    .map((row) => toAdminSource(row, null));
}

export async function listLocalLedgerSourcesFromMysql(mysql: MysqlDataSourcesStore): Promise<AdminDataSource[]> {
  const rows = await mysqlSelectMany<DataSourceRow>(
    mysql,
    `${dataSourceSelectSql("WHERE jurisdiction_level IS NOT NULL AND jurisdiction_level NOT IN ('federal', 'state')")} ORDER BY label ASC`,
  );
  return rows.map((row) => toAdminSource(row, null));
}
```

Add a test to `data-sources-repository.test.ts`: with one state row, one county row (`approval_status` NULL) and one city row (`approved`), `listLocalLedgerSources` returns the county and city ids only, the county's `approvalStatus` is `"needs_review"` (phase-3 held default) and `approvalHistory` is `[]`; the MySQL twin's SQL (fake store) contains `jurisdiction_level NOT IN ('federal', 'state')`.

- [ ] **Step 4: Add the scheduled fragment**

Append to `frontend/src/server/admin/data-source-sql.ts`:

```ts
import { CRAWLABLE_SOURCE_WHERE_SQL } from "@/server/crawler/source-registry";

/** Spec §4.2 "in the crawl schedule": the scheduler's own predicate. */
export const SCHEDULED_SQL = `(${CRAWLABLE_SOURCE_WHERE_SQL})`;
```

(Move the import to the top of the file.)

- [ ] **Step 5: Write the failing overview test**

Create `frontend/src/server/admin/overview.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bids, crawlerLogs, dataSources, platformReviews } from "@/server/db/schema";
import { COVERAGE_SQL, computeAdminOverview, getAdminOverview, getAdminOverviewFromMysql } from "./overview";
import { sqliteSqlRunner, type AdminSqlRunner, type SqlValue } from "./sql-runner";

const NOW = new Date("2026-09-29T12:00:00.000Z");
const T = NOW.toISOString();

function source(id: string, overrides: Partial<typeof dataSources.$inferInsert>): typeof dataSources.$inferInsert {
  return { id, label: id, issuerType: "county", stateCode: "CO", jurisdictionLevel: "county", providerFamily: "bidnet", isEnabled: 1, cadence: "daily", createdAt: T, updatedAt: T, ...overrides };
}

function log(id: string, overrides: Partial<typeof crawlerLogs.$inferInsert>): typeof crawlerLogs.$inferInsert {
  return { id, source: "bidnet_co_denver", runId: id, status: "success", startedAt: T, ...overrides };
}

function bid(id: string, overrides: Partial<typeof bids.$inferInsert>): typeof bids.$inferInsert {
  return {
    id,
    source: "Denver",
    sourceBidId: id,
    dedupeKey: id,
    title: `Bid ${id}`,
    description: "Description",
    issuerName: "Agency",
    issuerType: "state",
    stateCode: "CO",
    sourceUrl: `https://example.gov/${id}`,
    firstSeenAt: T,
    lastSeenAt: T,
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

function seed(testDb: TestDatabase) {
  testDb.db.insert(dataSources).values([
    source("ca_state", { label: "California", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", lastSuccessAt: T }),
    source("tx_state", { label: "Texas", issuerType: "state", stateCode: "TX", jurisdictionLevel: null, providerFamily: null }),
    source("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null, consecutiveFailures: 1, lastFailureAt: T }),
    source("bidnet_co_denver", { label: "Denver", approvalStatus: "approved", approvedForIngestion: 1, legalReviewStatus: "approved_public", lastSuccessAt: T }),
    source("bidnet_co_aurora", { label: "Aurora", issuerType: "city", jurisdictionLevel: "city", precheckRequestedAt: "2026-09-29T01:00:00.000Z" }),
    source("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 3, lastFailureAt: T }),
    source("bidnet_oh_block", { label: "Blocked", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
    source("odd", { label: "Odd", issuerType: "municipal", stateCode: "TX", jurisdictionLevel: null, providerFamily: null }),
    source("own_site_city", { label: "Own Site City", issuerType: "city", stateCode: "TX", jurisdictionLevel: "city", providerFamily: null }),
  ]).run();

  testDb.db.insert(crawlerLogs).values([
    log("l1", { source: "bidnet_co_denver", status: "success", startedAt: "2026-09-29T10:00:00.000000+00:00" }),
    log("l2", { source: "SAM.gov", status: "failure", startedAt: "2026-09-29T09:00:00.000Z", errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 429: Too Many Requests" }),
    log("l3", { source: "bidnet_mi_twp", status: "failure", startedAt: "2026-09-27T09:00:00.000Z", errorCode: "BidNetChallengeError", errorMessage: "challenge" }),
    log("l4", { source: "attachment_repair", status: "failure", startedAt: "2026-09-29T11:00:00.000Z" }),
    log("l5", { source: "ca_caleprocure", status: "success", startedAt: "2026-09-10T00:00:00.000Z" }),
    log("l6", { source: "bidnet_co_denver", status: "partial", startedAt: "2026-09-29T08:00:00.000Z" }),
    log("l7", { source: "bidnet_mi_twp", status: "failure", startedAt: "2026-09-29T07:00:00.000Z", errorCode: "HtmlPageError", errorMessage: "HTML request failed with status 404: page mentions code 403" }),
  ]).run();

  testDb.db.insert(bids).values([
    bid("bidnet_co_denver:1", { lifecycleStatus: "open", jurisdictionLevel: "county", createdAt: "2026-09-29T06:00:00.000Z" }),
    bid("bidnet_co_denver:2", { lifecycleStatus: "open", jurisdictionLevel: "county", createdAt: "2026-09-25T00:00:00.000Z" }),
    bid("ca_state:1", { lifecycleStatus: "open", stateCode: "CA", createdAt: "2026-09-01T00:00:00.000Z" }),
    bid("ca_state:2", { lifecycleStatus: "closed", stateCode: "CA", createdAt: "2026-09-28T13:00:00.000Z" }),
    bid("sam_gov:1", { lifecycleStatus: "awarded", issuerType: "federal", stateCode: "US", adminReviewStatus: "needs_review", createdAt: "2026-08-01T00:00:00.000Z" }),
  ]).run();

  testDb.db.insert(platformReviews).values({
    id: "review_1",
    providerFamily: "bidnet",
    tosUrl: "https://www.bidnetdirect.com/tsandcs",
    tosReviewedAt: "2026-09-20T00:00:00.000Z",
    robotsUrl: "https://www.bidnetdirect.com/robots.txt",
    robotsCheckedAt: "2026-09-20T00:00:00.000Z",
    robotsSummary: "allows public lists",
    accessBoundary: "只读公开列表与详情页；不登录、不取会员内容、不绕 WAF",
    reviewer: "ops@example.com",
    reviewedAt: "2026-09-20T00:00:00.000Z",
    nextReviewAt: "2027-09-20T00:00:00.000Z",
    createdAt: "2026-09-20T00:00:00.000Z",
  }).run();
}

describe("admin overview (SQLite)", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    seed(testDb);
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("counts coverage by level and state with the gate's definitions", async () => {
    const { coverage, errors } = await getAdminOverview(testDb.db, NOW);
    expect(errors).toEqual({});
    expect(coverage?.totals).toEqual({ sources: 9, scheduled: 4, awaitingApproval: 4, neverRun: 5 });
    expect(coverage?.byLevel).toEqual([
      { level: "federal", total: 1, enabled: 1, approved: 0, awaitingApproval: 0, blocked: 0, neverRun: 0 },
      { level: "state", total: 2, enabled: 2, approved: 1, awaitingApproval: 0, blocked: 0, neverRun: 1 },
      { level: "county", total: 2, enabled: 1, approved: 1, awaitingApproval: 0, blocked: 1, neverRun: 1 },
      { level: "city", total: 2, enabled: 2, approved: 0, awaitingApproval: 2, blocked: 0, neverRun: 2 },
      { level: "township", total: 1, enabled: 1, approved: 0, awaitingApproval: 1, blocked: 0, neverRun: 0 },
      { level: "unknown", total: 1, enabled: 1, approved: 0, awaitingApproval: 1, blocked: 0, neverRun: 1 },
    ]);
    expect(coverage?.byState.map((state) => [state.stateCode, state.total])).toEqual([
      ["TX", 3],
      ["CO", 2],
      ["CA", 1],
      ["MI", 1],
      ["OH", 1],
      ["US", 1],
    ]);
    expect(coverage?.byState[0].byLevel).toEqual({ state: 1, unknown: 1, city: 1 });
  });

  it("summarises the onboarding pipeline per real platform", async () => {
    const { pipeline } = await getAdminOverview(testDb.db, NOW);
    expect(pipeline).toEqual([
      {
        providerFamily: "bidnet",
        platformReview: { status: "valid", review: expect.objectContaining({ id: "review_1" }) },
        counts: { approvable: 0, awaiting_precheck: 2, needs_fix: 0, missing_platform_review: 0, approved: 1, blocked: 1 },
        queued: 1,
        oldestQueuedAt: "2026-09-29T01:00:00.000Z",
      },
    ]);
  });

  it("summarises crawl health without attachment repair runs", async () => {
    const { crawlHealth } = await getAdminOverview(testDb.db, NOW);
    expect(crawlHealth).toEqual({
      runs24h: { success: 1, failure: 2, other: 1 },
      runs7d: { success: 1, failure: 3, other: 1 },
      lastRunAt: "2026-09-29T10:00:00.000000+00:00",
      failingSources: 2,
      worstFailing: [
        { id: "bidnet_mi_twp", label: "Canton Township", consecutiveFailures: 3, lastFailureAt: T },
        { id: "sam_gov", label: "SAM.gov", consecutiveFailures: 1, lastFailureAt: T },
      ],
      throttleEvents24h: 1,
    });
  });

  it("summarises bids by lifecycle, recency and source level", async () => {
    const { bids: bidSummary } = await getAdminOverview(testDb.db, NOW);
    expect(bidSummary).toEqual({ open: 3, closed: 1, awarded: 1, new24h: 2, new7d: 3, openByLevel: { county: 2, state: 1 }, pendingQa: 1 });
  });

  it("keeps the other sections when one fails", async () => {
    const sqlite = sqliteSqlRunner(testDb.db);
    const failingOnBids: AdminSqlRunner = {
      all<T>(sql: string, values?: readonly SqlValue[]) {
        return sql.includes("FROM bids") ? Promise.reject(new Error("boom")) : sqlite.all<T>(sql, values);
      },
    };
    const onSectionError = vi.fn();
    const overview = await computeAdminOverview({
      sql: failingOnBids,
      listLedgerSources: async () => [],
      listPlatformReviews: async () => [],
      bidQaNeedsReview: async () => 0,
      now: NOW,
      onSectionError,
    });
    expect(overview.bids).toBeNull();
    expect(overview.errors).toEqual({ bids: { code: "SECTION_FAILED", message: "This section could not be computed." } });
    expect(overview.coverage?.totals.sources).toBe(9);
    expect(onSectionError).toHaveBeenCalledWith("bids", expect.any(Error));
  });
});

describe("admin overview (MySQL)", () => {
  it("runs the shared SQL and reads mysql2's string numbers", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === COVERAGE_SQL) {
        return [[{ coverage_level: "county", state_code: "CO", total: "3", enabled: "2", approved: "1", blocked: "0", awaiting_approval: "2", never_run: "1", scheduled: "1" }]];
      }
      return [[]];
    });
    const overview = await getAdminOverviewFromMysql({ query, execute: vi.fn() } as never, NOW);
    expect(overview.coverage?.totals).toEqual({ sources: 3, scheduled: 1, awaitingApproval: 2, neverRun: 1 });
    expect(overview.pipeline).toEqual([]);
    expect(overview.bids).toMatchObject({ open: 0, pendingQa: 0 });
    expect(query.mock.calls.map((call) => call[0])).toContain(COVERAGE_SQL);
  });
});
```

(If a `NOT NULL` column of `crawlerLogs`, `bids` or `platformReviews` is missing from these fixtures, add it with a neutral value — the migration in `migrate.ts` is the authority.)

Run: `cd frontend && npx vitest run src/server/admin/overview.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 6: Implement the overview**

Create `frontend/src/server/admin/overview.ts`:

```ts
import type { AppDatabase } from "@/server/db/client";
import { isThrottleFailure } from "@/server/crawler/platform-deferral";
import { listAdminBidQaItems, listAdminBidQaItemsFromMysql } from "./bid-qa-repository";
import { COVERAGE_LEVELS, coverageLevelOf, type CoverageLevel } from "./data-source-list-contract";
import { LEVEL_SQL, LOCAL_SOURCE_SQL, SCHEDULED_SQL } from "./data-source-sql";
import {
  listLocalLedgerSources,
  listLocalLedgerSourcesFromMysql,
  type AdminDataSource,
  type MysqlDataSourcesStore,
} from "./data-sources-repository";
import { summarizeApprovalReadiness, type ApprovalReadinessBucket } from "./ledgered-approval";
import {
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner } from "./sql-runner";
import { isSyntheticProviderFamily } from "./synthetic-provider-families";

export interface CoverageLevelCounts {
  level: CoverageLevel;
  total: number;
  enabled: number;
  approved: number;
  awaitingApproval: number;
  blocked: number;
  neverRun: number;
}

export interface AdminOverviewCoverage {
  totals: { sources: number; scheduled: number; awaitingApproval: number; neverRun: number };
  byLevel: CoverageLevelCounts[];
  byState: Array<{ stateCode: string; total: number; byLevel: Partial<Record<CoverageLevel, number>> }>;
}

export interface AdminOverviewPipelineRow {
  providerFamily: string;
  platformReview: EffectivePlatformReview;
  counts: Record<ApprovalReadinessBucket, number>;
  queued: number;
  oldestQueuedAt: string | null;
}

export interface AdminOverviewRunCounts {
  success: number;
  failure: number;
  other: number;
}

export interface AdminOverviewCrawlHealth {
  runs24h: AdminOverviewRunCounts;
  runs7d: AdminOverviewRunCounts;
  lastRunAt: string | null;
  failingSources: number;
  worstFailing: Array<{ id: string; label: string; consecutiveFailures: number; lastFailureAt: string | null }>;
  throttleEvents24h: number;
}

export interface AdminOverviewBids {
  open: number;
  closed: number;
  awarded: number;
  new24h: number;
  new7d: number;
  openByLevel: Partial<Record<CoverageLevel, number>>;
  pendingQa: number;
}

export type AdminOverviewSectionKey = "coverage" | "pipeline" | "crawlHealth" | "bids";

export interface AdminOverviewSectionError {
  code: "SECTION_FAILED";
  message: string;
}

export interface AdminOverview {
  generatedAt: string;
  coverage: AdminOverviewCoverage | null;
  pipeline: AdminOverviewPipelineRow[] | null;
  crawlHealth: AdminOverviewCrawlHealth | null;
  bids: AdminOverviewBids | null;
  errors: Partial<Record<AdminOverviewSectionKey, AdminOverviewSectionError>>;
}

export const COVERAGE_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, state_code AS state_code, COUNT(*) AS total, SUM(CASE WHEN is_enabled = 1 THEN 1 ELSE 0 END) AS enabled, SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN approval_status = 'blocked' THEN 1 ELSE 0 END) AS blocked, SUM(CASE WHEN ${LOCAL_SOURCE_SQL} AND (approval_status IS NULL OR approval_status = 'needs_review') THEN 1 ELSE 0 END) AS awaiting_approval, SUM(CASE WHEN last_success_at IS NULL AND last_failure_at IS NULL THEN 1 ELSE 0 END) AS never_run, SUM(CASE WHEN ${SCHEDULED_SQL} THEN 1 ELSE 0 END) AS scheduled FROM data_sources GROUP BY ${LEVEL_SQL}, state_code`;

export const CRAWL_RUNS_SQL = `SELECT status, SUM(CASE WHEN started_at >= ? THEN 1 ELSE 0 END) AS last_24h, COUNT(*) AS last_7d FROM crawler_logs WHERE source <> 'attachment_repair' AND started_at >= ? GROUP BY status`;
export const LAST_RUN_SQL = `SELECT MAX(started_at) AS last_run_at FROM crawler_logs WHERE source <> 'attachment_repair'`;
export const FAILING_COUNT_SQL = `SELECT COUNT(*) AS failing FROM data_sources WHERE is_enabled = 1 AND consecutive_failures > 0`;
export const WORST_FAILING_SQL = `SELECT id, label, consecutive_failures, last_failure_at FROM data_sources WHERE is_enabled = 1 AND consecutive_failures > 0 ORDER BY consecutive_failures DESC, last_failure_at DESC, id ASC LIMIT 5`;
export const THROTTLE_CANDIDATES_SQL = `SELECT error_code, error_message FROM crawler_logs WHERE status = 'failure' AND source <> 'attachment_repair' AND started_at >= ? AND (error_code = 'HtmlPageError' OR error_code LIKE '%ChallengeError')`;
export const BIDS_BY_LIFECYCLE_SQL = `SELECT lifecycle_status, COUNT(*) AS total, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_24h, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS new_7d FROM bids GROUP BY lifecycle_status`;
export const OPEN_BIDS_BY_LEVEL_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, COUNT(*) AS total FROM bids WHERE lifecycle_status = 'open' GROUP BY ${LEVEL_SQL}`;

interface CoverageRow {
  coverage_level: string;
  state_code: string;
  total: unknown;
  enabled: unknown;
  approved: unknown;
  blocked: unknown;
  awaiting_approval: unknown;
  never_run: unknown;
  scheduled: unknown;
}

export function foldCoverage(rows: readonly CoverageRow[]): AdminOverviewCoverage {
  const totals = { sources: 0, scheduled: 0, awaitingApproval: 0, neverRun: 0 };
  const byLevel = new Map<CoverageLevel, CoverageLevelCounts>();
  const byState = new Map<string, { stateCode: string; total: number; byLevel: Partial<Record<CoverageLevel, number>> }>();

  for (const row of rows) {
    const level = coverageLevelOf(row.coverage_level);
    const total = sqlCount(row.total);
    const awaitingApproval = sqlCount(row.awaiting_approval);
    const neverRun = sqlCount(row.never_run);
    totals.sources += total;
    totals.scheduled += sqlCount(row.scheduled);
    totals.awaitingApproval += awaitingApproval;
    totals.neverRun += neverRun;

    const levelEntry = byLevel.get(level) ?? { level, total: 0, enabled: 0, approved: 0, awaitingApproval: 0, blocked: 0, neverRun: 0 };
    levelEntry.total += total;
    levelEntry.enabled += sqlCount(row.enabled);
    levelEntry.approved += sqlCount(row.approved);
    levelEntry.awaitingApproval += awaitingApproval;
    levelEntry.blocked += sqlCount(row.blocked);
    levelEntry.neverRun += neverRun;
    byLevel.set(level, levelEntry);

    const stateEntry = byState.get(row.state_code) ?? { stateCode: row.state_code, total: 0, byLevel: {} };
    stateEntry.total += total;
    stateEntry.byLevel[level] = (stateEntry.byLevel[level] ?? 0) + total;
    byState.set(row.state_code, stateEntry);
  }

  return {
    totals,
    byLevel: COVERAGE_LEVELS.flatMap((level) => {
      const entry = byLevel.get(level);
      return entry ? [entry] : [];
    }),
    byState: [...byState.values()].sort((a, b) => b.total - a.total || a.stateCode.localeCompare(b.stateCode)),
  };
}

export function buildPipeline(sources: readonly AdminDataSource[], reviews: readonly PlatformReview[], now: Date): AdminOverviewPipelineRow[] {
  const families = [...new Set(sources.map((source) => source.providerFamily))]
    .filter((family) => !isSyntheticProviderFamily(family))
    .sort((a, b) => a.localeCompare(b));

  return families.map((family) => {
    const summary = summarizeApprovalReadiness(sources, reviews, now, family);
    const queuedAt = sources
      .filter((source) => source.providerFamily === family && source.precheckRequestedAt)
      .map((source) => source.precheckRequestedAt as string)
      .sort();
    return {
      providerFamily: family,
      platformReview: summary.platformReview ?? { status: "missing", review: null },
      counts: summary.counts,
      queued: queuedAt.length,
      oldestQueuedAt: queuedAt[0] ?? null,
    };
  });
}

export function foldRuns(rows: ReadonlyArray<{ status: string; last_24h: unknown; last_7d: unknown }>) {
  const runs24h: AdminOverviewRunCounts = { success: 0, failure: 0, other: 0 };
  const runs7d: AdminOverviewRunCounts = { success: 0, failure: 0, other: 0 };
  for (const row of rows) {
    const key: keyof AdminOverviewRunCounts = row.status === "success" ? "success" : row.status === "failure" ? "failure" : "other";
    runs24h[key] += sqlCount(row.last_24h);
    runs7d[key] += sqlCount(row.last_7d);
  }
  return { runs24h, runs7d };
}

export function foldBids(
  lifecycleRows: ReadonlyArray<{ lifecycle_status: string; total: unknown; new_24h: unknown; new_7d: unknown }>,
  levelRows: ReadonlyArray<{ coverage_level: string; total: unknown }>,
  pendingQa: number,
): AdminOverviewBids {
  const summary: AdminOverviewBids = { open: 0, closed: 0, awarded: 0, new24h: 0, new7d: 0, openByLevel: {}, pendingQa };
  for (const row of lifecycleRows) {
    if (row.lifecycle_status === "open" || row.lifecycle_status === "closed" || row.lifecycle_status === "awarded") {
      summary[row.lifecycle_status] += sqlCount(row.total);
    }
    summary.new24h += sqlCount(row.new_24h);
    summary.new7d += sqlCount(row.new_7d);
  }
  for (const row of levelRows) {
    const level = coverageLevelOf(row.coverage_level);
    summary.openByLevel[level] = (summary.openByLevel[level] ?? 0) + sqlCount(row.total);
  }
  return summary;
}

export interface AdminOverviewDependencies {
  sql: AdminSqlRunner;
  listLedgerSources: () => Promise<AdminDataSource[]>;
  listPlatformReviews: () => Promise<PlatformReview[]>;
  bidQaNeedsReview: () => Promise<number>;
  now: Date;
  onSectionError?: (section: AdminOverviewSectionKey, error: unknown) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SECTION_FAILED_MESSAGE = "This section could not be computed.";

export async function computeAdminOverview(deps: AdminOverviewDependencies): Promise<AdminOverview> {
  const errors: AdminOverview["errors"] = {};
  const since24h = new Date(deps.now.getTime() - DAY_MS).toISOString();
  const since7d = new Date(deps.now.getTime() - 7 * DAY_MS).toISOString();
  const reportError =
    deps.onSectionError ?? ((section: AdminOverviewSectionKey, error: unknown) => console.error(`[admin-overview] ${section} failed`, error));

  async function section<T>(key: AdminOverviewSectionKey, compute: () => Promise<T>): Promise<T | null> {
    try {
      return await compute();
    } catch (error) {
      reportError(key, error);
      errors[key] = { code: "SECTION_FAILED", message: SECTION_FAILED_MESSAGE };
      return null;
    }
  }

  const [coverage, pipeline, crawlHealth, bids] = await Promise.all([
    section("coverage", async () => foldCoverage(await deps.sql.all<CoverageRow>(COVERAGE_SQL))),
    section("pipeline", async () => buildPipeline(await deps.listLedgerSources(), await deps.listPlatformReviews(), deps.now)),
    section("crawlHealth", async () => {
      const [runRows, lastRunRows, failingRows, worstRows, throttleRows] = await Promise.all([
        deps.sql.all<{ status: string; last_24h: unknown; last_7d: unknown }>(CRAWL_RUNS_SQL, [since24h, since7d]),
        deps.sql.all<{ last_run_at: string | null }>(LAST_RUN_SQL),
        deps.sql.all<{ failing: unknown }>(FAILING_COUNT_SQL),
        deps.sql.all<{ id: string; label: string; consecutive_failures: unknown; last_failure_at: string | null }>(WORST_FAILING_SQL),
        deps.sql.all<{ error_code: string | null; error_message: string | null }>(THROTTLE_CANDIDATES_SQL, [since24h]),
      ]);
      return {
        ...foldRuns(runRows),
        lastRunAt: lastRunRows[0]?.last_run_at ?? null,
        failingSources: sqlCount(failingRows[0]?.failing),
        worstFailing: worstRows.map((row) => ({
          id: row.id,
          label: row.label,
          consecutiveFailures: sqlCount(row.consecutive_failures),
          lastFailureAt: row.last_failure_at ?? null,
        })),
        throttleEvents24h: throttleRows.filter((row) => isThrottleFailure({ errorCode: row.error_code, errorMessage: row.error_message })).length,
      };
    }),
    section("bids", async () => {
      const [lifecycleRows, levelRows, pendingQa] = await Promise.all([
        deps.sql.all<{ lifecycle_status: string; total: unknown; new_24h: unknown; new_7d: unknown }>(BIDS_BY_LIFECYCLE_SQL, [since24h, since7d]),
        deps.sql.all<{ coverage_level: string; total: unknown }>(OPEN_BIDS_BY_LEVEL_SQL),
        deps.bidQaNeedsReview(),
      ]);
      return foldBids(lifecycleRows, levelRows, pendingQa);
    }),
  ]);

  return { generatedAt: deps.now.toISOString(), coverage, pipeline, crawlHealth, bids, errors };
}

export function getAdminOverview(db: AppDatabase, now = new Date()): Promise<AdminOverview> {
  return computeAdminOverview({
    sql: sqliteSqlRunner(db),
    listLedgerSources: () => listLocalLedgerSources(db),
    listPlatformReviews: async () => listPlatformReviews(db),
    bidQaNeedsReview: async () => (await listAdminBidQaItems(db, { limit: 1 })).summary.needsReview,
    now,
  });
}

export type AdminOverviewMysqlStore = MysqlDataSourcesStore &
  MysqlPlatformReviewsStore &
  Parameters<typeof listAdminBidQaItemsFromMysql>[0];

export function getAdminOverviewFromMysql(mysql: AdminOverviewMysqlStore, now = new Date()): Promise<AdminOverview> {
  return computeAdminOverview({
    sql: mysqlSqlRunner(mysql),
    listLedgerSources: () => listLocalLedgerSourcesFromMysql(mysql),
    listPlatformReviews: () => listPlatformReviewsFromMysql(mysql),
    bidQaNeedsReview: async () => (await listAdminBidQaItemsFromMysql(mysql, { limit: 1 })).summary.needsReview,
    now,
  });
}
```

Run: `cd frontend && npx vitest run src/server/admin/overview.test.ts` — Expected: PASS. If the pipeline counts differ from the test because the phase-3 fix wave's `evaluateLedgeredApproval` reads a governance field the seed does not set, fix the seed (not the rule) and say so in your report.

- [ ] **Step 7: Route, registration and client helper**

Create `frontend/src/app/api/admin/overview/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import { getAdminOverview, getAdminOverviewFromMysql, type AdminOverviewMysqlStore } from "@/server/admin/overview";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

/** Spec §4.1: the admin overview; a failed section comes back null with errors[section]. */
export function createAdminOverviewGet(database?: AppDatabase, mysql?: AdminOverviewMysqlStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      return NextResponse.json(
        shouldUseMysqlRuntime() ? await getAdminOverviewFromMysql(mysql ?? resolveMysqlPool()) : await getAdminOverview(resolvedDb),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminOverviewGet();
```

Create `frontend/src/app/api/admin/overview/route.test.ts` with three cases, following Task 6's index route test: 403 `FORBIDDEN` without the bypass; 200 with `ADMIN_UI_LOCAL_BYPASS=true` on an empty SQLite database whose body has `generatedAt`, `coverage.totals.sources === 0`, `pipeline: []`, `errors: {}`; and an injected fake MySQL store (`{ query: vi.fn(async () => [[]]), execute: vi.fn() }`) that is called.

Add `"../../app/api/admin/overview/route.ts"` to `consoleReadRoutes` in `role-route-coverage.test.ts`.

In `frontend/src/lib/api/admin.ts` import `type AdminOverview` (and the section types) from `@/server/admin/overview`, re-export them, and add:

```ts
/** Spec §4: the overview's four blocks; a null block failed on the server (see `errors`). */
export async function getAdminOverview() {
  const response = await fetch("/api/admin/overview");

  return parseResponse<AdminOverview>(response);
}
```

with an `admin.test.ts` case asserting the fetch URL `/api/admin/overview` and the parsed body.

- [ ] **Step 8: Run the tests and gates**

Run: `cd frontend && npx vitest run src/server/crawler/source-registry.test.ts src/server/crawler/platform-deferral.test.ts src/server/admin src/app/api/admin/overview src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts src/lib/api/admin.test.ts`
Expected: PASS. Then `npm run lint` and the non-test type gate.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/server/crawler/source-registry.ts frontend/src/server/crawler/source-registry.test.ts frontend/src/server/crawler/platform-deferral.ts frontend/src/server/crawler/platform-deferral.test.ts frontend/src/server/admin/data-sources-repository.ts frontend/src/server/admin/data-sources-repository.test.ts frontend/src/server/admin/data-source-sql.ts frontend/src/server/admin/overview.ts frontend/src/server/admin/overview.test.ts frontend/src/app/api/admin/overview frontend/src/server/auth/role-route-coverage.test.ts frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts
git commit -m "feat(admin-api): overview of coverage, onboarding pipeline, crawl health and bids"
```

---

### Task 8: Source detail API and filtered crawler logs

**Files:**
- Modify: `frontend/src/server/admin/data-sources-repository.ts`, `data-sources-repository.test.ts`
- Create: `frontend/src/server/admin/source-detail.ts`, `source-detail.test.ts`
- Modify: `frontend/src/app/api/admin/data-sources/[id]/route.ts`; Create: `frontend/src/app/api/admin/data-sources/[id]/route.get.test.ts`
- Modify: `frontend/src/app/api/admin/crawler-logs/route.ts`, `route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`, `admin.test.ts`

**Interfaces:**
- Consumes: Task 6's runner and fragments; `evaluateLedgeredApproval`, `isLocalSource`, `readinessBucket` (`./ledgered-approval`); `effectivePlatformReview` (`./platform-reviews-repository`); `sourceBidIdLikePattern` (`@/server/crawler/lifecycle`).
- Produces:
  - `AdminDataSource.fipsCode: string | null`.
  - `crawlerLogKeysForSource(row)`; `getAdminDataSource(db, id)` / `getAdminDataSourceFromMysql(mysql, id)` → `AdminDataSourceRecord { source; logSourceKeys }` (throws `AdminDataSourceNotFoundError`).
  - `AdminCrawlerLogsOptions { limit?; sources?; before?; beforeId? }`, `normalizeCrawlerLogLimit(limit)`; `listAdminCrawlerLogs*` accept the options.
  - `AdminDataSourceDetail { source; logSourceKeys; states: { level; platform; approval; health }; readiness: { bucket; reason; platformReview } | null; bids: { counts: { open; closed; awarded; total }; latest: AdminSourceBid[] } }`; `getAdminDataSourceDetail(db, id, now?)`, `getAdminDataSourceDetailFromMysql(mysql, id, now?)`.
  - Routes: `GET /api/admin/data-sources/[id]` (console read); `GET /api/admin/crawler-logs?source=&before=&beforeId=&limit=` → `{ logs, nextCursor }`.
  - Client: `getAdminDataSourceDetail(id)`, `listAdminCrawlerLogs(options?)`, types `AdminDataSourceDetail`, `AdminCrawlerLogsCursor`.

- [ ] **Step 1: Write the failing repository tests**

Append to `frontend/src/server/admin/data-sources-repository.test.ts` (reuse the file's existing insert helpers and the live-health snapshot fixture that its `latestLiveHealth` test already uses):

1. **A local row no longer inherits its state's run or live health** — rows: state `ca_state` (`issuerType: "state"`, `stateCode: "CA"`), county `bidnet_ca_county` (`issuerType: "county"`, `jurisdictionLevel: "county"`, `stateCode: "CA"`); one `crawler_logs` row with `source: "ca_caleprocure"`; one recorded CA live-health snapshot. `listAdminDataSources`: the state row's `latestLog.source` is `"ca_caleprocure"` and its `latestLiveHealth` is set; the county row's `latestLog` and `latestLiveHealth` are `null`.
2. **`crawlerLogKeysForSource`** — the state row → `["ca_caleprocure", "<its label>", "ca_state"]`; the county row → `["<its label>", "bidnet_ca_county"]`.
3. **`getAdminDataSource`** — returns the county row with `fipsCode` (insert `fipsCode: "08031"`), its own latest log (insert two logs for `bidnet_ca_county` and pick the newer `started_at`), `logSourceKeys`, and `approvalHistory` from its events; an unknown id throws `AdminDataSourceNotFoundError`.
4. **MySQL twin** — a fake store whose `query` answers `WHERE id = ?` with one row (camelCase aliases as `dataSourceSelectSql` produces, including `fipsCode`) and answers the crawler-log query with one row: the log query contains `FROM crawler_logs WHERE source IN (?, ?)` and ends with `ORDER BY started_at DESC, id DESC LIMIT 1`; an empty answer for `WHERE id = ?` throws `AdminDataSourceNotFoundError`.
5. **`listAdminCrawlerLogs` options** — logs `a` (`started_at` T1), `b` and `c` (both T2 > T1, ids `b` < `c`): no options → `[c, b, a]`; `{ sources: ["x"] }` keeps only source `x`; `{ before: T2, beforeId: "c" }` → `[b, a]`; `{ before: T2 }` → `[a]`; `{ limit: 1 }` → `[c]`. MySQL twin: with `{ sources: ["x"], before: T2, beforeId: "c", limit: 2 }` the SQL has `WHERE source IN (?) AND (started_at < ? OR (started_at = ? AND id < ?))` and values `["x", T2, T2, "c", 2]`.

Run: `cd frontend && npx vitest run src/server/admin/data-sources-repository.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 2: Implement the repository changes**

In `frontend/src/server/admin/data-sources-repository.ts`:

1. `AdminDataSource` gains `fipsCode: string | null;` (after `jurisdictionName`); `toAdminSource` sets `fipsCode: row.fipsCode ?? null`; `dataSourceSelectSql` selects `fips_code AS fipsCode` (next to `jurisdiction_name`).
2. Replace `crawlerLogKeysForSource` with the exported:
   ```ts
   /** crawler_logs.source values that belong to a row, most specific first. Only a state-portal row owns its state's crawler id (plan decision 10). */
   export function crawlerLogKeysForSource(source: Pick<DataSourceRow, "issuerType" | "stateCode" | "label" | "id">): string[] {
     const stateCrawlerId = source.issuerType === "state" ? CRAWLER_LOG_SOURCE_BY_STATE[source.stateCode] : undefined;
     return Array.from(new Set([stateCrawlerId, source.label, source.id].filter((value): value is string => Boolean(value))));
   }
   ```
3. In `latestLiveHealthForSource` and `sourceHealthTrendForSource`, build the candidates with one helper:
   ```ts
   function liveHealthCandidates(source: DataSourceRow, crawlerSourceId: string | null): string[] {
     const stateKeys = source.issuerType === "state" ? [source.stateCode.toLowerCase(), source.stateCode] : [];
     return [crawlerSourceId, source.id, ...stateKeys].filter((value): value is string => Boolean(value));
   }
   ```
4. Extract the column list of `listAdminCrawlerLogsFromMysql`'s SELECT into `const MYSQL_CRAWLER_LOG_COLUMNS = "…"` (same columns and aliases) and add the options:
   ```ts
   export interface AdminCrawlerLogsOptions {
     limit?: number;
     /** crawler_logs.source values to keep (a source's logSourceKeys); empty or absent keeps every source. */
     sources?: readonly string[];
     /** Cursor: rows after (before, beforeId) in `started_at DESC, id DESC` order. */
     before?: string | null;
     beforeId?: string | null;
   }

   export function normalizeCrawlerLogLimit(limit: number | undefined): number {
     return Math.min(Math.max(limit ?? 25, 1), 100);
   }
   ```
   SQLite (`import { and, desc, eq, inArray, lt, or, type SQL } from "drizzle-orm"`):
   ```ts
   export async function listAdminCrawlerLogs(db: AppDatabase, options: AdminCrawlerLogsOptions = {}): Promise<AdminCrawlerLog[]> {
     const conditions: SQL[] = [];
     if (options.sources && options.sources.length > 0) conditions.push(inArray(crawlerLogs.source, [...options.sources]));
     if (options.before) {
       const cursor = options.beforeId
         ? or(lt(crawlerLogs.startedAt, options.before), and(eq(crawlerLogs.startedAt, options.before), lt(crawlerLogs.id, options.beforeId)))
         : lt(crawlerLogs.startedAt, options.before);
       if (cursor) conditions.push(cursor);
     }

     return db
       .select()
       .from(crawlerLogs)
       .where(conditions.length > 0 ? and(...conditions) : undefined)
       .orderBy(desc(crawlerLogs.startedAt), desc(crawlerLogs.id))
       .limit(normalizeCrawlerLogLimit(options.limit))
       .all()
       .map(toAdminLog);
   }
   ```
   MySQL:
   ```ts
   export async function listAdminCrawlerLogsFromMysql(mysql: MysqlAdminCrawlerLogsReader, options: AdminCrawlerLogsOptions = {}) {
     const clauses: string[] = [];
     const values: unknown[] = [];
     if (options.sources && options.sources.length > 0) {
       const sources = expandMysqlInClause(options.sources);
       clauses.push(`source IN (${sources.placeholders})`);
       values.push(...sources.values);
     }
     if (options.before) {
       if (options.beforeId) {
         clauses.push("(started_at < ? OR (started_at = ? AND id < ?))");
         values.push(options.before, options.before, options.beforeId);
       } else {
         clauses.push("started_at < ?");
         values.push(options.before);
       }
     }
     const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")} ` : "";
     const rows = await mysqlSelectMany<MysqlAdminCrawlerLogRow>(
       mysql,
       `SELECT ${MYSQL_CRAWLER_LOG_COLUMNS} FROM crawler_logs ${where}ORDER BY started_at DESC, id DESC LIMIT ?`,
       [...values, normalizeCrawlerLogLimit(options.limit)],
     );
     return rows.map(toAdminLogFromMysql);
   }
   ```
   (Import `expandMysqlInClause` from `@/server/db/mysql-runtime`. `listAdminDataSourcesFromMysql`'s `{ limit: 100 }` call keeps working.)
5. Add the single-row loaders:
   ```ts
   export interface AdminDataSourceRecord {
     source: AdminDataSource;
     logSourceKeys: string[];
   }

   export async function getAdminDataSource(db: AppDatabase, id: string): Promise<AdminDataSourceRecord> {
     const row = db.select().from(dataSources).where(eq(dataSources.id, id)).limit(1).get();
     if (!row) throw new AdminDataSourceNotFoundError(id);

     const logSourceKeys = crawlerLogKeysForSource(row);
     const latestLogRow = db
       .select()
       .from(crawlerLogs)
       .where(inArray(crawlerLogs.source, logSourceKeys))
       .orderBy(desc(crawlerLogs.startedAt), desc(crawlerLogs.id))
       .limit(1)
       .get();
     const approvalHistory = approvalHistoryBySource(
       db.select().from(sourceApprovalEvents).where(eq(sourceApprovalEvents.sourceId, id)).orderBy(desc(sourceApprovalEvents.createdAt)).all(),
     );
     const snapshots = listLiveSourceHealthSnapshots(db, 10);

     return {
       source: toAdminSource(
         row,
         latestLogRow ? toAdminLog(latestLogRow) : null,
         latestLiveSourceHealthBySource(snapshots.slice(0, 1)),
         sourceHealthTrendBySource(snapshots),
         approvalHistory.get(id),
       ),
       logSourceKeys,
     };
   }

   export async function getAdminDataSourceFromMysql(mysql: MysqlDataSourcesStore, id: string): Promise<AdminDataSourceRecord> {
     const row = await mysqlSelectOne<DataSourceRow>(mysql, `${dataSourceSelectSql("WHERE id = ?")} LIMIT 1`, [id]);
     if (!row) throw new AdminDataSourceNotFoundError(id);

     const logSourceKeys = crawlerLogKeysForSource(row);
     const keys = expandMysqlInClause(logSourceKeys);
     const latestLog = await mysqlSelectOne<MysqlAdminCrawlerLogRow>(
       mysql,
       `SELECT ${MYSQL_CRAWLER_LOG_COLUMNS} FROM crawler_logs WHERE source IN (${keys.placeholders}) ORDER BY started_at DESC, id DESC LIMIT 1`,
       keys.values,
     );
     const approvalHistory = approvalHistoryBySource(await listSourceApprovalEventsFromMysql(mysql, id));
     const snapshots = await listLiveSourceHealthSnapshotsFromMysql(mysql, 10);

     return {
       source: toAdminSource(
         row,
         latestLog ? toAdminLogFromMysql(latestLog) : null,
         latestLiveSourceHealthBySource(snapshots.slice(0, 1)),
         sourceHealthTrendBySource(snapshots),
         approvalHistory.get(id),
       ),
       logSourceKeys,
     };
   }
   ```
   (`MysqlAdminCrawlerLogRow` is the row type `toAdminLogFromMysql` already takes; use its actual name.)

Run the repository tests — Expected: PASS (and every older test in the file still passes; fix only fixtures that relied on a local row inheriting its state's log/health, and list them in your report).

- [ ] **Step 3: Write the failing detail test**

Create `frontend/src/server/admin/source-detail.test.ts` (SQLite; reuse Task 7's fixture shapes):

- rows: `ca_state` (state, CA, `approvalStatus: "approved"`, `lastSuccessAt`), `bidnet_co_denver` (county, `approvalStatus: null`, `providerFamily: "bidnet"`, `baseUrl: "https://www.bidnetdirect.com/colorado/denver"`, `liveHealthDisposition: "ready"`, `liveHealthReviewedAt: "2026-09-25T00:00:00.000Z"`, `liveHealthNotes: JSON.stringify({ precheck: { baseUrl: "https://www.bidnetdirect.com/colorado/denver" } })`); a valid `bidnet` platform review (as in Task 7); bids `bidnet_co_denver:1` (open, created 2026-09-20), `bidnet_co_denver:2` (closed, created 2026-09-28), `bidnet_co_denver_x:9` (open — must NOT count: different source id prefix), `ca_caleprocure:7` (open, for the state row's legacy prefix).
- `getAdminDataSourceDetail(db, "bidnet_co_denver", NOW)` equals: `states: { level: "county", platform: "bidnet", approval: "awaiting", health: "never_run" }`, `readiness: { bucket: "approvable", reason: null, platformReview: { status: "valid", review: expect.objectContaining({ providerFamily: "bidnet" }) } }`, `bids.counts: { open: 1, closed: 1, awarded: 0, total: 2 }`, `bids.latest.map((bid) => bid.id)` = `["bidnet_co_denver:2", "bidnet_co_denver:1"]`, `logSourceKeys` = `["bidnet_co_denver"]` plus its label (order as `crawlerLogKeysForSource` gives).
- `getAdminDataSourceDetail(db, "ca_state", NOW)`: `readiness: null`, `states.approval: "approved"`, `states.health: "healthy"`, and `bids.counts.total` counts `ca_caleprocure:7` (the state row's crawler-id prefix).
- unknown id → rejects with `AdminDataSourceNotFoundError`.
- MySQL: a fake store answering the row, the states query and two empty bid queries; assert one call's SQL starts with `SELECT (CASE WHEN COALESCE(jurisdiction_level, issuer_type)` and a bid query contains `id LIKE ? ESCAPE '!'`.

If the phase-3 fix wave's rule makes the Denver row read something other than `approvable` (for example because a governance timestamp in the seed is newer than the precheck), adjust the seed, not the rule.

Run it — Expected: FAIL (module missing).

- [ ] **Step 4: Implement the detail module**

Create `frontend/src/server/admin/source-detail.ts`:

```ts
import type { AppDatabase } from "@/server/db/client";
import { sourceBidIdLikePattern } from "@/server/crawler/lifecycle";
import { coverageLevelOf, type CoverageLevel, type SourceApprovalState, type SourceHealthState } from "./data-source-list-contract";
import { APPROVAL_STATE_SQL, HEALTH_STATE_SQL, LEVEL_SQL, PLATFORM_SQL } from "./data-source-sql";
import {
  getAdminDataSource,
  getAdminDataSourceFromMysql,
  type AdminDataSource,
  type AdminDataSourceRecord,
  type MysqlDataSourcesStore,
} from "./data-sources-repository";
import {
  evaluateLedgeredApproval,
  isLocalSource,
  readinessBucket,
  type ApprovalReadinessBucket,
  type LedgeredApprovalReason,
} from "./ledgered-approval";
import {
  effectivePlatformReview,
  listPlatformReviews,
  listPlatformReviewsFromMysql,
  type EffectivePlatformReview,
  type MysqlPlatformReviewsStore,
  type PlatformReview,
} from "./platform-reviews-repository";
import { mysqlSqlRunner, sqlCount, sqliteSqlRunner, type AdminSqlRunner } from "./sql-runner";

export interface AdminSourceStates {
  level: CoverageLevel;
  platform: string;
  approval: SourceApprovalState;
  health: SourceHealthState;
}

export interface AdminSourceReadiness {
  bucket: ApprovalReadinessBucket;
  reason: LedgeredApprovalReason | null;
  platformReview: EffectivePlatformReview;
}

export interface AdminSourceBid {
  id: string;
  title: string;
  publishedDate: string | null;
  deadlineDate: string | null;
  lifecycleStatus: string;
}

export interface AdminSourceBids {
  counts: { open: number; closed: number; awarded: number; total: number };
  latest: AdminSourceBid[];
}

export interface AdminDataSourceDetail {
  source: AdminDataSource;
  logSourceKeys: string[];
  states: AdminSourceStates;
  readiness: AdminSourceReadiness | null;
  bids: AdminSourceBids;
}

export const SOURCE_STATES_SQL = `SELECT ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, ${HEALTH_STATE_SQL} AS health_state FROM data_sources WHERE id = ?`;

/** A source's bids carry `<data_sources.id>:` — and, for older state-portal rows, `<crawler id>:` — as their id prefix. */
export function bidIdPrefixesForSource(source: Pick<AdminDataSource, "id" | "crawlerSourceId">): string[] {
  return Array.from(new Set([source.id, source.crawlerSourceId].filter((value): value is string => Boolean(value))));
}

export async function computeSourceDetail(deps: {
  sql: AdminSqlRunner;
  record: AdminDataSourceRecord;
  reviews: readonly PlatformReview[];
  now: Date;
}): Promise<AdminDataSourceDetail> {
  const { source, logSourceKeys } = deps.record;
  const prefixes = bidIdPrefixesForSource(source);
  const bidWhere = `(${prefixes.map(() => "id LIKE ? ESCAPE '!'").join(" OR ")})`;
  const bidValues = prefixes.map((prefix) => sourceBidIdLikePattern(prefix));

  const [stateRows, countRows, latestRows] = await Promise.all([
    deps.sql.all<{ coverage_level: string; platform: string; approval_state: string; health_state: string }>(SOURCE_STATES_SQL, [source.id]),
    deps.sql.all<{ lifecycle_status: string; total: unknown }>(
      `SELECT lifecycle_status, COUNT(*) AS total FROM bids WHERE ${bidWhere} GROUP BY lifecycle_status`,
      bidValues,
    ),
    deps.sql.all<{ id: string; title: string; published_date: string | null; deadline_date: string | null; lifecycle_status: string }>(
      `SELECT id, title, published_date, deadline_date, lifecycle_status FROM bids WHERE ${bidWhere} ORDER BY created_at DESC, id DESC LIMIT 10`,
      bidValues,
    ),
  ]);

  const counts = { open: 0, closed: 0, awarded: 0, total: 0 };
  for (const row of countRows) {
    const total = sqlCount(row.total);
    counts.total += total;
    if (row.lifecycle_status === "open" || row.lifecycle_status === "closed" || row.lifecycle_status === "awarded") {
      counts[row.lifecycle_status] += total;
    }
  }

  let readiness: AdminSourceReadiness | null = null;
  if (isLocalSource(source)) {
    const platformReview = effectivePlatformReview(deps.reviews, source.providerFamily, deps.now);
    const evaluation = evaluateLedgeredApproval(source, platformReview, deps.now);
    readiness = { bucket: readinessBucket(evaluation), reason: evaluation.reason, platformReview };
  }

  const states = stateRows[0];
  return {
    source,
    logSourceKeys,
    states: {
      level: coverageLevelOf(states?.coverage_level),
      platform: states?.platform ?? source.providerFamily,
      approval: (states?.approval_state ?? "approved") as SourceApprovalState,
      health: (states?.health_state ?? "never_run") as SourceHealthState,
    },
    readiness,
    bids: {
      counts,
      latest: latestRows.map((row) => ({
        id: row.id,
        title: row.title,
        publishedDate: row.published_date ?? null,
        deadlineDate: row.deadline_date ?? null,
        lifecycleStatus: row.lifecycle_status,
      })),
    },
  };
}

export async function getAdminDataSourceDetail(db: AppDatabase, id: string, now = new Date()): Promise<AdminDataSourceDetail> {
  const record = await getAdminDataSource(db, id);
  return computeSourceDetail({ sql: sqliteSqlRunner(db), record, reviews: listPlatformReviews(db), now });
}

export async function getAdminDataSourceDetailFromMysql(
  mysql: MysqlDataSourcesStore & MysqlPlatformReviewsStore,
  id: string,
  now = new Date(),
): Promise<AdminDataSourceDetail> {
  const record = await getAdminDataSourceFromMysql(mysql, id);
  return computeSourceDetail({ sql: mysqlSqlRunner(mysql), record, reviews: await listPlatformReviewsFromMysql(mysql), now });
}
```

Run the detail test — Expected: PASS.

- [ ] **Step 5: Add the detail GET route**

In `frontend/src/app/api/admin/data-sources/[id]/route.ts` import `getAdminDataSourceDetail`, `getAdminDataSourceDetailFromMysql` from `@/server/admin/source-detail` and `type MysqlPlatformReviewsStore` from `@/server/admin/platform-reviews-repository`, and add before `export const PATCH`:

```ts
/** Spec §6.1: the full source with its run keys, states, readiness and bids. Console read. */
export function createAdminDataSourceGet(database?: AppDatabase, mysql?: MysqlDataSourcesStore & MysqlPlatformReviewsStore) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const { id } = await context.params;
      return NextResponse.json(
        shouldUseMysqlRuntime()
          ? await getAdminDataSourceDetailFromMysql(mysql ?? resolveMysqlPool(), id)
          : await getAdminDataSourceDetail(resolvedDb, id),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourceGet();
```

Create `frontend/src/app/api/admin/data-sources/[id]/route.get.test.ts` (a separate file because `route.test.ts` mocks `@/server/admin/auth`): 403 without the bypass; with the bypass, 200 for a seeded county row (`body.source.id`, `body.states.level === "county"`, `body.bids.counts.total === 0`); 404 `DATA_SOURCE_NOT_FOUND` for an unknown id. Call the handler as `createAdminDataSourceGet(testDb.db)(request, { params: Promise.resolve({ id }) })`.

- [ ] **Step 6: Filter and page the crawler-log route**

In `frontend/src/app/api/admin/crawler-logs/route.ts` replace `limitFromUrl` with:

```ts
class CrawlerLogsQueryError extends Error {}

const MAX_LOG_SOURCES = 10;

function logOptionsFromUrl(request: Request): AdminCrawlerLogsOptions {
  const params = new URL(request.url).searchParams;
  const rawLimit = params.get("limit");
  const parsedLimit = rawLimit ? Number(rawLimit) : Number.NaN;
  const sources = Array.from(new Set(params.getAll("source").map((value) => value.trim()).filter(Boolean)));
  if (sources.length > MAX_LOG_SOURCES) throw new CrawlerLogsQueryError(`at most ${MAX_LOG_SOURCES} source values`);
  const before = params.get("before")?.trim() || null;
  const beforeId = params.get("beforeId")?.trim() || null;
  if (beforeId && !before) throw new CrawlerLogsQueryError("beforeId requires before");
  if ((before?.length ?? 0) > 64 || (beforeId?.length ?? 0) > 191) throw new CrawlerLogsQueryError("cursor is too long");

  return { limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined, sources, before, beforeId };
}
```

map `CrawlerLogsQueryError` to `errorResponse("INVALID_REQUEST", error.message, 400)` in `routeError`, and in `GET` (after `requireAdminAccess`):

```ts
      const options = logOptionsFromUrl(request);
      const logs = resolved.logsMysql
        ? await listAdminCrawlerLogsFromMysql(resolved.logsMysql, options)
        : await listAdminCrawlerLogs(resolved.logsDatabase, options);
      const last = logs.at(-1);
      const nextCursor = last && logs.length === normalizeCrawlerLogLimit(options.limit) ? { before: last.startedAt, beforeId: last.id } : null;

      return NextResponse.json({ logs, nextCursor });
```

(import `normalizeCrawlerLogLimit` and `type AdminCrawlerLogsOptions`). Extend `route.test.ts`: `?source=a&source=b&limit=1` returns one log of source `a` or `b` with a `nextCursor`, and following it returns the next one; eleven `source` values → 400 `INVALID_REQUEST`; `beforeId` without `before` → 400. The existing assertions keep passing (the body gains `nextCursor`).

- [ ] **Step 7: Client helpers**

In `frontend/src/lib/api/admin.ts`:

```ts
import type { AdminDataSourceDetail } from "@/server/admin/source-detail";
// add AdminDataSourceDetail to the export type list

export interface AdminCrawlerLogsCursor {
  before: string;
  beforeId: string;
}

// AdminCrawlerLogsResponse becomes:
export interface AdminCrawlerLogsResponse {
  logs: AdminCrawlerLog[];
  nextCursor: AdminCrawlerLogsCursor | null;
}

export async function listAdminCrawlerLogs(
  options: { limit?: number; sources?: readonly string[]; before?: string; beforeId?: string } = {},
) {
  const response = await fetch(
    `/api/admin/crawler-logs${buildQueryString({
      limit: options.limit,
      source: options.sources,
      before: options.before,
      beforeId: options.beforeId,
    })}`,
  );

  return parseResponse<AdminCrawlerLogsResponse>(response);
}

export async function getAdminDataSourceDetail(id: string) {
  const response = await fetch(`/api/admin/data-sources/${encodeURIComponent(id)}`);

  return parseResponse<AdminDataSourceDetail>(response);
}
```

`admin.test.ts`: the existing `listAdminCrawlerLogs()` case still expects `/api/admin/crawler-logs`; add one with `{ sources: ["a", "b"], before: "2026-09-29T00:00:00.000Z", beforeId: "log_9", limit: 20 }` expecting `/api/admin/crawler-logs?limit=20&source=a&source=b&before=2026-09-29T00%3A00%3A00.000Z&beforeId=log_9`, and one for `getAdminDataSourceDetail("a b")` expecting `/api/admin/data-sources/a%20b`.

- [ ] **Step 8: Run the tests and gates**

Run: `cd frontend && npx vitest run src/server/admin src/app/api/admin/data-sources src/app/api/admin/crawler-logs src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts src/lib/api/admin.test.ts src/server/db/mysql-smoke.test.ts`
Expected: PASS. Then `npm run lint` and the non-test type gate.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/server/admin/data-sources-repository.ts frontend/src/server/admin/data-sources-repository.test.ts frontend/src/server/admin/source-detail.ts frontend/src/server/admin/source-detail.test.ts "frontend/src/app/api/admin/data-sources/[id]" frontend/src/app/api/admin/crawler-logs frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts
git commit -m "feat(admin-api): source detail endpoint and filtered, cursor-paged crawler logs"
```

---
### Task 9: Source detail page

**Files:**
- Create: `frontend/src/components/admin/sources/source-labels.ts`, `source-labels.test.ts`
- Create: `frontend/src/components/admin/sources/crawler-run-id.ts`, `crawler-run-id.test.ts`
- Create: `frontend/src/components/admin/sources/SourceLiveHealthCard.tsx`
- Create: `frontend/src/components/admin/sources/SourceComplianceCard.tsx`
- Create: `frontend/src/components/admin/sources/CrawlerLogList.tsx`
- Create: `frontend/src/components/admin/sources/SourceBidsCard.tsx`
- Create: `frontend/src/components/admin/sources/SourceDetailView.tsx`, `SourceDetailView.test.ts`
- Create: `frontend/src/app/admin/sources/[id]/page.tsx`
- Modify: `frontend/src/app/admin/page.tsx`, `page.test.ts`, `admin-pages.test.ts`
- Modify: `frontend/src/components/admin/JurisdictionBatchRunPanel.test.ts`, `SourcePrecheckPanel.test.ts`, `CrawlerConfigPanel.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: Task 8's `getAdminDataSourceDetail(id)` → `AdminDataSourceDetail`, `listAdminCrawlerLogs({ sources, before, beforeId, limit })` → `{ logs, nextCursor }`; Task 2's kit; existing panels `SourcePrecheckPanel`, `CrawlerConfigPanel`, `isLocalJurisdictionSource` (`ApproveLocalSourceDialog`), `approvalReasonKey` (`LedgeredApprovalPanel`); client helpers `updateAdminDataSource`, `checkAdminDataSourceHealth`, `runStateCrawlersNow`; `bidDetailPath` (`@/lib/bid-routes`).
- Produces (used by Tasks 10, 13, 14):
  - `crawlerRunIdFor(source: { id; issuerType; stateCode; crawlerSourceId }): string | null`.
  - `CrawlerLogList({ sources?: readonly string[]; title: string })`.
  - `SourceDetailView({ sourceId })`; `sourceDetailTabs(): SourceDetailTab[]`.
  - i18n: `coverageLevel_<level>` (7 levels), `sourcesApproval_<state>` (3), `sourcesHealth_<state>` (4), and the detail keys below.

What moves out of `page.tsx` (it keeps using them through imports until Task 11 deletes the table):

| Piece | Anchor (lines at branch start) | Goes to |
| --- | --- | --- |
| row-cell helpers: `latestRunAt` (L457), `liveSourceHealthTone`, `liveSourceHealthLabel`, `sourceHealthClassificationFor` (L468-486), `sourceHealthClassificationLabel` (L523-537), `sourceHealthTriageStatus` … `liveSourceTrendStatusLabel` (L591-695), `crawlerTone` … `formatCrawlerBaseUrl` (L710-838, except `filteredDataSourcesSummary` L717-732 which stays), types `SourceHealthTriageStatus`, `SourceHealthTriageAction`, `SourceHealthTriageFields` (L186-188, 198-204) | `function liveSourceHealthTone(` | `source-labels.ts`, every one exported, bodies unchanged |
| `stateCrawlerSourceIdFor` (L391-398) | `function stateCrawlerSourceIdFor(` | `crawler-run-id.ts` as `crawlerRunIdFor` (below) |
| the live-health box in the status cell: from `<div className="mt-2 rounded-md border border-slate-200 bg-white p-2 text-xs leading-5 text-slate-600">` holding `t("admin.liveSourceHealth")` through the closing `</div>` after the recheck `<Button>` | `{t("admin.liveSourceHealth")}` | `SourceLiveHealthCard` |
| the compliance-ledger box and the approval-history box in the crawler cell (from `{t("admin.complianceLedger")}`'s `<div>` through the end of `source.approvalHistory.length > 0 && (…)`) | `{t("admin.complianceLedger")}` | `SourceComplianceCard` |
| a crawler-log row's markup in the logs section (L4374-4398) | `{logs.map((log) => (` | `CrawlerLogList` |

Filter-only helpers (`filterAdminDataSourcesByHealthClassification`, `filterAdminDataSourcesBySourceOps`, `sourceRecommendedActionOptions`, `SOURCE_HEALTH_CLASSIFICATION_FILTERS`, `SOURCE_HEALTH_TRIAGE_STATUS_FILTERS`, `sourceHealthTriageFilterLabel`, `filteredDataSourcesSummary`) stay in `page.tsx`; Task 11 deletes them with the old table.

- [ ] **Step 1: Add the i18n keys**

Append at the end of `admin` in both dictionaries:

| key | en | zh |
| --- | --- | --- |
| `coverageLevel_federal` | Federal | 联邦 |
| `coverageLevel_state` | State | 州 |
| `coverageLevel_county` | County | 县 |
| `coverageLevel_city` | City | 市 |
| `coverageLevel_township` | Township | 镇/乡 |
| `coverageLevel_special_district` | Special district | 特别区 |
| `coverageLevel_unknown` | Unknown | 未知 |
| `sourcesApproval_approved` | Approved | 已批准 |
| `sourcesApproval_awaiting` | Awaiting approval | 待审批 |
| `sourcesApproval_blocked` | Blocked | 已拦截 |
| `sourcesHealth_healthy` | Healthy | 健康 |
| `sourcesHealth_failing` | Failing | 失败中 |
| `sourcesHealth_never_run` | Never run | 从未运行 |
| `sourcesHealth_disabled` | Disabled | 已停用 |
| `sourceDetailTab_overview` | Overview | 概况 |
| `sourceDetailTab_config` | Crawler config | 抓取配置 |
| `sourceDetailTab_approval` | Precheck & approval | 预检与审批 |
| `sourceDetailTab_runs` | Run history | 运行记录 |
| `sourceDetailTab_bids` | Bids | 招标 |
| `sourceDetailNotFoundTitle` | Source not found | 未找到数据源 |
| `sourceDetailNotFoundDescription` | No data source has this id; it may have been removed. | 没有这个 id 的数据源，可能已被删除。 |
| `sourceDetailBackToList` | Back to source list | 返回源列表 |
| `sourceDetailRunNow` | Run now | 立即运行 |
| `sourceDetailEnable` | Enable | 启用 |
| `sourceDetailDisable` | Disable | 停用 |
| `sourceDetailReadiness` | Batch approval readiness | 批量审批就绪度 |
| `sourceDetailReadinessNotLocal` | Federal and state sources are approved one by one. | 联邦与州级数据源逐个审批。 |
| `sourceDetailConfigReadOnly` | Only admins and operators can edit the crawler config. | 只有管理员和运营可以修改抓取配置。 |
| `sourceDetailBidCounts` | Bids from this source | 本源招标 |
| `sourceDetailLatestBids` | Latest 10 bids | 最新 10 条招标 |
| `sourceDetailNoBids` | No bids from this source yet. | 本源暂无招标。 |
| `bidLifecycle_open` | Open | 开放 |
| `bidLifecycle_closed` | Closed | 已截止 |
| `bidLifecycle_awarded` | Awarded | 已授标 |
| `bidTotal` | Total | 合计 |
| `fieldSourceId` | Source id | 源 id |
| `fieldJurisdiction` | Jurisdiction | 辖区 |
| `fieldGeoid` | GEOID | GEOID 编码 |
| `fieldBaseUrl` | Base URL | 基础地址 |
| `fieldPlatform` | Platform | 平台 |
| `fieldLevel` | Level | 级别 |
| `fieldState` | State | 州 |
| `fieldApproval` | Approval | 审批 |
| `fieldHealth` | Health | 健康 |
| `fieldLastSuccess` | Last success | 最近成功 |
| `fieldLastFailure` | Last failure | 最近失败 |
| `fieldConsecutiveFailures` | Consecutive failures | 连续失败次数 |
| `fieldFetchConfig` | Fetch config | 抓取配置参数 |
| `fieldTitle` | Title | 标题 |
| `fieldPublished` | Published | 发布日 |
| `fieldDeadline` | Deadline | 截止日 |
| `loadMore` | Load more | 加载更多 |

- [ ] **Step 2: Write the failing tests**

Create `frontend/src/components/admin/sources/crawler-run-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { crawlerRunIdFor } from "./crawler-run-id";

describe("crawlerRunIdFor", () => {
  it("resolves the id the manual run route accepts", () => {
    expect(crawlerRunIdFor({ id: "california_caleprocure", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: null })).toBe("ca_caleprocure");
    expect(crawlerRunIdFor({ id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null })).toBe("bidnet_co_denver");
    expect(crawlerRunIdFor({ id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null })).toBeNull();
  });
});
```

Create `frontend/src/components/admin/sources/source-labels.test.ts`: move `page.test.ts` tests 11 ("derives source health triage queue status from live review fields") and 12 ("creates source health triage patch payloads for quick actions") here, importing from `./source-labels`; also move test 5's `sourceHealthClassificationLabel` assertions (its `SOURCE_HEALTH_CLASSIFICATION_FILTERS` assertions stay in `page.test.ts` until Task 11).

Create `frontend/src/components/admin/sources/SourceDetailView.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { zh } from "@/lib/i18n/dictionaries/zh";
import { sourceDetailTabs } from "./SourceDetailView";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

describe("source detail view", () => {
  it("has the five spec tabs in order with translated labels", () => {
    expect(sourceDetailTabs()).toEqual(["overview", "config", "approval", "runs", "bids"]);
    const enAdmin = en.admin as Record<string, string>;
    const zhAdmin = zh.admin as Record<string, string>;
    for (const tab of sourceDetailTabs()) {
      expect(zhAdmin[`sourceDetailTab_${tab}`]).toBeTruthy();
      expect(zhAdmin[`sourceDetailTab_${tab}`]).not.toBe(enAdmin[`sourceDetailTab_${tab}`]);
    }
  });

  it("loads the detail endpoint and reuses the existing panels", () => {
    const view = read("SourceDetailView.tsx");
    expect(view).toContain("getAdminDataSourceDetail(sourceId)");
    expect(view).toContain("<SourcePrecheckPanel");
    expect(view).toContain("reviewerEmail={user.email}");
    expect(view).toContain("onSourceUpdated={replaceSource}");
    expect(view).toContain("<CrawlerConfigPanel");
    expect(view).toContain("onSaved={replaceSource}");
    expect(view).toContain("<CrawlerLogList");
    expect(view).toContain("sources={detail.logSourceKeys}");
    expect(view).toContain("!isLocalJurisdictionSource(source)");
    expect(view).toContain('t("admin.sourceDetailNotFoundTitle")');
  });

  it("keeps the moved row markup in its own cards", () => {
    expect(read("SourceLiveHealthCard.tsx")).toContain("const liveHealth = source.latestLiveHealth");
    expect(read("SourceLiveHealthCard.tsx")).toContain("const healthTrend = source.sourceHealthTrend");
    expect(read("SourceComplianceCard.tsx")).toContain('t("admin.complianceLedger")');
    expect(read("CrawlerLogList.tsx")).toContain("listAdminCrawlerLogs(");
    expect(read("CrawlerLogList.tsx")).toContain("nextCursor");
  });
});
```

Append to `PAGES` in `admin-pages.test.ts`: `["sources/[id]/page.tsx", "<SourceDetailView"]`, and add a test in that file asserting the detail page contains `useParams`.

Run: `cd frontend && npx vitest run src/components/admin/sources src/app/admin/admin-pages.test.ts` — Expected: FAIL.

- [ ] **Step 3: Move the helpers**

Create `frontend/src/components/admin/sources/source-labels.ts` with the helpers and types from the table (imports: `type AdminDataSource`, `type AdminLiveSourceHealth` from `@/lib/api/admin` as the bodies need; `isoDaysFrom` goes too). Create `frontend/src/components/admin/sources/crawler-run-id.ts`:

```ts
import { stateCrawlerSourceIdForAdminSource } from "@/lib/state-crawler-sources";

export interface CrawlerRunSource {
  id: string;
  issuerType: string;
  stateCode: string;
  crawlerSourceId: string | null;
}

/** The id POST /api/crawler/state/run accepts for a source (was page.tsx's stateCrawlerSourceIdFor). */
export function crawlerRunIdFor(source: CrawlerRunSource): string | null {
  // County/city/special-district registry rows have no legacy per-state crawler metadata;
  // since the data_sources migration they run through /api/crawler/state/run by their own row
  // id (the route resolves every non-federal data_sources id — see listAllSources).
  const subStateSourceId = source.issuerType !== "state" && source.issuerType !== "federal" ? source.id : null;
  return source.crawlerSourceId ?? stateCrawlerSourceIdForAdminSource(source) ?? subStateSourceId;
}
```

In `page.tsx` delete the moved definitions and import them from `@/components/admin/sources/source-labels` and `@/components/admin/sources/crawler-run-id`; rename the calls `stateCrawlerSourceIdFor(` → `crawlerRunIdFor(` and the prop `crawlerSourceIdFor={stateCrawlerSourceIdFor}` → `crawlerSourceIdFor={crawlerRunIdFor}`. In `JurisdictionBatchRunPanel.test.ts` update the page assertion to `crawlerSourceIdFor={crawlerRunIdFor}` and read `subStateSourceId` from `../admin/sources/crawler-run-id.ts` (path relative to the test) instead of the page.

- [ ] **Step 4: Build the cards**

`frontend/src/components/admin/sources/SourceLiveHealthCard.tsx`:

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AdminDataSource } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import {
  /* every helper the moved markup calls, e.g. liveSourceHealthTone, liveSourceHealthLabel, sourceHealthClassificationLabel,
     sourceHealthClassificationFor, liveSourceOperationalSeverityTone, liveSourceRecommendedActionLabel,
     liveSourceTrendStatusLabel, sourceHealthTriageStatus, sourceHealthTriageTone, sourceHealthTriageLabel,
     sourceHealthDispositionLabel */
  type SourceHealthTriageAction,
  type SourceHealthTriageFields,
} from "./source-labels";

export interface SourceLiveHealthCardProps {
  source: AdminDataSource;
  canRunOperations: boolean;
  pending: "recheck" | "triage" | null;
  onRecheck: () => void;
  onTriage: (action: SourceHealthTriageAction) => void;
}

/** Live source health and its triage queue fields (moved from the old sources table's status cell). */
export function SourceLiveHealthCard({ source, canRunOperations, pending, onRecheck, onTriage }: SourceLiveHealthCardProps) {
  const { t } = useLanguage();
  const liveHealth = source.latestLiveHealth;
  const healthTrend = source.sourceHealthTrend;
  const liveHealthTriage = source as SourceHealthTriageFields;
  const triageStatus = sourceHealthTriageStatus(liveHealthTriage);
  const liveHealthCode = liveHealth?.statusCode ?? liveHealth?.httpStatus ?? null;
  const liveHealthErrorMessage = liveHealth?.error ?? liveHealth?.errorMessage ?? null;

  return (
    /* the moved live-health box, with these substitutions:
         canRunOperations                          → the prop
         sourceTriagePendingId === source.id       → pending === "triage"
         sourceHealthPendingId === source.id       → pending === "recheck"
         updateSourceHealthTriage(source, action)  → onTriage(action)
         recheckSourceHealth(source)               → onRecheck() */
  );
}
```

`frontend/src/components/admin/sources/SourceComplianceCard.tsx` — props `{ source: AdminDataSource }`, `"use client"`, `useLanguage()`, renders the moved ledger and history boxes (their `max-w-64` class may widen to `max-w-none` inside the detail page).

`frontend/src/components/admin/sources/CrawlerLogList.tsx`:

```tsx
"use client";

import { useCallback, useState } from "react";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listAdminCrawlerLogs, type AdminCrawlerLog, type AdminCrawlerLogsCursor } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { compactErrorMessage, fallbackMessage, formatDate, statusTone } from "../admin-format";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

const PAGE_SIZE = 25;

/** Crawler runs, newest first, with "load more" on the API cursor (spec §6.1). */
export function CrawlerLogList({ sources, title }: { sources?: readonly string[]; title: string }) {
  const { t } = useLanguage();
  const sourceKey = sources?.join("\u0000") ?? "";
  const loadFirstPage = useCallback(
    () => listAdminCrawlerLogs({ sources: sourceKey ? sourceKey.split("\u0000") : undefined, limit: PAGE_SIZE }),
    [sourceKey],
  );
  const firstPage = useAdminResource(loadFirstPage);
  // Pages loaded with "load more" belong to one source set; a different set starts over.
  const [loaded, setLoaded] = useState<{ key: string; logs: AdminCrawlerLog[]; cursor: AdminCrawlerLogsCursor | null } | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  const more = loaded?.key === sourceKey ? loaded : null;
  const logs = [...(firstPage.data?.logs ?? []), ...(more?.logs ?? [])];
  const cursor = more ? more.cursor : (firstPage.data?.nextCursor ?? null);

  const loadMore = async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const page = await listAdminCrawlerLogs({
        sources: sourceKey ? sourceKey.split("\u0000") : undefined,
        limit: PAGE_SIZE,
        before: cursor.before,
        beforeId: cursor.beforeId,
      });
      setLoaded((current) => ({
        key: sourceKey,
        logs: [...(current?.key === sourceKey ? current.logs : []), ...page.logs],
        cursor: page.nextCursor,
      }));
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setIsLoadingMore(false);
    }
  };

  if (firstPage.status === "error" && !firstPage.data) {
    return (
      <AdminSectionStateCard
        action={() => void firstPage.reload()}
        actionLabel={t("admin.refresh")}
        code="error"
        message={t("admin.errorDescription")}
        title={title}
      />
    );
  }
  if (!firstPage.data) {
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={title} />;
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">
        <Activity size={18} />
        {title}
      </div>
      {loadMoreFailed && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}
      {logs.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-slate-500">{t("admin.noLogs")}</div>
      ) : (
        <div className="divide-y divide-slate-100">
          {logs.map((log) => (
            /* the moved crawler-log row markup (L4374-4398), keyed by log.id */
          ))}
        </div>
      )}
      {cursor && (
        <div className="border-t border-slate-100 px-4 py-3">
          <Button type="button" variant="outline" size="sm" disabled={isLoadingMore} onClick={() => void loadMore()}>
            {t("admin.loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
```

(`sourceKey` is a stable string, so a parent re-render with an equal array neither reloads the first page nor drops the loaded pages.)

`frontend/src/components/admin/sources/SourceBidsCard.tsx`:

```tsx
"use client";

import Link from "next/link";
import type { AdminDataSourceDetail } from "@/lib/api/admin";
import { bidDetailPath } from "@/lib/bid-routes";
import { useLanguage } from "@/lib/i18n/LanguageContext";

export function SourceBidsCard({ bids }: { bids: AdminDataSourceDetail["bids"] }) {
  const { t } = useLanguage();
  const counts: Array<[string, number]> = [
    [t("admin.bidLifecycle_open"), bids.counts.open],
    [t("admin.bidLifecycle_closed"), bids.counts.closed],
    [t("admin.bidLifecycle_awarded"), bids.counts.awarded],
    [t("admin.bidTotal"), bids.counts.total],
  ];

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-950">{t("admin.sourceDetailBidCounts")}</div>
      <dl className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs font-medium text-slate-500">{label}</dt>
            <dd className="text-xl font-semibold text-slate-950">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">{t("admin.sourceDetailLatestBids")}</div>
      {bids.latest.length === 0 ? (
        <div className="px-4 pb-4 text-sm text-slate-500">{t("admin.sourceDetailNoBids")}</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {bids.latest.map((bid) => (
            <li key={bid.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
              <Link href={bidDetailPath(bid.id)} className="font-medium text-slate-900 hover:underline">
                {bid.title}
              </Link>
              <span className="text-xs text-slate-500">
                {t("admin.fieldPublished")}: {bid.publishedDate ?? "-"} · {t("admin.fieldDeadline")}: {bid.deadlineDate ?? "-"} ·{" "}
                {t(`admin.bidLifecycle_${bid.lifecycleStatus}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 5: Build the detail view and page**

`frontend/src/components/admin/sources/SourceDetailView.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UniversalState } from "@/components/universal-state";
import { isLocalJurisdictionSource } from "@/components/admin/ApproveLocalSourceDialog";
import { CrawlerConfigPanel } from "@/components/admin/CrawlerConfigPanel";
import { approvalReasonKey } from "@/components/admin/LedgeredApprovalPanel";
import { SourcePrecheckPanel } from "@/components/admin/SourcePrecheckPanel";
import {
  AdminApiError,
  checkAdminDataSourceHealth,
  getAdminDataSourceDetail,
  runStateCrawlersNow,
  updateAdminDataSource,
  type AdminDataSource,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { CrawlerLogList } from "./CrawlerLogList";
import { crawlerRunIdFor } from "./crawler-run-id";
import { SourceBidsCard } from "./SourceBidsCard";
import { SourceComplianceCard } from "./SourceComplianceCard";
import { SourceLiveHealthCard } from "./SourceLiveHealthCard";
import { sourceHealthTriagePatchForAction, type SourceHealthTriageAction } from "./source-labels";

export type SourceDetailTab = "overview" | "config" | "approval" | "runs" | "bids";

/** Spec §6.2 tab order. */
export function sourceDetailTabs(): SourceDetailTab[] {
  return ["overview", "config", "approval", "runs", "bids"];
}

type PendingAction = "run" | "toggle" | "approve" | "hold" | "recheck" | "triage" | null;

export function SourceDetailView({ sourceId }: { sourceId: string }) {
  const { t } = useLanguage();
  const { user, canRunOperations, canManageUsers } = useAdminSession();
  const loadDetail = useCallback(() => getAdminDataSourceDetail(sourceId), [sourceId]);
  const resource = useAdminResource(loadDetail);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [tab, setTab] = useState<SourceDetailTab>("overview");

  const detail = resource.data;
  const replaceSource = (next: AdminDataSource) => resource.setData((current) => (current ? { ...current, source: next } : current));

  const act = async (action: Exclude<PendingAction, null>, work: () => Promise<void>) => {
    setPending(action);
    setNotice(null);
    try {
      await work();
    } finally {
      setPending(null);
    }
  };

  if (!detail) {
    if (resource.status === "error" && resource.error instanceof AdminApiError && resource.error.status === 404) {
      return (
        <UniversalState
          actions={[{ href: "/admin/sources", label: t("admin.sourceDetailBackToList") }]}
          className="bg-white"
          code="empty"
          message={t("admin.sourceDetailNotFoundDescription")}
          title={t("admin.sourceDetailNotFoundTitle")}
        />
      );
    }
    if (resource.status === "error") {
      return (
        <AdminSectionStateCard
          action={() => void resource.reload()}
          actionLabel={t("admin.refresh")}
          code="error"
          message={t("admin.errorDescription")}
          title={t("admin.nav_sourceDetail")}
        />
      );
    }
    return <AdminSectionStateCard actionLabel={t("admin.refresh")} code="loading" message={t("admin.loading")} title={t("admin.nav_sourceDetail")} />;
  }

  const source = detail.source;
  const runId = crawlerRunIdFor(source);

  const runNow = () =>
    act("run", async () => {
      if (!runId) return;
      try {
        await runStateCrawlersNow([runId]);
        setNotice(t("admin.runSourceQueued").replace("{source}", source.label));
        await resource.reload();
      } catch {
        setNotice(t("admin.runSourceFailed").replace("{source}", source.label));
      }
    });

  const toggleEnabled = () =>
    act("toggle", async () => {
      try {
        await updateAdminDataSource(source.id, { isEnabled: !source.isEnabled });
        await resource.reload();
      } catch {
        setNotice(t("admin.updateFailed"));
      }
    });

  // The old table's per-row approve/hold for federal/state rows (it writes no compliance ledger).
  const updateApproval = (approvalStatus: "approved" | "needs_review") =>
    act(approvalStatus === "approved" ? "approve" : "hold", async () => {
      try {
        await updateAdminDataSource(
          source.id,
          approvalStatus === "approved"
            ? { approvedForIngestion: true, approvalStatus: "approved", legalReviewStatus: "approved_public", approvalNotes: "Approved from Admin source approval workflow." }
            : { approvedForIngestion: false, approvalStatus: "needs_review", legalReviewStatus: "not_reviewed", approvalNotes: "Held for source health or legal review." },
        );
        setNotice(t("admin.sourceApprovalUpdated"));
        await resource.reload();
      } catch {
        setNotice(t("admin.sourceApprovalFailed"));
      }
    });

  const recheck = () =>
    act("recheck", async () => {
      try {
        const { source: updated } = await checkAdminDataSourceHealth(source.id, { timeoutMs: 10_000 });
        replaceSource(updated);
        setNotice(t("admin.sourceHealthRechecked"));
      } catch {
        setNotice(t("admin.sourceHealthRecheckFailed"));
      }
    });

  const triage = (action: SourceHealthTriageAction) =>
    act("triage", async () => {
      try {
        const { source: updated } = await updateAdminDataSource(
          source.id,
          sourceHealthTriagePatchForAction(action, user.email || user.displayName || user.id),
        );
        replaceSource(updated);
        setNotice(t("admin.sourceHealthTriageUpdated"));
      } catch {
        setNotice(t("admin.sourceHealthTriageFailed"));
      }
    });

  const facts: Array<[string, string]> = [
    [t("admin.fieldSourceId"), source.id],
    [t("admin.fieldJurisdiction"), source.jurisdictionName ?? "-"],
    [t("admin.fieldGeoid"), source.fipsCode ?? "-"],
    [t("admin.fieldBaseUrl"), source.baseUrl ?? "-"],
    [t("admin.fieldPlatform"), detail.states.platform],
    [t("admin.cadence"), source.cadence],
    [t("admin.fieldLastSuccess"), formatDate(source.lastSuccessAt)],
    [t("admin.fieldLastFailure"), formatDate(source.lastFailureAt)],
    [t("admin.fieldConsecutiveFailures"), String(source.consecutiveFailures)],
  ];
  const readinessReasonKey = detail.readiness?.reason ? approvalReasonKey(detail.readiness.reason) : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-slate-950">{source.label}</h2>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t(`admin.coverageLevel_${detail.states.level}`)}</Badge>
            <Badge variant="outline">{source.stateCode}</Badge>
            <Badge variant="outline">{t(`admin.sourcesApproval_${detail.states.approval}`)}</Badge>
            <Badge variant="outline">{t(`admin.sourcesHealth_${detail.states.health}`)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRunOperations && runId && (
            <Button type="button" onClick={() => void runNow()} disabled={pending !== null} className="h-9 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
              <Play size={16} />
              {t("admin.sourceDetailRunNow")}
            </Button>
          )}
          {canRunOperations && (
            <Button type="button" variant="outline" onClick={() => void toggleEnabled()} disabled={pending !== null} className="h-9 rounded-lg border-slate-200">
              {source.isEnabled ? t("admin.sourceDetailDisable") : t("admin.sourceDetailEnable")}
            </Button>
          )}
          {canManageUsers && !isLocalJurisdictionSource(source) && (
            <>
              <Button type="button" variant="outline" onClick={() => void updateApproval("approved")} disabled={pending !== null} className="h-9 rounded-lg border-slate-200">
                {t("admin.approveSource")}
              </Button>
              <Button type="button" variant="outline" onClick={() => void updateApproval("needs_review")} disabled={pending !== null} className="h-9 rounded-lg border-slate-200">
                {t("admin.holdSource")}
              </Button>
            </>
          )}
        </div>
      </section>

      <AdminNotice message={notice} />
      {resource.status === "error" && <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />}

      <Tabs value={tab} onValueChange={(value) => setTab(value as SourceDetailTab)}>
        <TabsList>
          {sourceDetailTabs().map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`admin.sourceDetailTab_${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <dl className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-3">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd className="break-all text-sm text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <SourceLiveHealthCard
            source={source}
            canRunOperations={canRunOperations}
            pending={pending === "recheck" || pending === "triage" ? pending : null}
            onRecheck={() => void recheck()}
            onTriage={(action) => void triage(action)}
          />
        </TabsContent>

        <TabsContent value="config">
          {canRunOperations ? (
            <CrawlerConfigPanel source={source} disabled={pending !== null} onSaved={replaceSource} />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              <p>{t("admin.sourceDetailConfigReadOnly")}</p>
              <p className="mt-2 font-medium text-slate-700">{t("admin.fieldFetchConfig")}</p>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(source.fetchConfig, null, 2)}</pre>
            </div>
          )}
        </TabsContent>

        <TabsContent value="approval" className="flex flex-col gap-4">
          <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div className="font-semibold text-slate-950">{t("admin.sourceDetailReadiness")}</div>
            {detail.readiness ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{t(`admin.ledgeredApprovalBucket_${detail.readiness.bucket}`)}</Badge>
                {detail.readiness.reason && (
                  <span className="text-slate-600">{readinessReasonKey ? t(readinessReasonKey) : detail.readiness.reason}</span>
                )}
                <span className="text-slate-500">
                  {t("admin.platformReviewStatus")}: {t(`admin.platformReviewStatus_${detail.readiness.platformReview.status}`)}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-slate-600">{t("admin.sourceDetailReadinessNotLocal")}</p>
            )}
          </section>
          {canRunOperations && (
            <SourcePrecheckPanel source={source} reviewerEmail={user.email} disabled={pending !== null} onSourceUpdated={replaceSource} />
          )}
          <SourceComplianceCard source={source} />
        </TabsContent>

        <TabsContent value="runs">
          <CrawlerLogList sources={detail.logSourceKeys} title={t("admin.sourceDetailTab_runs")} />
        </TabsContent>

        <TabsContent value="bids">
          <SourceBidsCard bids={detail.bids} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Verified facts this code relies on: `UniversalStateCode` includes `"empty"`; `approvalReasonKey(reason: string | null): string | null` returns an i18n key or null; the Base UI tabs wrapper (`src/components/ui/tabs.tsx`) takes `value` / `onValueChange` on `Tabs` and `value` on `TabsTrigger` / `TabsContent`; `bidDetailPath(id)` takes only the id; `PublicUser.email` is a non-null string, so `reviewerEmail={user.email}` is the whole expression.

`frontend/src/app/admin/sources/[id]/page.tsx`:

```tsx
"use client";

import { useParams } from "next/navigation";
import { SourceDetailView } from "@/components/admin/sources/SourceDetailView";

function sourceIdFrom(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export default function AdminSourceDetailPage() {
  const params = useParams<{ id: string | string[] }>();
  const sourceId = sourceIdFrom(params?.id);
  return sourceId ? <SourceDetailView key={sourceId} sourceId={sourceId} /> : null;
}
```

- [ ] **Step 6: Use the cards in the old table and link to the detail page**

In `page.tsx`, inside the sources table rows: replace the live-health box with

```tsx
<SourceLiveHealthCard
  source={source}
  canRunOperations={canRunOperations}
  pending={sourceHealthPendingId === source.id ? "recheck" : sourceTriagePendingId === source.id ? "triage" : null}
  onRecheck={() => recheckSourceHealth(source)}
  onTriage={(action) => updateSourceHealthTriage(source, action)}
/>
```

replace the ledger and history boxes with `<SourceComplianceCard source={source} />`, delete the row-local `liveHealth` / `healthTrend` / `liveHealthTriage` / `triageStatus` / `liveHealthCode` / `liveHealthErrorMessage` constants the moved markup used, and wrap the row's label in `<Link href={`/admin/sources/${encodeURIComponent(source.id)}`} className="hover:underline">`. Move the `page.test.ts` assertions that name the moved markup (for example `"const liveHealth = source.latestLiveHealth"`, `"const healthTrend = source.sourceHealthTrend"`) — `SourceDetailView.test.ts` now carries them. Re-point `SourcePrecheckPanel.test.ts` (its "is mounted per data-source row …" test) and `CrawlerConfigPanel.test.ts` (its "is mounted per data source row in the admin page" test) at `../admin/sources/SourceDetailView.tsx` with the new prop texts `reviewerEmail={user.email}`, `onSourceUpdated={replaceSource}` and `onSaved={replaceSource}`.

- [ ] **Step 7: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build` (`/admin/sources/[id]` appears as a dynamic route).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/admin/sources "frontend/src/app/admin/sources/[id]" frontend/src/app/admin/admin-pages.test.ts frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts frontend/src/components/admin/JurisdictionBatchRunPanel.test.ts frontend/src/components/admin/SourcePrecheckPanel.test.ts frontend/src/components/admin/CrawlerConfigPanel.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): source detail page with overview, config, approval, runs and bids tabs"
```

---

### Task 10: Onboarding approval and crawl-runs pages

**Files:**
- Create: `frontend/src/components/admin/sections/OnboardingSection.tsx`, `OnboardingSection.test.ts`
- Create: `frontend/src/components/admin/sections/CrawlRunsSection.tsx`, `CrawlRunsSection.test.ts`
- Create: `frontend/src/app/admin/sources/onboarding/page.tsx`, `frontend/src/app/admin/sources/runs/page.tsx`
- Modify: `frontend/src/components/admin/JurisdictionBatchRunPanel.tsx`, `JurisdictionBatchRunPanel.test.ts`
- Modify: `frontend/src/app/admin/page.tsx`, `page.test.ts`, `admin-pages.test.ts`

**Interfaces:**
- Consumes: Task 6's `listAdminDataSourceIndex()`, `AdminDataSourceIndexItem`; Task 9's `crawlerRunIdFor`, `CrawlerLogList`; phase-3 `PlatformReviewsPanel`, `LedgeredApprovalPanel`, `providerFamiliesOf`, `getAdminApprovalReadiness()`; `runStateCrawlersNow`.
- Produces: `OnboardingSection`, `CrawlRunsSection`; `BatchRunSource` (the panel's new source type).

- [ ] **Step 1: Narrow the batch-run panel's source type**

In `frontend/src/components/admin/JurisdictionBatchRunPanel.tsx` add

```ts
import type { AdminDataSourceIndexItem } from "@/server/admin/data-source-list-contract";

/** What the panel reads from a source — satisfied by both the index API's items and AdminDataSource. */
export type BatchRunSource = Pick<
  AdminDataSourceIndexItem,
  "id" | "label" | "stateCode" | "issuerType" | "jurisdictionLevel" | "isEnabled" | "crawlerSourceId"
>;
```

and replace `AdminDataSource` with `BatchRunSource` in `JurisdictionBatchRunPanelProps` (`sources: BatchRunSource[]`, `crawlerSourceIdFor: (source: BatchRunSource) => string | null`) and in every exported helper that takes a source (`batchJurisdictionLevelOf`, `buildBatchRunEntries`, …). Behaviour is unchanged; the existing tests' `AdminDataSource` fixtures still satisfy the narrower type.

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/admin/sections/OnboardingSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("onboarding section", () => {
  it("mounts the phase-3 panels with the platform families from readiness", () => {
    const source = readFileSync(new URL("OnboardingSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("getAdminApprovalReadiness()");
    expect(source).toContain("providerFamiliesOf(summary.sources)");
    expect(source).toContain("<PlatformReviewsPanel");
    expect(source).toContain("canManage={isAdmin}");
    expect(source).toContain("<LedgeredApprovalPanel");
    expect(source).toContain("canApprove={isAdmin}");
    expect(source).toContain("canRequestPrechecks={canRunOperations}");
    expect(source).toContain("refreshKey={platformReviewRevision}");
  });
});
```

`frontend/src/components/admin/sections/CrawlRunsSection.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("crawl runs section", () => {
  it("runs from the index API and lists every crawler run", () => {
    const source = readFileSync(new URL("CrawlRunsSection.tsx", import.meta.url), "utf8");
    expect(source).toContain("listAdminDataSourceIndex()");
    expect(source).toContain("<JurisdictionBatchRunPanel");
    expect(source).toContain("crawlerSourceIdFor={crawlerRunIdFor}");
    expect(source).not.toContain("onCompleted=");
    expect(source).toContain("runStateCrawlersNow()");
    expect(source).toContain('t("admin.runStateCrawlers")');
    expect(source).toContain("<CrawlerLogList");
  });
});
```

Re-point `JurisdictionBatchRunPanel.test.ts`'s mount test ("is mounted in the admin sources section …") at `CrawlRunsSection.tsx`. Append to `PAGES`: `["sources/onboarding/page.tsx", "<OnboardingSection />"]`, `["sources/runs/page.tsx", "<CrawlRunsSection />"]`.

Run them — Expected: FAIL.

- [ ] **Step 3: Create the sections and pages**

`frontend/src/components/admin/sections/OnboardingSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { LedgeredApprovalPanel, providerFamiliesOf } from "@/components/admin/LedgeredApprovalPanel";
import { PlatformReviewsPanel } from "@/components/admin/PlatformReviewsPanel";
import { getAdminApprovalReadiness } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useAdminSession } from "../admin-session";
import { AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";

// Families come from readiness (console-read) because the index API is admin/operator only (plan decision 14).
const loadFamilies = () => getAdminApprovalReadiness().then((summary) => providerFamiliesOf(summary.sources));

export function OnboardingSection() {
  const { t } = useLanguage();
  const { user, isAdmin, canRunOperations } = useAdminSession();
  const families = useAdminResource(loadFamilies);
  const [platformReviewRevision, setPlatformReviewRevision] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      <PlatformReviewsPanel
        canManage={isAdmin}
        reviewerEmail={user.email}
        onSaved={() => setPlatformReviewRevision((revision) => revision + 1)}
      />
      {families.data ? (
        <LedgeredApprovalPanel
          providerFamilies={families.data}
          canApprove={isAdmin}
          canRequestPrechecks={canRunOperations}
          refreshKey={platformReviewRevision}
        />
      ) : (
        <AdminSectionStateCard
          action={families.status === "error" ? () => void families.reload() : undefined}
          actionLabel={t("admin.refresh")}
          code={families.status === "error" ? "error" : "loading"}
          message={families.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
          title={t("admin.ledgeredApprovalTitle")}
        />
      )}
    </div>
  );
}
```

`frontend/src/components/admin/sections/CrawlRunsSection.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JurisdictionBatchRunPanel } from "@/components/admin/JurisdictionBatchRunPanel";
import { listAdminDataSourceIndex, runStateCrawlersNow } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { CrawlerLogList } from "../sources/CrawlerLogList";
import { crawlerRunIdFor } from "../sources/crawler-run-id";

const loadIndex = () => listAdminDataSourceIndex().then((response) => response.items);

export function CrawlRunsSection() {
  const { t } = useLanguage();
  const { canRunOperations } = useAdminSession();
  const index = useAdminResource(loadIndex);
  const [isRunning, setIsRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [logsRevision, setLogsRevision] = useState(0);

  // The old page header's "Run state crawlers": every crawlable non-federal source.
  const runAll = async () => {
    setIsRunning(true);
    setNotice(null);
    try {
      await runStateCrawlersNow();
      setNotice(t("admin.runQueued"));
      setLogsRevision((revision) => revision + 1);
    } catch {
      setNotice(t("admin.runFailed"));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {canRunOperations && (
        <div className="flex justify-end">
          <Button onClick={() => void runAll()} disabled={isRunning} className="h-10 rounded-lg bg-slate-900 text-white hover:bg-slate-800">
            <Play size={16} />
            {isRunning ? t("admin.running") : t("admin.runStateCrawlers")}
          </Button>
        </div>
      )}
      <AdminNotice message={notice} />
      {index.data ? (
        <JurisdictionBatchRunPanel sources={index.data} crawlerSourceIdFor={crawlerRunIdFor} disabled={isRunning} />
      ) : (
        <AdminSectionStateCard
          action={index.status === "error" ? () => void index.reload() : undefined}
          actionLabel={t("admin.refresh")}
          code={index.status === "error" ? "error" : "loading"}
          message={index.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
          title={t("admin.batchRunTitle")}
        />
      )}
      <CrawlerLogList key={logsRevision} title={t("admin.recentLogs")} />
    </div>
  );
}
```

(Compare `runAll`'s messages with the old `runNow` handler (L2065-2079) and keep its exact keys.) Pages: `frontend/src/app/admin/sources/onboarding/page.tsx` → `<OnboardingSection />`, `frontend/src/app/admin/sources/runs/page.tsx` → `<CrawlRunsSection />`, each a `"use client"` thin page.

- [ ] **Step 4: Remove the moved pieces from `page.tsx`**

Delete: the `PlatformReviewsPanel`, `LedgeredApprovalPanel` and `JurisdictionBatchRunPanel` mounts with their comments and `platformReviewRevision`; the header "Run state crawlers" button, `runNow` and `isRunning` (write `runningSourceId !== null` where the code said `isRunning || runningSourceId !== null`); the logs section, the `crawlerLogs` slice, `refreshCrawlerLogs` and `logs`; the imports that become unused. Move the failing log assertions of `page.test.ts` to `CrawlRunsSection.test.ts` per the rule.

- [ ] **Step 5: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/sections frontend/src/app/admin/sources/onboarding frontend/src/app/admin/sources/runs frontend/src/components/admin/JurisdictionBatchRunPanel.tsx frontend/src/components/admin/JurisdictionBatchRunPanel.test.ts frontend/src/app/admin/admin-pages.test.ts frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts
git commit -m "feat(admin): onboarding approval and crawl-runs pages"
```

---

### Task 11: Retire the old sources table and dashboard machinery

After Tasks 3–10 the old page still holds the source metric cards and the sources table; everything else has moved. This task deletes them (plan decisions 1 and 12). No replacement lands here — the paginated list comes in Tasks 12–13.

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`, `page.test.ts`, `page.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `page.tsx` reduced to its access gate and header (Task 14 replaces it).

- [ ] **Step 1: Delete the table, the cards and the machinery**

From `page.tsx` delete:
- the summary block (skeleton, fully-failed card, four `SummaryCard`s) — anchor `{state.dataSources.status === "loading" && !summary && !isFullyFailedDashboard && (`;
- the sources section — anchor `{!isFullyFailedDashboard && state.dataSources.status === "error" && (` through the end of the `state.dataSources.status === "ready"` block;
- the section machinery: `SectionLoadStatus`, `AdminSectionState`, `AdminDashboardSections`, `AdminDashboardLoaders`, `sectionLoading/Ready/Error`, `createInitialAdminSectionState`, `createRefreshingAdminSectionState`, `sectionFromSettled`, `loadAdminDashboardSections`, `isAdminDashboardLoading`, `isAdminDashboardFullyFailed`, `state`, `stateRef` and its effect, `load` and its effect, `isLoadingDashboard`, `areMainSectionsFullyFailed`, `isFullyFailedDashboard`;
- the source filters and their helpers: `SourceHealthClassificationFilter`, `SourceHealthTriageStatusFilter`, `SourceOpsFilters`, `SOURCE_HEALTH_CLASSIFICATION_FILTERS`, `SOURCE_HEALTH_TRIAGE_STATUS_FILTERS`, `filterAdminDataSourcesByHealthClassification`, `recommendedActionFor`, `filterAdminDataSourcesBySourceOps`, `sourceRecommendedActionOptions`, `sourceHealthTriageFilterLabel`, `filteredDataSourcesSummary`, the three filter `useState`s;
- the per-source state and handlers: `pendingSourceId`, `sourceApprovalPendingId`, `sourceApprovalBatchPending`, `sourceHealthPendingId`, `sourceTriagePendingId`, `selectedSourceIds`, `runningSourceId`, `runMessage` (and its banner), `replaceSource`, `replaceSources`, `refreshDataSources`, `toggleSource`, `updateSourceApproval`, `toggleSelectedSourceId`, `toggleAllVisibleSources`, `batchUpdateSourceApproval`, `recheckSourceHealth`, `updateSourceHealthTriage`, `runSourceNow`;
- the header "Refresh" button (nothing is left to refresh);
- every import that becomes unused.

What remains: the gate (`isAuthLoading`, `!user`, `!canAccessAdminConsole`) and the `<h1>`/description header.

- [ ] **Step 2: Clean the page tests**

In `page.test.ts` delete the tests of deleted code: 3 and 4 (dashboard loading), 5–7 (health-classification and source-ops filters) and the source-table assertions of test 1 (branch-start L108-163) — the filters they cover are dropped by plan decision 12. Keep the access-gate and header assertions. In `page.test.tsx` delete tests 3 and 4 (source health classification structure) for the same reason; if the file is then empty, delete it. List every deleted test name in your report.

- [ ] **Step 3: Run the tests and gates**

Run: `cd frontend && npx vitest run src/app/admin src/components/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/admin/page.tsx frontend/src/app/admin/page.test.ts frontend/src/app/admin/page.test.tsx
git commit -m "refactor(admin): retire the old sources table and dashboard loader"
```

(If `page.test.tsx` was deleted, `git add` still stages the deletion.)

---
### Task 12: Paginated source-list API

**Files:**
- Modify: `frontend/src/server/admin/data-source-list-contract.ts`
- Modify: `frontend/src/server/admin/data-source-query.ts`, `data-source-query.test.ts`
- Modify: `frontend/src/app/api/admin/data-sources/route.ts`, `route.test.ts`
- Modify: `frontend/src/lib/api/admin.ts`, `admin.test.ts`

**Interfaces:**
- Consumes: Task 6's `parseSourceListFilters`, `sourceFilterWhere`, fragments and runner.
- Produces:
  - Contract: `SOURCE_LIST_SORT_KEYS`, `SourceListSortKey`, `SOURCE_LIST_DEFAULT_PAGE_SIZE` (50), `SOURCE_LIST_MAX_PAGE_SIZE` (200), `SOURCE_LIST_PAGE_SIZES` (`[25, 50, 100, 200]`), `SOURCE_FACET_KEYS`, `SourceListQuery`, `defaultSourceListQuery()`, `AdminDataSourceListItem`, `SourceFacetCount`, `SourceListFacets`, `AdminDataSourceListResponse`.
  - Query: `parseSourceListQuery(params)`, `sourceListOrderBy(sort, descending)`, `listSourcePage(runner, query)`, `listAdminDataSourcesPage(db, query)`, `listAdminDataSourcesPageFromMysql(mysql, query)`.
  - `GET /api/admin/data-sources` answers `AdminDataSourceListResponse` (the old `{ summary, sources }` is gone).
  - Client: `listAdminDataSourcesPage(query?: Partial<SourceListQuery>)`; `listAdminDataSources()` is removed.

- [ ] **Step 1: Extend the contract**

Append to `frontend/src/server/admin/data-source-list-contract.ts`:

```ts
export const SOURCE_LIST_SORT_KEYS = ["label", "lastRun", "failures", "updated"] as const;
export type SourceListSortKey = (typeof SOURCE_LIST_SORT_KEYS)[number];

export const SOURCE_LIST_DEFAULT_PAGE_SIZE = 50;
export const SOURCE_LIST_MAX_PAGE_SIZE = 200;
export const SOURCE_LIST_PAGE_SIZES = [25, 50, 100, 200] as const;
export const SOURCE_FACET_KEYS: readonly SourceFacetKey[] = ["level", "state", "platform", "approval", "health"];

export interface SourceListQuery extends SourceListFilters {
  sort: SourceListSortKey;
  descending: boolean;
  page: number;
  pageSize: number;
}

export function defaultSourceListQuery(): SourceListQuery {
  return { ...emptySourceListFilters(), sort: "label", descending: false, page: 1, pageSize: SOURCE_LIST_DEFAULT_PAGE_SIZE };
}

export interface AdminDataSourceListItem {
  id: string;
  label: string;
  stateCode: string;
  level: CoverageLevel;
  issuerType: string;
  jurisdictionLevel: string | null;
  jurisdictionName: string | null;
  providerFamily: string;
  approvalState: SourceApprovalState;
  isEnabled: boolean;
  health: SourceHealthState;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  precheckRequestedAt: string | null;
  liveHealthDisposition: string | null;
  crawlerSourceId: string | null;
}

export interface SourceFacetCount {
  value: string;
  count: number;
}

export type SourceListFacets = Record<SourceFacetKey, SourceFacetCount[]>;

export interface AdminDataSourceListResponse {
  items: AdminDataSourceListItem[];
  total: number;
  page: number;
  pageSize: number;
  facets: SourceListFacets;
}
```

- [ ] **Step 2: Write the failing page tests**

Append to `frontend/src/server/admin/data-source-query.test.ts` (reuse its `row` helper; give three rows distinct run times so ordering is observable):

```ts
import { defaultSourceListQuery, type SourceListQuery } from "./data-source-list-contract";
import { listAdminDataSourcesPage, listAdminDataSourcesPageFromMysql, parseSourceListQuery } from "./data-source-query";

const PAGE_ROWS = [
  row("ca_state", { label: "California Cal eProcure", issuerType: "state", stateCode: "CA", jurisdictionLevel: null, providerFamily: null, approvalStatus: "approved", lastSuccessAt: "2026-09-29T06:00:00.000Z" }),
  row("sam_gov", { label: "SAM.gov", issuerType: "federal", stateCode: "US", jurisdictionLevel: null, providerFamily: null }),
  row("bidnet_co_denver", { label: "City and County of Denver", jurisdictionName: "Denver", approvalStatus: "approved", lastSuccessAt: "2026-09-29T07:00:00.000Z" }),
  row("bidnet_co_aurora", { label: "City of Aurora", issuerType: "city", jurisdictionLevel: "city", jurisdictionName: "Aurora" }),
  row("bidnet_mi_twp", { label: "Canton Township", issuerType: "township", stateCode: "MI", jurisdictionLevel: "township", approvalStatus: "needs_review", consecutiveFailures: 2, lastFailureAt: "2026-09-29T05:00:00.000Z" }),
  row("bidnet_oh_block", { label: "Blocked County", stateCode: "OH", approvalStatus: "blocked", isEnabled: 0 }),
  row("odd_level", { label: "Odd 100% match", issuerType: "municipal", jurisdictionLevel: null, stateCode: "TX", providerFamily: "periscope" }),
];

function pageQuery(overrides: Partial<SourceListQuery>): SourceListQuery {
  return { ...defaultSourceListQuery(), ...overrides };
}

describe("parseSourceListQuery", () => {
  it("reads sort, direction and paging", () => {
    expect(parseSourceListQuery(new URLSearchParams("sort=-lastRun&page=2&pageSize=25"))).toMatchObject({ sort: "lastRun", descending: true, page: 2, pageSize: 25 });
    expect(parseSourceListQuery(new URLSearchParams(""))).toEqual(defaultSourceListQuery());
  });

  it.each([["sort=bogus"], ["page=0"], ["page=1.5"], ["pageSize=201"], ["pageSize=abc"]])("rejects %s", (query) => {
    expect(() => parseSourceListQuery(new URLSearchParams(query))).toThrow(DataSourceQueryError);
  });
});

describe("source list page", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db.insert(dataSources).values(PAGE_ROWS).run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  const pageIds = async (overrides: Partial<SourceListQuery>) =>
    (await listAdminDataSourcesPage(testDb.db, pageQuery(overrides))).items.map((item) => item.id);

  it("returns compact rows with the list's health and approval views", async () => {
    const page = await listAdminDataSourcesPage(testDb.db, defaultSourceListQuery());
    expect(page.total).toBe(7);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(50);
    expect(page.items.find((item) => item.id === "bidnet_mi_twp")).toEqual({
      id: "bidnet_mi_twp",
      label: "Canton Township",
      stateCode: "MI",
      level: "township",
      issuerType: "township",
      jurisdictionLevel: "township",
      jurisdictionName: null,
      providerFamily: "bidnet",
      approvalState: "awaiting",
      isEnabled: true,
      health: "failing",
      lastSuccessAt: null,
      lastFailureAt: "2026-09-29T05:00:00.000Z",
      consecutiveFailures: 2,
      precheckRequestedAt: null,
      liveHealthDisposition: null,
      crawlerSourceId: null,
    });
  });

  it("pages and rejects a page past the end", async () => {
    expect(await pageIds({ pageSize: 2, page: 2 })).toEqual(["bidnet_mi_twp", "bidnet_co_denver"]);
    expect(await pageIds({ pageSize: 2, page: 4 })).toEqual(["sam_gov"]);
    await expect(listAdminDataSourcesPage(testDb.db, pageQuery({ pageSize: 2, page: 5 }))).rejects.toThrow(DataSourceQueryError);
  });

  it("sorts by failures and by last run with never-run rows last", async () => {
    expect(await pageIds({ sort: "failures", descending: true })).toEqual([
      "bidnet_mi_twp",
      "bidnet_oh_block",
      "ca_state",
      "bidnet_co_denver",
      "bidnet_co_aurora",
      "odd_level",
      "sam_gov",
    ]);
    expect(await pageIds({ sort: "lastRun", descending: true })).toEqual([
      "bidnet_co_denver",
      "ca_state",
      "bidnet_mi_twp",
      "bidnet_co_aurora",
      "bidnet_oh_block",
      "odd_level",
      "sam_gov",
    ]);
  });

  it("counts each facet with the other dimensions' filters only", async () => {
    const { facets, total } = await listAdminDataSourcesPage(testDb.db, pageQuery({ levels: ["county"] }));
    expect(total).toBe(2);
    expect(facets.level).toEqual([
      { value: "federal", count: 1 },
      { value: "state", count: 1 },
      { value: "county", count: 2 },
      { value: "city", count: 1 },
      { value: "township", count: 1 },
      { value: "unknown", count: 1 },
    ]);
    expect(facets.state).toEqual([
      { value: "CO", count: 1 },
      { value: "OH", count: 1 },
    ]);
    expect(facets.approval).toEqual([
      { value: "approved", count: 1 },
      { value: "blocked", count: 1 },
    ]);
    expect(facets.health).toEqual([
      { value: "healthy", count: 1 },
      { value: "disabled", count: 1 },
    ]);
    expect(facets.platform).toEqual([{ value: "bidnet", count: 2 }]);
  });

  it("runs the same SQL on MySQL with LIMIT/OFFSET values and string counts", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT COUNT(*) AS total")) return [[{ total: "3" }]] as [unknown[]];
      if (sql.includes(" AS facet_value")) return [[{ facet_value: "county", total: "3" }]] as [unknown[]];
      return [[]] as [unknown[]];
    });
    const page = await listAdminDataSourcesPageFromMysql({ query }, pageQuery({ page: 2, pageSize: 2 }));
    expect(page.total).toBe(3);
    const listCall = query.mock.calls.find(([sql]) => sql.includes("LIMIT ? OFFSET ?")) as unknown as [string, unknown[]];
    expect(listCall[1]).toEqual([2, 2]);
    expect(page.facets.level).toEqual([{ value: "county", count: 3 }]);
  });
});
```

Run: `cd frontend && npx vitest run src/server/admin/data-source-query.test.ts` — Expected: the new tests FAIL.

- [ ] **Step 3: Implement paging, sorting and facets**

Append to `frontend/src/server/admin/data-source-query.ts` (extend its contract import with `SOURCE_FACET_KEYS`, `SOURCE_HEALTH_STATES`, `SOURCE_LIST_DEFAULT_PAGE_SIZE`, `SOURCE_LIST_MAX_PAGE_SIZE`, `SOURCE_LIST_SORT_KEYS`, and the types `AdminDataSourceListItem`, `AdminDataSourceListResponse`, `SourceFacetCount`, `SourceHealthState`, `SourceListFacets`, `SourceListQuery`, `SourceListSortKey`):

```ts
function positiveInteger(raw: string | null, fallback: number, key: string): number {
  if (raw === null || raw.trim() === "") return fallback;
  const text = raw.trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) throw new DataSourceQueryError(`${key} must be a positive integer`);
  return Number(text);
}

/** Spec §5.1 list parameters: the filters plus sort (`-` for descending), page and pageSize. */
export function parseSourceListQuery(params: URLSearchParams): SourceListQuery {
  const filters = parseSourceListFilters(params);
  const rawSort = params.get("sort")?.trim() || "label";
  const descending = rawSort.startsWith("-");
  const sortKey = descending ? rawSort.slice(1) : rawSort;
  if (!(SOURCE_LIST_SORT_KEYS as readonly string[]).includes(sortKey)) throw new DataSourceQueryError(`unknown sort: ${rawSort}`);
  const page = positiveInteger(params.get("page"), 1, "page");
  const pageSize = positiveInteger(params.get("pageSize"), SOURCE_LIST_DEFAULT_PAGE_SIZE, "pageSize");
  if (pageSize > SOURCE_LIST_MAX_PAGE_SIZE) throw new DataSourceQueryError(`pageSize must be at most ${SOURCE_LIST_MAX_PAGE_SIZE}`);

  return { ...filters, sort: sortKey as SourceListSortKey, descending, page, pageSize };
}

const LAST_RUN_AT_SQL =
  "(CASE WHEN last_success_at IS NULL THEN last_failure_at WHEN last_failure_at IS NULL THEN last_success_at WHEN last_success_at >= last_failure_at THEN last_success_at ELSE last_failure_at END)";

/** Stable order: every sort ends on id; rows that never ran sort last in both directions. */
export function sourceListOrderBy(sort: SourceListSortKey, descending: boolean): string {
  const direction = descending ? "DESC" : "ASC";
  switch (sort) {
    case "label":
      return `LOWER(label) ${direction}, id ASC`;
    case "lastRun":
      return `(${LAST_RUN_AT_SQL} IS NULL) ASC, ${LAST_RUN_AT_SQL} ${direction}, id ASC`;
    case "failures":
      return `consecutive_failures ${direction}, LOWER(label) ASC, id ASC`;
    case "updated":
      return `updated_at ${direction}, id ASC`;
  }
}

const FACET_EXPRESSIONS: Record<SourceFacetKey, string> = {
  level: LEVEL_SQL,
  state: "state_code",
  platform: PLATFORM_SQL,
  approval: APPROVAL_STATE_SQL,
  health: HEALTH_STATE_SQL,
};

const LIST_COLUMNS = `id, label, state_code, issuer_type, jurisdiction_level, jurisdiction_name, is_enabled, ${LEVEL_SQL} AS coverage_level, ${PLATFORM_SQL} AS platform, ${APPROVAL_STATE_SQL} AS approval_state, ${HEALTH_STATE_SQL} AS health_state, last_success_at, last_failure_at, consecutive_failures, precheck_requested_at, live_health_disposition`;

interface ListRow extends IndexRow {
  jurisdiction_name: string | null;
  health_state: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: unknown;
  precheck_requested_at: string | null;
  live_health_disposition: string | null;
}

function toListItem(row: ListRow): AdminDataSourceListItem {
  return {
    ...toIndexItem(row),
    jurisdictionName: row.jurisdiction_name ?? null,
    health: row.health_state as SourceHealthState,
    lastSuccessAt: row.last_success_at ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    consecutiveFailures: sqlCount(row.consecutive_failures),
    precheckRequestedAt: row.precheck_requested_at ?? null,
    liveHealthDisposition: row.live_health_disposition ?? null,
  };
}

function orderFacet(key: SourceFacetKey, counts: SourceFacetCount[]): SourceFacetCount[] {
  const canonical: readonly string[] | null =
    key === "level" ? COVERAGE_LEVELS : key === "approval" ? SOURCE_APPROVAL_STATES : key === "health" ? SOURCE_HEALTH_STATES : null;
  if (canonical) return [...counts].sort((a, b) => canonical.indexOf(a.value) - canonical.indexOf(b.value));
  if (key === "state") return [...counts].sort((a, b) => a.value.localeCompare(b.value));
  return [...counts].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

async function sourceFacets(runner: AdminSqlRunner, filters: SourceListFilters): Promise<SourceListFacets> {
  const entries = await Promise.all(
    SOURCE_FACET_KEYS.map(async (key) => {
      const where = sourceFilterWhere(filters, key);
      const expression = FACET_EXPRESSIONS[key];
      const rows = await runner.all<{ facet_value: unknown; total: unknown }>(
        `SELECT ${expression} AS facet_value, COUNT(*) AS total FROM data_sources ${where.sql} GROUP BY ${expression}`,
        where.values,
      );
      return [key, orderFacet(key, rows.map((row) => ({ value: String(row.facet_value), count: sqlCount(row.total) })))] as const;
    }),
  );
  return Object.fromEntries(entries) as SourceListFacets;
}

/** Spec §5.1: one page of compact rows, the total and the facets. */
export async function listSourcePage(runner: AdminSqlRunner, query: SourceListQuery): Promise<AdminDataSourceListResponse> {
  const where = sourceFilterWhere(query);
  const [countRow] = await runner.all<{ total: unknown }>(`SELECT COUNT(*) AS total FROM data_sources ${where.sql}`, where.values);
  const total = sqlCount(countRow?.total);
  const lastPage = Math.max(1, Math.ceil(total / query.pageSize));
  if (query.page > lastPage) throw new DataSourceQueryError(`page ${query.page} is out of range (last page ${lastPage})`);

  const [rows, facets] = await Promise.all([
    runner.all<ListRow>(
      `SELECT ${LIST_COLUMNS} FROM data_sources ${where.sql} ORDER BY ${sourceListOrderBy(query.sort, query.descending)} LIMIT ? OFFSET ?`,
      [...where.values, query.pageSize, (query.page - 1) * query.pageSize],
    ),
    sourceFacets(runner, query),
  ]);

  return { items: rows.map(toListItem), total, page: query.page, pageSize: query.pageSize, facets };
}

export function listAdminDataSourcesPage(db: AppDatabase, query: SourceListQuery) {
  return listSourcePage(sqliteSqlRunner(db), query);
}

export function listAdminDataSourcesPageFromMysql(mysql: MysqlSqlReader, query: SourceListQuery) {
  return listSourcePage(mysqlSqlRunner(mysql), query);
}
```

Run the query tests — Expected: PASS.

- [ ] **Step 4: Switch the route**

Replace `frontend/src/app/api/admin/data-sources/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { requireAdminAccess, AdminAuthError } from "@/server/admin/auth";
import {
  DataSourceQueryError,
  listAdminDataSourcesPage,
  listAdminDataSourcesPageFromMysql,
  parseSourceListQuery,
} from "@/server/admin/data-source-query";
import type { MysqlSqlReader } from "@/server/admin/sql-runner";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }
  if (error instanceof DataSourceQueryError) {
    return errorResponse("INVALID_REQUEST", error.message, 400);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;
  if (isMysqlDatabaseUrlConfigured()) return {} as AppDatabase;

  const client = await import("@/server/db/client");
  return client.db;
}

/** Spec §5.1: server-side filtered, sorted, paginated source list with facets. */
export function createAdminDataSourcesGet(database?: AppDatabase, mysql?: MysqlSqlReader) {
  const shouldUseMysqlRuntime = () => Boolean(mysql) || (!database && isMysqlDatabaseUrlConfigured());

  return async function GET(request: Request) {
    try {
      const resolvedDb = await resolveDatabase(database);
      await requireAdminAccess(resolvedDb, request, { roles: ["admin", "operator", "support"] });
      const query = parseSourceListQuery(new URL(request.url).searchParams);
      return NextResponse.json(
        shouldUseMysqlRuntime()
          ? await listAdminDataSourcesPageFromMysql(mysql ?? resolveMysqlPool(), query)
          : await listAdminDataSourcesPage(resolvedDb, query),
      );
    } catch (error) {
      return routeError(error);
    }
  };
}

export const GET = createAdminDataSourcesGet();
```

Rewrite `frontend/src/app/api/admin/data-sources/route.test.ts`: keep the 403 test; replace the two `summary`/`sources` tests with (a) 200 on a seeded state row whose body equals `{ items: [expect.objectContaining({ id: "california_caleprocure", crawlerSourceId: "ca_caleprocure", level: "state" })], total: 1, page: 1, pageSize: 50, facets: expect.objectContaining({ level: [{ value: "state", count: 1 }] }) }`, (b) 400 `INVALID_REQUEST` for `?pageSize=500`, `?sort=bogus` and `?page=3` (out of range), (c) an injected fake MySQL store being called. The old live-health assertion moves nowhere: list rows no longer carry live health (the detail endpoint does — Task 8 covers it); note that in your report.

- [ ] **Step 5: Replace the client helper**

In `frontend/src/lib/api/admin.ts`: remove `listAdminDataSources()` (nothing calls it after Task 11; `grep -rn "listAdminDataSources()" frontend/src` must be empty), import and re-export the list types (`AdminDataSourceListItem`, `AdminDataSourceListResponse`, `SourceListQuery`, `SourceFacetCount`), and add:

```ts
/** Spec §5.1: one page of the source list with facets. */
export async function listAdminDataSourcesPage(query: Partial<SourceListQuery> = {}) {
  const response = await fetch(
    `/api/admin/data-sources${buildQueryString({
      ...sourceFilterParams(query),
      sort: query.sort ? `${query.descending ? "-" : ""}${query.sort}` : undefined,
      page: query.page,
      pageSize: query.pageSize,
    })}`,
  );

  return parseResponse<AdminDataSourceListResponse>(response);
}
```

In `admin.test.ts` replace "lists admin data sources" with a case calling `listAdminDataSourcesPage({ levels: ["county"], approvals: ["awaiting"], sort: "lastRun", descending: true, page: 2, pageSize: 25 })` and expecting the URL `/api/admin/data-sources?level=county&approval=awaiting&sort=-lastRun&page=2&pageSize=25`.

- [ ] **Step 6: Run the tests and gates**

Run: `cd frontend && npx vitest run src/server/admin src/app/api/admin/data-sources src/lib/api/admin.test.ts src/server/auth/role-route-coverage.test.ts src/server/db/mysql-route-coverage.test.ts scripts/demo-smoke.test.ts`
Expected: PASS. Then `npm run lint`, the non-test type gate and `npm run build`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/server/admin/data-source-list-contract.ts frontend/src/server/admin/data-source-query.ts frontend/src/server/admin/data-source-query.test.ts frontend/src/app/api/admin/data-sources/route.ts frontend/src/app/api/admin/data-sources/route.test.ts frontend/src/lib/api/admin.ts frontend/src/lib/api/admin.test.ts
git commit -m "feat(admin-api): server-side paginated data-source list with facets"
```

---

### Task 13: Source list page

**Files:**
- Create: `frontend/src/components/admin/sources/source-list-url.ts`, `source-list-url.test.ts`
- Create: `frontend/src/components/admin/sources/source-bulk-actions.ts`, `source-bulk-actions.test.ts`
- Create: `frontend/src/components/admin/sources/SourcesListView.tsx`, `SourcesListView.test.ts`
- Create: `frontend/src/app/admin/sources/page.tsx`
- Modify: `frontend/src/app/admin/admin-pages.test.ts`, `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`

**Interfaces:**
- Consumes: Task 12's `listAdminDataSourcesPage`, contract types and `defaultSourceListQuery`; Task 6's `listAdminDataSourceIndex`; Task 9's `crawlerRunIdFor`, level/approval/health keys; phase-3 `requestAdminSourcePrechecks` (≤ 500 ids per call), `batchUpdateAdminDataSources` (≤ 100 ids per call; approve answers `{ updatedCount, skippedCount?, outcomes? }`), `chunkSourceIds` (`LedgeredApprovalPanel`), `runStateCrawlersNow`.
- Produces: `SourcesListView`; pure `readSourceListQuery`, `writeSourceListQuery`, `toggleFacetValue`, `selectedFacetValues`, `facetOptions`, `pageRange`, `lastRunOf`, `runTargets`, `summarizeRunResults`.

- [ ] **Step 1: Add the i18n keys**

Append at the end of `admin` in both dictionaries:

| key | en | zh |
| --- | --- | --- |
| `sourcesSearchPlaceholder` | Search id, name or jurisdiction | 搜索 id、名称或辖区 |
| `sourcesSearch` | Search | 搜索 |
| `sourcesAddState` | Add a state | 添加州 |
| `sourcesSort` | Sort | 排序 |
| `sourcesSort_label` | Name | 名称 |
| `sourcesSort_lastRun` | Last run | 最近运行 |
| `sourcesSort_failures` | Failures | 失败次数 |
| `sourcesSort_updated` | Updated | 更新时间 |
| `sourcesSortDescending` | Descending | 降序 |
| `sourcesClearFilters` | Clear filters | 清除筛选 |
| `sourcesEmpty` | No sources match these filters. | 没有符合筛选条件的数据源。 |
| `sourcesInvalidQuery` | The link had filters this page does not know; only the valid ones are applied. | 链接中有无法识别的筛选条件，已只保留有效条件。 |
| `sourcesQueryRejected` | The list could not use these filters; showing the defaults. | 列表无法使用这些筛选条件，已恢复默认。 |
| `paginationSummary` | {from}–{to} of {total} | 第 {from}–{to} 条，共 {total} 条 |
| `paginationPrevious` | Previous | 上一页 |
| `paginationNext` | Next | 下一页 |
| `paginationPageSize` | Per page | 每页 |
| `sourcesSelectedCount` | {count} selected | 已选 {count} 个 |
| `sourcesQueuePrechecks` | Queue prechecks | 预检入队 |
| `sourcesQueueAllMatching` | Queue all {count} matching | 全部 {count} 个匹配项入队 |
| `sourcesQueuedResult` | Queued {count} prechecks. | 已入队 {count} 个预检。 |
| `sourcesApproveWithLedger` | Approve with ledger | 带台账批准 |
| `sourcesRunLimit` | Select at most {max} sources to run at once. | 一次最多选择 {max} 个数据源运行。 |
| `sourcesRunResult` | Ran {count}: {ok} succeeded, {failed} failed, {skipped} skipped. | 已运行 {count} 个：成功 {ok}，失败 {failed}，跳过 {skipped}。 |
| `sourcesNotRunnable` | {count} selected sources have no crawler run id and were not run. | {count} 个所选数据源没有可运行的抓取任务 id，未运行。 |

- [ ] **Step 2: Write the failing pure-helper tests**

`frontend/src/components/admin/sources/source-list-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultSourceListQuery, type SourceListQuery } from "@/server/admin/data-source-list-contract";
import { facetOptions, lastRunOf, pageRange, readSourceListQuery, selectedFacetValues, toggleFacetValue, writeSourceListQuery } from "./source-list-url";

describe("source list URL state", () => {
  it("reads a valid URL", () => {
    const { query, invalid } = readSourceListQuery(new URLSearchParams("level=county&state=co&platform=bidnet&approval=awaiting&health=failing&q=den&sort=-lastRun&page=2&pageSize=100"));
    expect(invalid).toBe(false);
    expect(query).toEqual({ levels: ["county"], states: ["CO"], platforms: ["bidnet"], approvals: ["awaiting"], healths: ["failing"], q: "den", sort: "lastRun", descending: true, page: 2, pageSize: 100 });
  });

  it("drops unknown values and reports them", () => {
    const { query, invalid } = readSourceListQuery(new URLSearchParams("level=galaxy&level=city&state=Colorado&sort=bogus&page=-1&pageSize=7"));
    expect(invalid).toBe(true);
    expect(query).toEqual({ ...defaultSourceListQuery(), levels: ["city"] });
  });

  it("writes a canonical URL that omits defaults and round-trips", () => {
    expect(writeSourceListQuery(defaultSourceListQuery())).toBe("");
    const query: SourceListQuery = { ...defaultSourceListQuery(), levels: ["county", "city"], q: "den", sort: "failures", descending: true, page: 3 };
    const text = writeSourceListQuery(query);
    expect(text).toBe("?level=county&level=city&q=den&sort=-failures&page=3");
    expect(readSourceListQuery(new URLSearchParams(text.slice(1))).query).toEqual(query);
  });

  it("toggles a facet value and goes back to page 1", () => {
    const start = { ...defaultSourceListQuery(), page: 4 };
    const added = toggleFacetValue(start, "approval", "awaiting");
    expect(selectedFacetValues(added, "approval")).toEqual(["awaiting"]);
    expect(added.page).toBe(1);
    expect(selectedFacetValues(toggleFacetValue(added, "approval", "awaiting"), "approval")).toEqual([]);
  });

  it("keeps a selected value visible with count 0", () => {
    expect(facetOptions([{ value: "CO", count: 3 }], ["CO", "OH"])).toEqual([
      { value: "CO", count: 3 },
      { value: "OH", count: 0 },
    ]);
  });

  it("describes the page range and the last run", () => {
    expect(pageRange(0, 1, 50)).toEqual({ from: 0, to: 0, lastPage: 1 });
    expect(pageRange(1020, 21, 50)).toEqual({ from: 1001, to: 1020, lastPage: 21 });
    expect(lastRunOf({ lastSuccessAt: "2026-09-29T07:00:00.000Z", lastFailureAt: "2026-09-29T05:00:00.000Z" })).toBe("2026-09-29T07:00:00.000Z");
    expect(lastRunOf({ lastSuccessAt: null, lastFailureAt: "2026-09-29T05:00:00.000Z" })).toBe("2026-09-29T05:00:00.000Z");
    expect(lastRunOf({ lastSuccessAt: null, lastFailureAt: null })).toBeNull();
  });
});
```

`frontend/src/components/admin/sources/source-bulk-actions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RUN_NOW_LIMIT, runTargets, summarizeRunResults } from "./source-bulk-actions";

describe("source bulk actions", () => {
  it("resolves crawler run ids and reports the rows without one", () => {
    expect(
      runTargets([
        { id: "bidnet_co_denver", issuerType: "county", stateCode: "CO", crawlerSourceId: null },
        { id: "sam_gov", issuerType: "federal", stateCode: "US", crawlerSourceId: null },
        { id: "ca_state", issuerType: "state", stateCode: "CA", crawlerSourceId: "ca_caleprocure" },
      ]),
    ).toEqual({ runIds: ["bidnet_co_denver", "ca_caleprocure"], skippedIds: ["sam_gov"] });
    expect(RUN_NOW_LIMIT).toBe(20);
  });

  it("summarises a run response", () => {
    expect(
      summarizeRunResults({
        ok: false,
        status: "completed_with_failures",
        results: [
          { source: "a", ok: true, status: "success" },
          { source: "b", ok: false, status: "failure" },
          { source: "c", ok: false, status: "blocked" },
          { source: "d", ok: false, status: "deferred" },
        ],
        errors: [{ source: "e", code: "UNKNOWN_SOURCE", message: "unknown" }],
      }),
    ).toEqual({ ok: 1, failed: 2, skipped: 2 });
  });
});
```

Run both — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the pure helpers**

`frontend/src/components/admin/sources/source-list-url.ts`:

```ts
import {
  COVERAGE_LEVELS,
  SOURCE_APPROVAL_STATES,
  SOURCE_HEALTH_STATES,
  SOURCE_LIST_DEFAULT_PAGE_SIZE,
  SOURCE_LIST_MAX_QUERY_LENGTH,
  SOURCE_LIST_PAGE_SIZES,
  SOURCE_LIST_SORT_KEYS,
  defaultSourceListQuery,
  type SourceFacetCount,
  type SourceFacetKey,
  type SourceListQuery,
  type SourceListSortKey,
} from "@/server/admin/data-source-list-contract";

const STATE_PATTERN = /^[A-Z]{2}$/;
const PLATFORM_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

const FACET_FIELD = {
  level: "levels",
  state: "states",
  platform: "platforms",
  approval: "approvals",
  health: "healths",
} as const satisfies Record<SourceFacetKey, keyof SourceListQuery>;

/**
 * The page URL, read leniently: unknown values are dropped (and reported so the page can say so and
 * rewrite the URL) and never reach the API, which would answer 400 for them.
 */
export function readSourceListQuery(params: URLSearchParams): { query: SourceListQuery; invalid: boolean } {
  let invalid = false;
  const keep = (values: string[], accept: (value: string) => boolean) => {
    const unique = Array.from(new Set(values));
    const kept = unique.filter(accept);
    if (kept.length !== unique.length) invalid = true;
    return kept;
  };
  const oneOf = (allowed: readonly string[]) => (value: string) => allowed.includes(value);

  const rawSort = params.get("sort") ?? "label";
  const descending = rawSort.startsWith("-");
  const sortKey = descending ? rawSort.slice(1) : rawSort;
  const sortIsValid = (SOURCE_LIST_SORT_KEYS as readonly string[]).includes(sortKey);
  if (!sortIsValid) invalid = true;

  const rawPage = params.get("page");
  const page = rawPage && /^\d+$/.test(rawPage) && Number(rawPage) >= 1 ? Number(rawPage) : 1;
  if (rawPage !== null && page !== Number(rawPage)) invalid = true;

  const rawPageSize = params.get("pageSize");
  const pageSize = rawPageSize && (SOURCE_LIST_PAGE_SIZES as readonly number[]).includes(Number(rawPageSize)) ? Number(rawPageSize) : SOURCE_LIST_DEFAULT_PAGE_SIZE;
  if (rawPageSize !== null && pageSize !== Number(rawPageSize)) invalid = true;

  const q = (params.get("q") ?? "").trim().slice(0, SOURCE_LIST_MAX_QUERY_LENGTH);

  const query: SourceListQuery = {
    levels: keep(params.getAll("level"), oneOf(COVERAGE_LEVELS)) as SourceListQuery["levels"],
    states: keep(params.getAll("state").map((value) => value.toUpperCase()), (value) => STATE_PATTERN.test(value)),
    platforms: keep(params.getAll("platform").map((value) => value.toLowerCase()), (value) => PLATFORM_PATTERN.test(value)),
    approvals: keep(params.getAll("approval"), oneOf(SOURCE_APPROVAL_STATES)) as SourceListQuery["approvals"],
    healths: keep(params.getAll("health"), oneOf(SOURCE_HEALTH_STATES)) as SourceListQuery["healths"],
    q: q || null,
    sort: sortIsValid ? (sortKey as SourceListSortKey) : "label",
    descending: sortIsValid ? descending : false,
    page,
    pageSize,
  };
  return { query, invalid };
}

/** Canonical search string ("" for the defaults); the page writes it with router.replace. */
export function writeSourceListQuery(query: SourceListQuery): string {
  const params = new URLSearchParams();
  for (const level of query.levels) params.append("level", level);
  for (const state of query.states) params.append("state", state);
  for (const platform of query.platforms) params.append("platform", platform);
  for (const approval of query.approvals) params.append("approval", approval);
  for (const health of query.healths) params.append("health", health);
  if (query.q) params.set("q", query.q);
  if (query.sort !== "label" || query.descending) params.set("sort", `${query.descending ? "-" : ""}${query.sort}`);
  if (query.page !== 1) params.set("page", String(query.page));
  if (query.pageSize !== SOURCE_LIST_DEFAULT_PAGE_SIZE) params.set("pageSize", String(query.pageSize));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function selectedFacetValues(query: SourceListQuery, facet: SourceFacetKey): string[] {
  return [...query[FACET_FIELD[facet]]];
}

export function toggleFacetValue(query: SourceListQuery, facet: SourceFacetKey, value: string): SourceListQuery {
  const current = selectedFacetValues(query, facet);
  const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
  return { ...query, [FACET_FIELD[facet]]: next, page: 1 };
}

/** The facet's counted values plus any selected value the counts no longer contain (count 0), so it stays clearable. */
export function facetOptions(counts: readonly SourceFacetCount[], selected: readonly string[]): SourceFacetCount[] {
  const known = new Set(counts.map((count) => count.value));
  return [...counts, ...selected.filter((value) => !known.has(value)).map((value) => ({ value, count: 0 }))];
}

export function pageRange(total: number, page: number, pageSize: number) {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return { from: 0, to: 0, lastPage };
  return { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize), lastPage };
}

export function lastRunOf(item: { lastSuccessAt: string | null; lastFailureAt: string | null }): string | null {
  if (!item.lastSuccessAt) return item.lastFailureAt;
  if (!item.lastFailureAt) return item.lastSuccessAt;
  return item.lastSuccessAt >= item.lastFailureAt ? item.lastSuccessAt : item.lastFailureAt;
}

export function hasActiveFilters(query: SourceListQuery): boolean {
  const defaults = defaultSourceListQuery();
  return (
    query.levels.length + query.states.length + query.platforms.length + query.approvals.length + query.healths.length > 0 ||
    query.q !== defaults.q
  );
}
```

`frontend/src/components/admin/sources/source-bulk-actions.ts`:

```ts
import type { StateCrawlerRunResponse } from "@/lib/api/admin";
import { crawlerRunIdFor, type CrawlerRunSource } from "./crawler-run-id";

/** Spec §5.2 limits. */
export const PRECHECK_REQUEST_CHUNK = 500;
export const RUN_NOW_LIMIT = 20;

export function runTargets(items: readonly CrawlerRunSource[]): { runIds: string[]; skippedIds: string[] } {
  const runIds: string[] = [];
  const skippedIds: string[] = [];
  for (const item of items) {
    const runId = crawlerRunIdFor(item);
    if (runId) runIds.push(runId);
    else skippedIds.push(item.id);
  }
  return { runIds: Array.from(new Set(runIds)), skippedIds };
}

/** success → ok; failure and unknown ids → failed; blocked/locked/disabled/deferred → skipped. */
export function summarizeRunResults(response: StateCrawlerRunResponse): { ok: number; failed: number; skipped: number } {
  let ok = 0;
  let failed = response.errors?.length ?? 0;
  let skipped = 0;
  for (const result of response.results) {
    if (result.status === "success") ok += 1;
    else if (result.status === "failure") failed += 1;
    else skipped += 1;
  }
  return { ok, failed, skipped };
}
```

Run the two tests — Expected: PASS.

- [ ] **Step 4: Build the list view and page**

`frontend/src/components/admin/sources/SourcesListView.tsx` (Client Component). Structure and behaviour — implement exactly this; styling follows the existing admin tables (`rounded-lg border border-slate-200 bg-white shadow-sm`, `Table` from `@/components/ui/table`, chip buttons as `Button size="sm"` with `variant={active ? "default" : "outline"}`):

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { approvalReasonKey, chunkSourceIds, APPROVAL_BATCH_CHUNK_SIZE } from "@/components/admin/LedgeredApprovalPanel";
import {
  AdminApiError,
  batchUpdateAdminDataSources,
  listAdminDataSourceIndex,
  listAdminDataSourcesPage,
  requestAdminSourcePrechecks,
  runStateCrawlersNow,
  type AdminDataSourceListItem,
} from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import {
  SOURCE_LIST_PAGE_SIZES,
  SOURCE_LIST_SORT_KEYS,
  defaultSourceListQuery,
  type SourceFacetKey,
  type SourceListQuery,
} from "@/server/admin/data-source-list-contract";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { PRECHECK_REQUEST_CHUNK, RUN_NOW_LIMIT, runTargets, summarizeRunResults } from "./source-bulk-actions";
import {
  facetOptions,
  hasActiveFilters,
  lastRunOf,
  pageRange,
  readSourceListQuery,
  selectedFacetValues,
  toggleFacetValue,
  writeSourceListQuery,
} from "./source-list-url";

const CHIP_FACETS: SourceFacetKey[] = ["level", "approval", "health", "platform"];
const APPROVAL_TONE = { approved: "border-emerald-200 bg-emerald-50 text-emerald-700", awaiting: "border-amber-200 bg-amber-50 text-amber-800", blocked: "border-rose-200 bg-rose-50 text-rose-700" } as const;
const HEALTH_TONE = { healthy: "border-emerald-200 bg-emerald-50 text-emerald-700", failing: "border-rose-200 bg-rose-50 text-rose-700", never_run: "border-slate-200 bg-slate-50 text-slate-600", disabled: "border-slate-300 bg-slate-100 text-slate-500" } as const;

export function SourcesListView() {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname() ?? "/admin/sources";
  const searchParams = useSearchParams();
  const { canRunOperations, canManageUsers } = useAdminSession();
  const searchString = searchParams?.toString() ?? "";
  const { query, invalid } = useMemo(() => readSourceListQuery(new URLSearchParams(searchString)), [searchString]);
  const canonical = writeSourceListQuery(query);

  const [notice, setNotice] = useState<string | null>(null);
  // Set from effects, rendered with t() — `t` is a new function every render, so effects must not depend on it.
  const [urlNotice, setUrlNotice] = useState<"invalid" | "rejected" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [searchDraft, setSearchDraft] = useState(query.q ?? "");

  const navigate = useCallback(
    (next: SourceListQuery) => {
      setSelectedIds([]);
      router.replace(`${pathname}${writeSourceListQuery(next)}`, { scroll: false });
    },
    [pathname, router],
  );

  // An unknown value in the URL: say so once and rewrite the URL to what is applied.
  useEffect(() => {
    if (!invalid) return;
    queueMicrotask(() => {
      setUrlNotice("invalid");
      router.replace(`${pathname}${canonical}`, { scroll: false });
    });
  }, [invalid, canonical, pathname, router]);

  // Back/forward can change q; keep the search box in step.
  useEffect(() => {
    queueMicrotask(() => setSearchDraft(query.q ?? ""));
  }, [query.q]);

  const loadPage = useCallback(() => listAdminDataSourcesPage(readSourceListQuery(new URLSearchParams(canonical)).query), [canonical]);
  const page = useAdminResource(loadPage);

  // The API refused the parameters (for example a page past the end after rows changed): back to defaults.
  useEffect(() => {
    if (!(page.error instanceof AdminApiError) || page.error.status !== 400) return;
    queueMicrotask(() => {
      setUrlNotice("rejected");
      navigate(defaultSourceListQuery());
    });
  }, [page.error, navigate]);

  const items = page.data?.items ?? [];
  const visibleSelected = selectedIds.filter((id) => items.some((item) => item.id === id));
  const selectedItems = items.filter((item) => visibleSelected.includes(item.id));
  const canSelect = canRunOperations || canManageUsers;
  const range = pageRange(page.data?.total ?? 0, query.page, query.pageSize);

  const runBulk = async (work: () => Promise<string>) => {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await work());
      setSelectedIds([]);
      await page.reload();
    } catch {
      setNotice(t("admin.updateFailed"));
    } finally {
      setBusy(false);
    }
  };

  const queuePrechecks = (ids: string[]) =>
    runBulk(async () => {
      let queued = 0;
      for (const chunk of chunkSourceIds(ids, PRECHECK_REQUEST_CHUNK)) {
        queued += (await requestAdminSourcePrechecks({ sourceIds: chunk })).requestedCount;
      }
      return t("admin.sourcesQueuedResult").replace("{count}", String(queued));
    });

  const queueAllMatching = () =>
    runBulk(async () => {
      const index = await listAdminDataSourceIndex(query);
      let queued = 0;
      for (const chunk of chunkSourceIds(index.items.map((item) => item.id), PRECHECK_REQUEST_CHUNK)) {
        queued += (await requestAdminSourcePrechecks({ sourceIds: chunk })).requestedCount;
      }
      return t("admin.sourcesQueuedResult").replace("{count}", String(queued));
    });

  // Spec §5.2: chunks of 100, the result summarised as approved plus skips grouped by reason.
  const approveSelected = () =>
    runBulk(async () => {
      let approved = 0;
      const skippedByReason = new Map<string, number>();
      for (const chunk of chunkSourceIds(visibleSelected, APPROVAL_BATCH_CHUNK_SIZE)) {
        const response = await batchUpdateAdminDataSources({ sourceIds: chunk, action: "approve" });
        approved += response.updatedCount;
        for (const outcome of response.outcomes ?? []) {
          if (outcome.outcome !== "skipped") continue;
          const reason = outcome.reason ?? "unknown";
          skippedByReason.set(reason, (skippedByReason.get(reason) ?? 0) + 1);
        }
      }
      const skipped = [...skippedByReason.values()].reduce((sum, count) => sum + count, 0);
      if (skipped === 0) return t("admin.sourceBatchApprovalUpdated");
      const reasons = [...skippedByReason.entries()].map(([reason, count]) => {
        const key = approvalReasonKey(reason);
        return `${key ? t(key) : reason} × ${count}`;
      });
      return `${t("admin.ledgeredApprovalResult").replace("{approved}", String(approved)).replace("{skipped}", String(skipped))} ${reasons.join("; ")}`;
    });

  const holdSelected = () =>
    runBulk(async () => {
      for (const chunk of chunkSourceIds(visibleSelected, APPROVAL_BATCH_CHUNK_SIZE)) {
        await batchUpdateAdminDataSources({ sourceIds: chunk, action: "hold" });
      }
      return t("admin.sourceBatchApprovalUpdated");
    });

  const runSelected = () =>
    runBulk(async () => {
      if (selectedItems.length > RUN_NOW_LIMIT) return t("admin.sourcesRunLimit").replace("{max}", String(RUN_NOW_LIMIT));
      const { runIds, skippedIds } = runTargets(selectedItems);
      const parts: string[] = [];
      if (runIds.length > 0) {
        const summary = summarizeRunResults(await runStateCrawlersNow(runIds));
        parts.push(
          t("admin.sourcesRunResult")
            .replace("{count}", String(runIds.length))
            .replace("{ok}", String(summary.ok))
            .replace("{failed}", String(summary.failed))
            .replace("{skipped}", String(summary.skipped)),
        );
      }
      if (skippedIds.length > 0) parts.push(t("admin.sourcesNotRunnable").replace("{count}", String(skippedIds.length)));
      return parts.join(" ");
    });

  const facetLabel = (facet: SourceFacetKey, value: string) =>
    facet === "level" ? t(`admin.coverageLevel_${value}`) : facet === "approval" ? t(`admin.sourcesApproval_${value}`) : facet === "health" ? t(`admin.sourcesHealth_${value}`) : value;

  /* JSX, top to bottom:
     1. {urlNotice && <AdminNotice message={t(urlNotice === "invalid" ? "admin.sourcesInvalidQuery" : "admin.sourcesQueryRejected")} />},
        <AdminNotice message={notice} /> and, when page.status === "error" with data, <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />.
     2. Filter card:
        - for each facet in CHIP_FACETS: a label (t("admin.fieldLevel") / fieldApproval / fieldHealth / fieldPlatform) and one chip per
          facetOptions(page.data?.facets[facet] ?? [], selectedFacetValues(query, facet)) showing `${facetLabel(facet, value)} (${count})`,
          onClick → navigate(toggleFacetValue(query, facet, value)).
        - states: a native <select aria-label={t("admin.fieldState")}> whose first option is t("admin.sourcesAddState") and whose options are
          facets.state (`${value} (${count})`); choosing one → navigate(toggleFacetValue(query, "state", value)); selected states render as
          removable chips (click → toggle off).
        - search: <form onSubmit> with <Input value={searchDraft} placeholder={t("admin.sourcesSearchPlaceholder")}> and a submit
          <Button>{t("admin.sourcesSearch")}</Button>; submit → navigate({ ...query, q: searchDraft.trim() || null, page: 1 }).
        - sort: <select aria-label={t("admin.sourcesSort")}> over SOURCE_LIST_SORT_KEYS labelled t(`admin.sourcesSort_${key}`) and a checkbox
          t("admin.sourcesSortDescending"); change → navigate({ ...query, sort, descending, page: 1 }).
        - when hasActiveFilters(query): <Button variant="ghost">{t("admin.sourcesClearFilters")}</Button> → navigate(defaultSourceListQuery()).
     3. Bulk bar, only when canSelect: t("admin.sourcesSelectedCount") with {count}; buttons, all disabled={busy}:
        - canRunOperations: t("admin.sourcesQueuePrechecks") → queuePrechecks(visibleSelected) (disabled when nothing selected);
          t("admin.sourcesQueueAllMatching") with {count} = page.data.total → queueAllMatching();
          t("admin.sourceDetailRunNow") → runSelected() (disabled when nothing selected).
        - canManageUsers: t("admin.sourcesApproveWithLedger") → approveSelected(); t("admin.holdSource") → holdSelected() (both disabled when nothing selected).
     4. Table: when page.data is null → the loading / error AdminSectionStateCard (title t("admin.nav_sourcesList"), retry → page.reload()).
        Columns: [checkbox when canSelect, header checkbox toggles all visible rows] · t("admin.source") (Link to
        `/admin/sources/${encodeURIComponent(item.id)}` with item.label, and item.id in small text) · t("admin.fieldLevel")
        (t(`admin.coverageLevel_${item.level}`)) · t("admin.fieldState") · t("admin.fieldPlatform") · t("admin.fieldApproval")
        (Badge className={APPROVAL_TONE[item.approvalState]} t(`admin.sourcesApproval_${item.approvalState}`)) · t("admin.fieldHealth")
        (Badge className={HEALTH_TONE[item.health]} t(`admin.sourcesHealth_${item.health}`)) · t("admin.lastRun") (formatDate(lastRunOf(item)))
        · t("admin.fieldConsecutiveFailures") · t("admin.enabled") (t("admin.on") / t("admin.off")).
        No rows → a single cell with t("admin.sourcesEmpty").
     5. Footer: t("admin.paginationSummary") with {from}/{to}/{total} from `range`; <Button> t("admin.paginationPrevious") (disabled on page 1)
        and t("admin.paginationNext") (disabled on range.lastPage) → navigate({ ...query, page: query.page ∓ 1 }); a <select
        aria-label={t("admin.paginationPageSize")}> over SOURCE_LIST_PAGE_SIZES → navigate({ ...query, pageSize, page: 1 }). */
}
```

Keep every event handler exactly as written above; the JSX block is specified item by item, and every string in it goes through `t()` with `.replace` for placeholders.

`frontend/src/app/admin/sources/page.tsx`:

```tsx
"use client";

import { Suspense } from "react";
import { SourcesListView } from "@/components/admin/sources/SourcesListView";

// useSearchParams() in SourcesListView needs a Suspense boundary for the static prerender.
export default function AdminSourcesPage() {
  return (
    <Suspense fallback={null}>
      <SourcesListView />
    </Suspense>
  );
}
```

`frontend/src/components/admin/sources/SourcesListView.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sources list view", () => {
  it("keeps its state in the URL and only calls its own endpoints", () => {
    const view = readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");
    expect(view).toContain("useSearchParams()");
    expect(view).toContain("router.replace(");
    expect(view).toContain("{ scroll: false }");
    expect(view).toContain("listAdminDataSourcesPage(");
    expect(view).not.toContain("listAdminDataSources()");
    expect(view).not.toContain("listAdminCrawlerLogs");
  });

  it("gates bulk actions by role and respects the API limits", () => {
    const view = readFileSync(new URL("SourcesListView.tsx", import.meta.url), "utf8");
    expect(view).toContain("requestAdminSourcePrechecks({ sourceIds: chunk })");
    expect(view).toContain("PRECHECK_REQUEST_CHUNK");
    expect(view).toContain("APPROVAL_BATCH_CHUNK_SIZE");
    expect(view).toContain("RUN_NOW_LIMIT");
    expect(view).toContain('action: "approve"');
    expect(view).toContain('action: "hold"');
    expect(view).toContain("approvalReasonKey(reason)");
    expect(view).toContain("listAdminDataSourceIndex(query)");
  });
});
```

Append `["sources/page.tsx", "<SourcesListView />"]` to `PAGES` in `admin-pages.test.ts`, plus an assertion that `sources/page.tsx` contains `<Suspense`.

- [ ] **Step 5: Run the tests and gates**

Run: `cd frontend && npx vitest run src/components/admin src/app/admin`
Expected: PASS.
Run: `npm run lint`, the non-test type gate, `npm run build` (no "Missing Suspense boundary" error; `/admin/sources` prerenders).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/admin/sources frontend/src/app/admin/sources/page.tsx frontend/src/app/admin/admin-pages.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts
git commit -m "feat(admin): server-paginated source list with facets, URL state and bulk actions"
```

---

### Task 14: Overview page and cutover

**Files:**
- Create: `frontend/src/components/admin/overview/overview-view-model.ts`, `overview-view-model.test.ts`
- Create: `frontend/src/components/admin/overview/AdminOverviewView.tsx`, `AdminOverviewView.test.ts`
- Replace: `frontend/src/app/admin/page.tsx`
- Delete: `frontend/src/app/admin/page.test.ts`, `frontend/src/app/admin/page.test.tsx` (if Task 11 kept it)
- Modify: `frontend/src/app/admin/admin-pages.test.ts`, `frontend/src/lib/i18n/dictionaries/en.ts`, `zh.ts`
- Modify: `CLAUDE.md`, `docs/operations/local-source-approval.md`, and any other doc that points at `/admin#…` or "the data-sources section of `/admin`"

**Interfaces:**
- Consumes: Task 7's `getAdminOverview()` and `AdminOverview*` types; Task 1's `canViewAdminPath`; Task 2's kit.
- Produces: `AdminOverviewView`; pure `barPercent`, `sortStates`, `visibleStates`, `stateLevelColumns`, `toggleStateSort`.

- [ ] **Step 1: Add the overview i18n keys**

Append at the end of `admin` in both dictionaries:

| key | en | zh |
| --- | --- | --- |
| `overviewGeneratedAt` | Data generated at {time} | 数据生成于 {time} |
| `overviewSectionFailed` | This block could not be loaded. | 该板块加载失败。 |
| `overviewCoverageTitle` | Source coverage | 数据源覆盖 |
| `overviewTotalSources` | Sources | 数据源总数 |
| `overviewScheduled` | In crawl schedule | 在抓取计划内 |
| `overviewAwaitingApproval` | Awaiting approval | 待审批 |
| `overviewNeverRun` | Never run | 从未运行 |
| `overviewByLevel` | By level | 按级别 |
| `overviewByState` | By state | 按州 |
| `overviewColumnTotal` | Total | 总数 |
| `overviewColumnEnabled` | Enabled | 已启用 |
| `overviewColumnApproved` | Approved | 已批准 |
| `overviewColumnAwaiting` | Awaiting | 待审批 |
| `overviewColumnBlocked` | Blocked | 已拦截 |
| `overviewColumnNeverRun` | Never run | 从未运行 |
| `overviewShowAllStates` | Show all {count} states | 展开全部 {count} 个州 |
| `overviewShowTopStates` | Show top 10 | 只看前 10 个 |
| `overviewPipelineTitle` | Onboarding pipeline | 接入审批管道 |
| `overviewPipelineQueued` | Queued | 排队中 |
| `overviewPipelineOldestQueued` | Oldest queued | 最早入队 |
| `overviewPipelineNextReview` | Next review {date} | 下次审查 {date} |
| `overviewPipelineOpen` | Open onboarding | 进入接入审批 |
| `overviewPipelineEmpty` | No platform has local sources yet. | 还没有平台接入本地数据源。 |
| `overviewCrawlTitle` | Crawl health | 抓取健康 |
| `overviewRuns24h` | Last 24 hours | 近 24 小时 |
| `overviewRuns7d` | Last 7 days | 近 7 天 |
| `overviewRunsSuccess` | Succeeded | 成功 |
| `overviewRunsFailure` | Failed | 失败 |
| `overviewRunsOther` | Other | 其他 |
| `overviewLastRunAt` | Last run started | 最近一次运行开始 |
| `overviewFailingSources` | Failing sources | 失败中的数据源 |
| `overviewNoFailing` | No failing sources. | 没有失败中的数据源。 |
| `overviewThrottleEvents` | Throttle or challenge failures (24h) | 限流/挑战失败（24 小时） |
| `overviewPauseHint` | Platform pauses live only in the crawler worker's memory; see the worker log. | 平台暂停只存在于抓取 worker 的内存中，请查看 worker 日志。 |
| `overviewBidsTitle` | Bid data | 招标数据 |
| `overviewBidsNew24h` | New in 24 hours | 近 24 小时新增 |
| `overviewBidsNew7d` | New in 7 days | 近 7 天新增 |
| `overviewOpenByLevel` | Open bids by source level | 开放招标按来源级别 |
| `overviewPendingQa` | Needs QA review | 待质检 |
| `overviewOpenBidQa` | Open bid QA | 进入招标质检 |

- [ ] **Step 2: Write the failing tests**

`frontend/src/components/admin/overview/overview-view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { barPercent, sortStates, stateLevelColumns, toggleStateSort, visibleStates } from "./overview-view-model";

const STATES = [
  { stateCode: "CO", total: 40, byLevel: { county: 10, city: 30 } },
  { stateCode: "MI", total: 90, byLevel: { county: 20, township: 70 } },
  { stateCode: "CA", total: 1, byLevel: { state: 1 } },
];

describe("overview view model", () => {
  it("scales bars and guards zero", () => {
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(554, 554)).toBe(100);
    expect(barPercent(144, 554)).toBe(26);
  });

  it("sorts states by any column and limits to the top 10 unless expanded", () => {
    expect(sortStates(STATES, { key: "total", descending: true }).map((row) => row.stateCode)).toEqual(["MI", "CO", "CA"]);
    expect(sortStates(STATES, { key: "city", descending: true }).map((row) => row.stateCode)).toEqual(["CO", "CA", "MI"]);
    expect(sortStates(STATES, { key: "stateCode", descending: false }).map((row) => row.stateCode)).toEqual(["CA", "CO", "MI"]);
    const many = Array.from({ length: 12 }, (_, index) => ({ stateCode: `S${String(index).padStart(2, "0")}`, total: index, byLevel: {} }));
    expect(visibleStates(many, { key: "total", descending: true }, false)).toHaveLength(10);
    expect(visibleStates(many, { key: "total", descending: true }, true)).toHaveLength(12);
  });

  it("shows a level column only when some source has that level", () => {
    expect(
      stateLevelColumns([
        { level: "state", total: 55, enabled: 55, approved: 55, awaitingApproval: 0, blocked: 0, neverRun: 5 },
        { level: "county", total: 266, enabled: 266, approved: 7, awaitingApproval: 257, blocked: 2, neverRun: 258 },
      ]),
    ).toEqual(["state", "county"]);
  });

  it("toggles direction on the same column and defaults numbers to descending", () => {
    expect(toggleStateSort({ key: "total", descending: true }, "total")).toEqual({ key: "total", descending: false });
    expect(toggleStateSort({ key: "total", descending: true }, "county")).toEqual({ key: "county", descending: true });
    expect(toggleStateSort({ key: "total", descending: true }, "stateCode")).toEqual({ key: "stateCode", descending: false });
  });
});
```

`frontend/src/components/admin/overview/AdminOverviewView.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin overview view", () => {
  it("loads only the overview endpoint and renders the four blocks", () => {
    const view = readFileSync(new URL("AdminOverviewView.tsx", import.meta.url), "utf8");
    expect(view).toContain("getAdminOverview()");
    for (const call of ["listAdminDataSources", "listAdminCrawlerLogs", "listAdminDataSourcesPage"]) expect(view).not.toContain(call);
    for (const key of ["overviewCoverageTitle", "overviewPipelineTitle", "overviewCrawlTitle", "overviewBidsTitle", "overviewPauseHint", "overviewSectionFailed"]) {
      expect(view).toContain(`t("admin.${key}")`);
    }
    expect(view).toContain('canViewAdminPath(role, "/admin/quality/bids")');
    expect(view).toContain('href="/admin/sources/onboarding"');
  });
});
```

Replace the old page tests: `git rm frontend/src/app/admin/page.test.ts` (and `git rm frontend/src/app/admin/page.test.tsx` if Task 11 kept it) — the gate they checked now lives in `AdminShell` (Task 2's tests) — and add `["page.tsx", "<AdminOverviewView />"]` to `PAGES`.

Run the new tests — Expected: FAIL.

- [ ] **Step 3: Implement the view model**

`frontend/src/components/admin/overview/overview-view-model.ts`:

```ts
import { COVERAGE_LEVELS, type CoverageLevel } from "@/server/admin/data-source-list-contract";

export interface OverviewStateRow {
  stateCode: string;
  total: number;
  byLevel: Partial<Record<CoverageLevel, number>>;
}

export type StateSortKey = "stateCode" | "total" | CoverageLevel;

export interface StateSort {
  key: StateSortKey;
  descending: boolean;
}

export const TOP_STATES = 10;

/** Width of a CSS bar in percent (spec §4.3: no chart library). */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function sortStates(rows: readonly OverviewStateRow[], sort: StateSort): OverviewStateRow[] {
  const valueOf = (row: OverviewStateRow) =>
    sort.key === "stateCode" ? row.stateCode : sort.key === "total" ? row.total : (row.byLevel[sort.key] ?? 0);
  return [...rows].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    const compared = typeof left === "string" ? left.localeCompare(String(right)) : left - Number(right);
    return (sort.descending ? -compared : compared) || a.stateCode.localeCompare(b.stateCode);
  });
}

export function visibleStates(rows: readonly OverviewStateRow[], sort: StateSort, showAll: boolean): OverviewStateRow[] {
  const sorted = sortStates(rows, sort);
  return showAll ? sorted : sorted.slice(0, TOP_STATES);
}

export function stateLevelColumns(byLevel: ReadonlyArray<{ level: CoverageLevel; total: number }>): CoverageLevel[] {
  return COVERAGE_LEVELS.filter((level) => byLevel.some((entry) => entry.level === level && entry.total > 0));
}

export function toggleStateSort(current: StateSort, key: StateSortKey): StateSort {
  if (current.key === key) return { key, descending: !current.descending };
  return { key, descending: key !== "stateCode" };
}
```

Run the view-model test — Expected: PASS.

- [ ] **Step 4: Build the overview view**

`frontend/src/components/admin/overview/AdminOverviewView.tsx` (Client Component):

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity, AlertTriangle, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminOverview, type AdminOverview } from "@/lib/api/admin";
import { useLanguage } from "@/lib/i18n/LanguageContext";
import { canViewAdminPath } from "../admin-nav";
import { formatDate } from "../admin-format";
import { useAdminSession } from "../admin-session";
import { AdminNotice, AdminSectionStateCard, SummaryCard } from "../AdminStateCards";
import { useAdminResource } from "../use-admin-resource";
import { barPercent, stateLevelColumns, toggleStateSort, visibleStates, type StateSort } from "./overview-view-model";

const loadOverview = () => getAdminOverview();
const BUCKETS = ["approvable", "awaiting_precheck", "needs_fix", "missing_platform_review", "approved", "blocked"] as const;

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="h-2 w-full rounded bg-slate-100" aria-hidden="true">
      <div className="h-2 rounded bg-sky-500" style={{ width: `${barPercent(value, max)}%` }} />
    </div>
  );
}

export function AdminOverviewView() {
  const { t } = useLanguage();
  const { role } = useAdminSession();
  const overview = useAdminResource(loadOverview);
  const [stateSort, setStateSort] = useState<StateSort>({ key: "total", descending: true });
  const [showAllStates, setShowAllStates] = useState(false);

  if (!overview.data) {
    return (
      <AdminSectionStateCard
        action={overview.status === "error" ? () => void overview.reload() : undefined}
        actionLabel={t("admin.refresh")}
        code={overview.status === "error" ? "error" : "loading"}
        message={overview.status === "error" ? t("admin.errorDescription") : t("admin.loading")}
        title={t("admin.nav_overview")}
      />
    );
  }

  const data: AdminOverview = overview.data;
  const failed = (title: string) => (
    <AdminSectionStateCard
      action={() => void overview.reload()}
      actionLabel={t("admin.refresh")}
      code="error"
      message={t("admin.overviewSectionFailed")}
      title={title}
    />
  );

  /* JSX, top to bottom (each block is a <section className="rounded-lg border border-slate-200 bg-white shadow-sm"> with a header row):
     1. Header row: t("admin.overviewGeneratedAt").replace("{time}", formatDate(data.generatedAt)) and a Refresh <Button variant="outline">
        (RefreshCw icon, t("admin.refresh"), disabled while overview.status === "loading") → overview.reload(). No polling.
        When overview.status === "error": <AdminNotice tone="error" message={t("admin.sectionRefreshFailed")} />.
     2. Coverage — data.coverage === null → failed(t("admin.overviewCoverageTitle")); otherwise
        - four SummaryCards: t("admin.overviewTotalSources") (Database) = totals.sources, t("admin.overviewScheduled") (ShieldCheck) = totals.scheduled,
          t("admin.overviewAwaitingApproval") (AlertTriangle) = totals.awaitingApproval, t("admin.overviewNeverRun") (Activity) = totals.neverRun;
        - t("admin.overviewByLevel") table: level (t(`admin.coverageLevel_${level}`)) · total with <Bar value={total} max={largest level total}> ·
          enabled · approved · awaiting · blocked · never run (column headers overviewColumn*);
        - t("admin.overviewByState") table: clickable headers (state, total, one per stateLevelColumns(byLevel)) → setStateSort(toggleStateSort(stateSort, key));
          rows = visibleStates(byState, stateSort, showAllStates); a toggle button t("admin.overviewShowAllStates") with {count} = byState.length /
          t("admin.overviewShowTopStates"), shown only when byState.length > 10.
     3. Pipeline — data.pipeline === null → failed(t("admin.overviewPipelineTitle")); empty → t("admin.overviewPipelineEmpty"); otherwise a table,
        one row per platform: providerFamily · <Badge> t(`admin.platformReviewStatus_${row.platformReview.status}`) plus, when a review exists,
        t("admin.overviewPipelineNextReview").replace("{date}", formatDate(row.platformReview.review.nextReviewAt)) · one count column per BUCKETS
        entry (header t(`admin.ledgeredApprovalBucket_${bucket}`)) · t("admin.overviewPipelineQueued") = row.queued ·
        t("admin.overviewPipelineOldestQueued") = formatDate(row.oldestQueuedAt). Header link: <Link href="/admin/sources/onboarding">{t("admin.overviewPipelineOpen")}</Link>.
     4. Crawl health — data.crawlHealth === null → failed(t("admin.overviewCrawlTitle")); otherwise two small tables for
        t("admin.overviewRuns24h") and t("admin.overviewRuns7d") (rows overviewRunsSuccess / overviewRunsFailure / overviewRunsOther);
        t("admin.overviewLastRunAt") = formatDate(lastRunAt); t("admin.overviewFailingSources") = failingSources with worstFailing as a list of
        <Link href={`/admin/sources/${encodeURIComponent(item.id)}`}>{item.label}</Link> · consecutiveFailures · formatDate(lastFailureAt)
        (empty → t("admin.overviewNoFailing")); t("admin.overviewThrottleEvents") = throttleEvents24h; the note t("admin.overviewPauseHint").
     5. Bids — data.bids === null → failed(t("admin.overviewBidsTitle")); otherwise SummaryCards for t("admin.bidLifecycle_open") /
        t("admin.bidLifecycle_closed") / t("admin.bidLifecycle_awarded") / t("admin.overviewBidsNew24h") / t("admin.overviewBidsNew7d");
        t("admin.overviewOpenByLevel") as rows with <Bar> per level (t(`admin.coverageLevel_${level}`)); t("admin.overviewPendingQa") = pendingQa and,
        only when canViewAdminPath(role, "/admin/quality/bids"), <Link href="/admin/quality/bids">{t("admin.overviewOpenBidQa")}</Link>. */
}
```

Every string goes through `t()`; placeholders use `.replace`.

- [ ] **Step 5: Replace the old page**

Replace `frontend/src/app/admin/page.tsx` with:

```tsx
"use client";

import { AdminOverviewView } from "@/components/admin/overview/AdminOverviewView";

export default function AdminOverviewPage() {
  return <AdminOverviewView />;
}
```

Then confirm nothing still references the old page: `grep -rn "app/admin/page\|from \"./page\"" frontend/src --include=*.ts --include=*.tsx` shows only `admin-pages.test.ts`.

- [ ] **Step 6: Update the docs**

- `CLAUDE.md`, "Frontend structure": describe `/admin` as the admin console with a left navigation and the sub-pages of spec §3.1 (overview, sources list/detail/onboarding/runs, quality, bid QA, users, audit log, notifications, growth, config), the shell in `src/app/admin/layout.tsx` + `src/components/admin/AdminShell.tsx`, and the menu in `src/components/admin/admin-nav.ts`. In the "Batch onboarding (phase 3, spec §7)" paragraph, replace "the platform-review and ledgered-approval panels at the top of the data-sources section of `/admin`" with "the panels on `/admin/sources/onboarding`"; mention `GET /api/admin/overview`, the paginated `GET /api/admin/data-sources`, `GET /api/admin/data-sources/index` and `GET /api/admin/data-sources/[id]` where the admin API routes are listed.
- `docs/operations/local-source-approval.md` and every other doc found by `grep -rn "/admin#\|data-sources section of\|数据源板块" docs CLAUDE.md`: point readers at the new pages.

- [ ] **Step 7: Full gates**

Run from `frontend/`: `npm run lint`; the non-test type gate; `npm run test` (full suite); `npm run build`; `npm run i18n:check` — report the findings for `src/app/admin/**` (expected: none new; the scan only covers `src/app`).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/admin/overview frontend/src/app/admin/page.tsx frontend/src/app/admin/admin-pages.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts CLAUDE.md
git add <each doc file you changed under docs/>
git commit -m "feat(admin): overview page replaces the single-page console"
```

(The `git rm` in Step 2 already staged the deleted test files.)

---

### Controller: acceptance on local MySQL (spec §12)

Not an implementer task. After the final whole-branch review is clean:

1. Start the dev server against the local MySQL (`apsi-frontend` launch config). Ask the user to sign in with an admin account in the in-app browser (Claude never enters credentials).
2. `/admin`: compare the by-level table with a direct SQL count on `winbids` (`SELECT COALESCE(jurisdiction_level, issuer_type) AS level, COUNT(*) … GROUP BY 1`) — every number must match; confirm that never-run sources are no longer counted as healthy anywhere.
3. `/admin/sources`: page through all sources (1,020+ rows), apply each facet and check that a facet's count equals the filtered total when selected.
4. Network panel on every page: each page calls only its own endpoints; nothing loads the whole crawler-log table.
5. The sidebar shows the admin tree under `/admin/**`, the anchor links are gone, and the menu matches spec §3.1 for the admin role (operator/support are covered by `admin-nav.test.ts`).
6. Walk every page once; screenshot the overview and the source list for the user.

---

## Self-review notes (kept for the record)

- **Spec coverage.** §3.1/§3.2 → Tasks 1–2; §3.3 → Task 2; §4 → Tasks 7 and 14; §5 → Tasks 6, 12, 13; §6 → Tasks 8–9; §7 → Tasks 3, 4, 5, 10; §8 → file structure; §9 → Tasks 6–8, 12; §10 → the resource render rule, per-section overview errors, 400 handling in Tasks 12–13; §11 → every UI task's key table; §12 automated → each task's tests, acceptance → the controller step; §13 → Global Constraints; §14 → branch rule.
- **Type consistency.** `SourceListFilters` / `SourceListQuery` / `AdminDataSourceIndexItem` / `AdminDataSourceListItem` / `AdminDataSourceDetail` / `AdminOverview` are defined once (Tasks 6, 7, 8, 12) and imported by name later; `crawlerRunIdFor` (Task 9) is used by Tasks 10 and 13; `CrawlerLogList` (Task 9) by Task 10; `approvalState` is the list/index field name everywhere (decision 8).
- **Known limits accepted in the plan:** the pipeline and pendingQa reuse existing whole-table readers (light loader for sources; the QA repository for bids); timestamps are compared as ISO strings, which is exact across the `…Z` and `…+00:00` formats except within one second; throttle counts miss runs that left no log row.
