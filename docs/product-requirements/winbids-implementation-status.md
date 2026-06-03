# WinBids Implementation Status

Updated: 2026-06-03

This document is the working checklist for local development. Update it after each completed phase so the next task can start from this list instead of re-reading the whole codebase.

## How To Use This Checklist

每完成一个阶段后，都要更新下面三块：

1. **Open Requirements Backlog**：当前未完成需求的唯一主清单，按优先级和产品域维护。
2. **Current Product Status**：哪些能力已经可用，哪些只是部分可用。
3. **Account / Permission / Billing Tracker**：账户、admin、套餐、功能权限这条商业化主线的差距。
4. **Recommended Next Phase**：下一阶段优先做什么，避免每次重新阅读代码后再判断。

## Open Requirements Backlog

这部分是后续开发的主清单。每完成一个阶段，优先更新这里；历史阶段记录只保留背景，不再作为下一步判断依据。

### P0 / Foundation Standards Alignment

Drive Phase II added cross-cutting P0 requirements on 2026-05-29/2026-05-30. These now take priority before deeper business workflow modules.

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| P0 Standards Alignment Lite | Done locally as the first foundation slice: Phase II requirements are reflected in local roadmap docs; the P0 implementation plan exists at `docs/superpowers/plans/2026-06-01-p0-standards-alignment-lite.md`; config, event, UX-state, source-governance, and transferability foundations are implemented. | Deeper page-by-page UX state rollout, more product event coverage, config effective-date/rollback controls, production AWS execution, and source approval workflow depth remain. | Continue with source approval workflow depth, while carrying the P0 standards into every new module. |
| Transferability Pack | Done locally: `docs/transferability/` now contains setup, env vars, deployment, data/migrations, runbook, known limitations, AWS service map, and secrets/access docs with local/production boundaries and no real secrets. | Production-specific values, final AWS account IDs, live deployment ownership, and real backup/restore execution still require production environment decisions. | Keep updated after each deployment or production operations phase. |
| Config Registry Foundation | Done locally: `config_registry` table/migration, unique config-key guard, seed defaults, read/upsert helpers, admin GET/POST/PATCH APIs, validation tests, transactional audit event linkage, denied access audit events, and an editable Admin Config Registry / Config Matrix panel with JSON value editing, status editing, required change reason, API client helper, and audit-backed save flow. | Broader config domains, effective-date management UI, rollback/version comparison UI, and migration from hard-coded feature maps remain future depth. | Add effective-date + rollback controls when operators need safer production governance. |
| Audit/Event Foundation | Done locally: `event_log`, `event_outbox`, request/correlation id helper, metadata redaction, idempotency with uniqueness-conflict fallback, outbox destinations, tests, and admin config audit writes exist. | Wire more product events: source changes, plan limit reached, upload failed, AI unavailable/low confidence, duplicate/merge, deadline override, quote/award events. | Add event writes as each future module ships. |
| Universal UX States | Done locally: reusable `UniversalState` component and stable state code model cover Loading, Empty, Error, Permission Denied, AI Unavailable, Low Confidence, Upload Failed, Source Unavailable, Duplicate Opportunity, Expired Deadline, and Plan Limit; `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` now use it for primary auth/error/empty/loading/plan-limit states. | Continue rolling structured state codes into API responses and lower-level inline module errors as future modules are touched. | Apply to Artifact Vault upload failed, permission denied, plan limit, empty, and error states from day one. |
| Source Legal-Use / Ingestion Governance | Done locally: 50-state registry has governance defaults, `data_sources` supports approval overrides, Admin source projection exposes approval state, Admin UI shows approval badges/notes, Admin Data Sources API projects latest persisted live source health fields and recent per-source trend summaries, Admin source rows now support approve/hold governance actions plus per-source live-health recheck, source approval changes keep visible approval history, blocked/held/unapproved source governance now prevents crawler execution before locks/runners, Admin UI/API support batch approve/hold for selected sources, and risk-check includes local ingestion plus production approval readiness modes. | APSI Registration Vault implementation and production source governance runbook depth remain future work. | Continue with Settings reminder center or response package format depth. |
| MySQL Cutover | Advanced locally: `mysql2`, migration/smoke scripts, MySQL URL validation, compatibility DDL, runbook/docs, MySQL 8 container smoke verification, repeatable SQLite-to-MySQL data import, and MySQL runtime paths for auth/session/password reset, account profile/password/delete/export/preferences/usage, workspace read/update/invitations/member/ownership operations, admin auth gate, admin users/feature overrides/audit logs, admin config registry list/upsert/patch with audit events, event outbox delivery, admin data source list/update, admin bid QA list/review/display/correction/batch writes, billing subscription/checkout/portal/cancel/webhook/invoices/dunning, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler health/admin crawler logs, crawler locks/source enablement, direct JSON crawler import/upsert, crawler search-alert matching/digest notification, MySQL-ready Stripe sandbox verifier, aggregate worker preflight, and production billing credential preflight. | Remaining runtime signoff: run the operator-assisted Stripe sandbox flow with real test credentials against MySQL, plus final low-risk live checkout/webhook execution. | Run Stripe sandbox verifier against a MySQL dev/staging DB, then execute live billing webhook/checkout smoke from the runbook. |

### P0 / Completed Recently

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| P1 Anonymous Boundary Cleanup | Done locally: public `/search`, bid detail, match, and safe attachment routes remain anonymously browsable; saved bids, intents, profile/settings, search alerts, and paid workspace APIs now require registered users; Search Alerts anonymous GET/POST/PATCH/DELETE return the shared `AUTH_REQUIRED` response and no longer issue anonymous cookies; browser smoke confirms `/saved`, `/intents`, `/profile`, and `/settings` show sign-in/create-account states. | Continue full-chain authenticated browser regression for ordinary/paid users as future UI smoke depth. | Start P2 50-State Source Validity Hardening next: strengthen source/content/detail/download checks and live source-health reporting. |
| P1 Tier / Paid Feature Locking | Done locally: Free / Pursuit Starter / Response Builder / Enterprise entitlement matrix now covers legacy feature keys and PRD feature slugs; paid intent APIs are protected by authenticated + feature-gated route coverage; Knowledge Station requires registered workspace access before Enterprise gating; Settings feature access now shows upgrade/locked guidance for Pursue / No-Bid, Grounded Q&A, Response Workspace, Artifact Vault, Quote Workflow, Deadline Notifications, and Knowledge Station; Intent paid modules have static locked-state coverage. | Behavior-level browser smoke and future usage/credit consumption depth remain. | Start P1 Anonymous Boundary Cleanup next: keep public anonymous browsing, but require registered users for saved bids, intents, profile/settings, alerts, and paid workspace APIs. |
| P0-P3 Parallel Batch 1 | Done locally: Intent detail workflow sections were split into dedicated panel components for Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications; Admin has an editable Config Registry / Config Matrix section; Admin Data Sources API exposes latest persisted live source health details; P3 entitlement/Knowledge/Credit tests now cover Enterprise-only Knowledge defaults, org overrides, expired overrides, Growth as planned/disabled, and credit metadata. | Intent panel business logic is still mostly owned by the page; source-health approval actions are not complete; P3 remains a preparation layer without real credit consumption or production AI. | Next deepen Admin source approval workflow now that source health and config governance are visible. |
| Product 2 Compliance Evidence Mapping v1 | Done locally: Compliance Manifest items now include derived `evidenceRefs` linked to supplier profile, match snapshot, deadline citation, bid detail/source URLs, generated checklist/risk output, and attachment download routes; Intent detail renders linked evidence chips under each compliance item while preserving status/evidenceStatus/notes editing. | User-editable evidence mappings, evidence history, and document-level extraction remain future depth. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Product 2 Richer Evidence / Artifact Links v1 | Done locally: pursue/no-bid reason details now include additive `evidenceRefs` linked to match snapshots, supplier profile, bid detail/source URLs, generated output, citation ids, and attachment download routes; Intent detail renders linked evidence chips while preserving the legacy evidence label fallback. | Deeper document parsing remains future AI work. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Risk Checklist Automation | Done locally: `npm run risk:check` verifies 50-state active data coverage, required non-empty bid content, bid detail route ID round-trips, safe attachment download routes, admin/user/paid entitlement separation, and production dependency audit at moderate-or-higher severity. | Keep this command in the phase handoff checklist and expand it as new high-risk workflows ship. | Run after each crawler/auth/billing/frontend phase before reporting completion. |
| Admin risk-check visualization | Done locally: `/api/admin/risk-check` exposes the existing risk checklist report to admin/operator/support roles, persists recent snapshots, returns a trend summary, and `/admin` shows pass/fail status for global URL health, 50-state coverage, non-empty state content, bid detail routes, attachment downloads, account-tier separation, recent history, and trend deltas. | Optional future alerting, per-check remediation actions, and longer-horizon charts. | Continue with persisted live source-health snapshots or Artifact Vault Lite. |
| Response Workspace Lite | Done locally: `response_workspace_items` model/migration, Business-gated APIs, client helpers, Intent detail panel, grouped tasks/checkpoints/artifacts/outline sections, editable status/notes, owner assignment, item comments, linked artifacts, activity history, response package readiness summary, package snapshots, local Markdown export/download, and English/Chinese copy are implemented. | PDF/DOCX/ZIP package formats, production object storage, richer team member directory, and LLM drafting remain future depth. | Continue with Admin source approval workflow or response package format depth. |
| Artifact Vault Lite | Done locally: `supplier_artifacts` model/migration, local file storage, Business-gated list/upload/download APIs, client helpers, Intent detail upload/list panel, file type/purpose/expiry/review metadata, empty/upload-failed UniversalState handling, and English/Chinese copy are implemented. | Audit events, version history, delete/replace, compliance auto-linking, production object storage, malware scanning, and richer retention policy remain future depth. | Continue with Quote / Supply Chain Lite, then deadline notifications. |
| Quote / Supply Chain Lite | Done locally: `sourcing_partners`, `quote_requests`, and `quote_request_artifacts` schema/migration, Business-gated GET/POST/PATCH APIs, client helpers, Intent detail Quote Workspace, partner creation, quote status/amount/notes editing, artifact linking, empty/error/locked states, and English/Chinese copy are implemented. | Email sending, supplier portal, quote response uploads, comparison scoring, partner profile depth, audit events, and richer artifact/compliance linkage remain future depth. | Continue with Response Workspace depth. |
| Deadline Notifications Lite | Done locally: `deadline_reminders` schema/migration, Business-gated GET/PATCH APIs, idempotent generator for bid deadlines, response task due dates, quote request due dates, and artifact expiries, acknowledge/snooze actions, Intent detail reminder panel, locked/error/empty states, and English/Chinese copy are implemented. | Notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, Settings reminder center, and MySQL runtime adapter remain future depth. | Continue with Response Workspace depth, then Award / Tabulation Tracking Lite. |
| Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 | Done locally: `PursuitRecommendation` includes additive structured reason details with category, severity, summary, explanation, evidence label, suggested action, and evidence references; deterministic recommendation maps match score, geography, pricing, deadline, documentation, addenda, registration, risk flags, and profile gaps; Intent detail renders structured reason cards in English/Chinese while preserving saved decision history. | Deeper LLM-backed interpretation remains future AI work. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Product 2 Amendment/Addenda Awareness v1 | Done locally: amendment/addenda signal detection covers title, descriptions, archived detail text, and attachments; intent freshness API reports current/stale/not-refreshed state; refresh API regenerates match snapshot, deterministic brief/checklist/risk flags, and evidence citations while preserving user-edited submission/compliance/decision records; Intent detail shows freshness state and refresh control. | Richer legal interpretation and LLM document extraction remain out of scope. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Search Alerts Notification History + Digest Verification | Done locally: digest runs are persisted for sent/failed/skipped alert notifications, list responses hydrate recent history, and Settings shows latest delivery status plus recent history. | Real production email provider, bounce/complaint webhooks, and operator digest monitoring remain future production hardening. | Revisit production email provider when credentials are available. |
| Admin QA Batch Filters + Correction History | Done locally: Admin QA now supports display status / score range / reviewer / reviewed date / source confidence filters, selected-row batch reviewed / needs review / publish / suppress actions, correction history API/UI, and original-vs-corrected history display. | Broader editable-field UI and raw/staged/normalized side-by-side detail view remain future Bid Admin depth, not this thin slice. | Keep QA operational; next data-admin slice should be raw/staged/normalized comparison after Product 2 citations. |

### P1 / MVP Readiness

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| 50-state crawler hardening | 50 州 registry 已覆盖；CA/TX/NY/FL/IL 为 verified dedicated，其他州为 beta dedicated；非空校验、fixture/live validation、空结果失败保护和 fallback 元数据已强化。 | 将 beta 州逐步提升为 verified；增加生产调度/监控；持续替换仍依赖 fallback 的州源。 | 每批 10-15 州做 live fixture 校验、source quality 报告和 adapter maturity 更新。 |
| Product 2 Qualification Upgrade | Match score、AI-like brief、Submission Guidance、Compliance Manifest Lite、Pursue/No-Bid Lite 已有 deterministic 版本；Qualification Evidence Citations v1、Document-Grounded Q&A v1、Amendment/Addenda Awareness v1、No-Bid Taxonomy + Qualification Risk Explanations v1、Richer Evidence / Artifact Links v1、Compliance Evidence Mapping v1 已完成，Intent 级 citation snapshot、只读 citations API/client、freshness/refresh API/client、Pro-gated Q&A API/client、结构化 pursuit reason details、reason/compliance evidence refs、Intent detail 证据面板/证据 chip/新鲜度状态/刷新按钮/决策原因分类、合规证据映射和基于证据问答已接入。 | Deeper AI extraction/document parsing remains future depth. | 下一步做 Response Workspace depth 或 Submission Guidance Completion。 |
| Search Alerts Full UI | Settings 已新增 Search Alerts 管理界面，支持 per-alert 创建/编辑/暂停恢复/删除，并复用现有 quota gate、通知偏好和最近 digest 投递历史。 | 真实邮件 provider、bounce/complaint 回流、运营级 digest monitoring dashboard 仍需补齐。 | 接入真实邮件 provider 后补 bounce/complaint webhook 和运营监控。 |
| Production Billing / Worker Deployment Runbook | Stripe sandbox E2E verifier、checkout/webhook/portal/cancel foundation 已完成；production billing/worker runbook 已新增；notification worker 支持部署前检查。 | 真实生产凭证填充、生产 webhook 端点创建/轮换演练、进程管理器/cron 部署执行。 | 上线前按 runbook 做一次 staging/prod dry run。 |
| Notification production hardening | outbox、file/console/http provider、retry worker、Admin 手动 delivery、provider env validation、生产投递 runbook、Search Alert digest delivery history 已有。 | 生产邮件 provider 真实账号、退信/投诉回流、模板版本治理、投递监控 dashboard。 | 接入选定邮件 provider 后补 bounce/complaint webhook。 |
| UI/UE production polish | 有 `/winbids-demo` 与 `/generative-art-static` 静态 demo，主应用已有部分视觉调整和中英文切换。 | 将 demo 风格系统性迁移到真实业务页面；统一表格/筛选/空状态/加载态/移动端布局；避免只停留在静态 demo。 | 先选 `/search`、`/bids/[id]`、`/admin` 三页做一轮可用性与视觉收敛。 |

### P2 / Product Workflow Depth

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| Knowledge Station Lite | Done locally: Enterprise-gated Intent workflow coach, reusable organization-scoped knowledge items, protected list/create APIs, Intent panel, and minimal `/knowledge` library are implemented. | Full retrieval, embeddings, admin publishing workflow, artifact uploads, usage metrics, and credit metering remain future depth. | Continue with Response Workspace Lite or Artifact Vault Lite. |
| Response Workspace Lite | Done locally: Business-gated task/checkpoint/artifact/outline workspace exists on Intent detail with durable DB rows, API/client, editable status, editable notes, owner assignment, item comments, linked artifacts, activity history, package readiness summary, package snapshots, local Markdown export/download, and bilingual UI; task due dates now feed Deadline Notifications Lite. | PDF/DOCX/ZIP package formats, production object storage, richer team member directory, and LLM drafting remain future depth. | Next continue with Editable Config Matrix governance. |
| Artifact Vault Lite | Done locally: Business-gated supplier artifact upload/list/download exists on Intent detail with durable `supplier_artifacts` rows, local file storage, intent/bid association, type/purpose/expiry/review metadata, and bilingual UI. | Audit events, version history, delete/replace, compliance auto-linking, production object storage, malware scanning, and retention policy remain future depth. | Later connect uploaded artifacts back into Compliance Manifest evidence history. |
| Quote / Supply Chain Lite | Done locally: Business-gated supplier/partner records, quote request drafts, status flow, quote amount/response notes, linked supplier artifacts, API/client helpers, bilingual Intent UI, and quote due-date reminders through Deadline Notifications Lite exist. | Email sending, supplier portal, quote response uploads, comparison scoring, partner profile depth, audit events, and richer compliance linkage remain future depth. | Deepen after Response Workspace assignment/comments/version history. |
| Deadline Notifications Lite | Done locally: Business-gated deadline registry and Intent reminder panel derive reminders from bid deadlines, response task due dates, quote due dates, and artifact expiries; users can acknowledge and 24-hour snooze reminders. | Notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, Settings reminder center, and MySQL runtime adapter remain future depth. | Next deepen Response Workspace so assignments/comments/versioning can feed richer deadline activity. |
| Submission Guidance Completion | Guidance 生成、编辑、确认已存在。 | 更完整的 submission path 状态机、确认凭证、错误恢复、历史版本。 | 补 submission version/history 和 readiness completion。 |
| Award / Tabulation Tracking | 未实现。 | Award notices、bid status monitoring、tabulation records、竞争分析输入。 | 先做 award notice 数据表 + 手动录入 UI。 |
| Win/Loss Learning | 未实现。 | Outcome capture、reason taxonomy、future recommendation feedback loop。 | 在 Intent close-out 增加 win/loss outcome form。 |

### P3 / Later / Enterprise / AI Depth

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| Real credit consumption and paid credit packs | credit tables、plan copy、usage summary 已有。 | AI action 真实扣费、refund flow、credit purchase packs、admin adjustment、ledger reconciliation。 | 等 premium AI actions 接入后再做真实扣费。 |
| Advanced usage metrics | saved bids / intents / alerts / team usage 已计数。 | quote workflow、Knowledge Station、AI call、artifact storage 等指标。 | 随对应模块落地逐项补。 |
| Organization lifecycle polish | workspace/team 管理可用。 | invite acceptance analytics、更完整 team audit、company owner/member 与 global role 的统一策略。 | 做 team audit history 列表。 |
| Custom enterprise permission rules | 中心 entitlement map + org feature overrides 已有。 | enterprise policy model、custom packages、contract-specific limits。 | 等真实 enterprise case 再建规则模型。 |
| Production AI layer | 当前为 deterministic/AI-like foundation。 | LLM extraction、citations、confidence、prompt rules、uncertainty handling、cost controls。 | 从 Product 2 citations/Q&A 的受限场景开始。 |
| Product 6 data capture | 未实现完整 intelligence。 | 数据采集、award/tabulation、price-to-win、长期学习。 | 先只做数据 capture，不做完整智能判断。 |

## Current Product Status

### Implemented

| Area | Current implementation |
|---|---|
| Risk handoff checks | `npm run risk:check` covers 50-state data, non-empty crawler content, bid detail ID routing, attachment download safety, account/tier entitlement separation, and production dependency audit. |
| Product shell | Real app shell, sidebar, bilingual UI, WinBids demo visual style applied to main pages. |
| Bid discovery | `/search`, filters, sort, bid cards, bid detail page, source links, attachments. |
| Saved bids | Anonymous saved bids and authenticated workspace-shared saved bids, merge anonymous saved bids on register/login. |
| Supplier profile | `/profile`, profile API, completion score, deterministic matching inputs. |
| Auth basics | Register, login, logout, session cookie, session lookup, login/register pages, session payload with role/tier/features. |
| Account self-service | `/settings` shows authenticated email/display name, updates display name, changes password after validating current password, exports account data with versioned metadata, and soft-deletes accounts with admin-visible deletion audit; `/forgot-password` and `/reset-password` support local token-based password recovery; `/accept-invite` supports workspace invitation acceptance; Settings Team tab manages workspace name, member invites, invitation delivery status, invitation resend/revoke, owner transfer, member role changes, member disable/restore, and member removal; Settings Notifications tab persists saved-search and marketing preferences. |
| User data model basics | `users` table, `sessions` table, `organizations`, `organization_memberships`, `role`, `account_tier`, `is_disabled`, and workspace owner/member state. |
| Admin auth helper | `requireAdmin()` checks authenticated non-disabled full-admin sessions; `requireAdminAccess()` supports admin/operator/support console access with route-level role restrictions; local bypass for development. |
| Admin user access console | `/admin` lists registered users, creates invited accounts with temporary passwords, filters/searches accounts, changes role/tier/enabled state, shows access audit logs including self-service account deletion, and keeps account management limited to full admins. |
| Admin crawler console | `/admin`, data source health, enable/disable sources, run all state crawlers, run single source, crawler logs; support can view operational state, operator/admin can run operational actions; state crawler registry now covers all 50 states. |
| Admin bid QA console | `/admin` includes a Bid Data QA queue with quality score, review status, display status, source/state, quality flags, archive issue counts, correction counts, expanded filters, selected-row batch review/publish/suppress actions, correction history, original-vs-corrected display, operator/admin inline title/deadline correction, and publish/suppress controls; support can view the queue read-only. |
| Feature entitlement map | Central role/tier feature map for current compatibility tiers `free`, `pro`, `business`, `enterprise`; product-facing plan copy maps to Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise. |
| Feature access guards | Reusable server `requireFeature`, client `useFeature`, tier-aware locked states for gated features, and manifest-backed static coverage tests for current/future advanced feature API routes. |
| Usage limits | Central saved bid, intent workspace, search alert, and team member quota checks/counts by organization tier; authenticated users are counted at workspace scope; saved bids, intents, search alerts, and team member invite/accept flows return `USAGE_LIMIT_REACHED` before creating over-limit resources; Settings shows current workspace usage vs plan limits. |
| Notification delivery foundation | `notification_outbox`, file/console/http providers, retryable delivery worker, deployable notification/dunning worker command, user notification preferences, billing dunning reminders, invitation delivery status, search alert digest delivery history, admin notification history UI, and admin delivery trigger API/UI. |
| Subscription foundation | `account_subscriptions`, `subscription_events`, plan catalog, account subscription API, Settings Billing tab. |
| Billing provider sync foundation | `billing_checkout_sessions`, checkout creation API, Stripe SDK/API adapter, Stripe webhook signature verification/mapping, provider event idempotency, subscription status reconciliation, lifecycle reconciliation, Settings self-service upgrade/cancel controls, and repeatable Stripe sandbox E2E verifier/runbook. |
| Invoice / payment history foundation | `billing_invoices`, provider invoice event sync, payment-failed status handling, payment retry links, payment-failed notification outbox entries, account invoice API with status filtering and summary totals, Settings invoice history UI with filters/PDF links/retry links, and optional HMAC webhook signature verification via `BILLING_WEBHOOK_SECRET`. |
| Customer portal foundation | Hosted checkout and customer portal URL templates, provider/customer placeholders, account portal API, and Settings Manage Billing entry. |
| Commercial packaging / credits foundation | Product-facing plan labels now map Free -> `free`, Pursuit Starter -> `pro`, Response Builder -> `business`, Enterprise -> `enterprise`; Growth is present as a planned/disabled catalog plan; PRD feature slugs and credit action metadata exist; `credit_balances` and `credit_usage_events` tables are migrated; Settings Billing/Usage show credits and updated plan copy. |
| Source ingestion foundation | SQLite schema, seed data, crawler logs, SAM.gov/state runner APIs, 50-state state runner registry, CA/TX/NY/FL/IL verified dedicated adapters, the other 45 state sources covered by beta dedicated adapters, non-empty live validation guardrails, local attachment file serving for crawler-managed files, and public attachment/detail archival with status, size, content type, checksum, fetched timestamp, and failure notes. |
| Match scoring | Deterministic bid match score, confidence, component scores, explanation, risk notes. |
| Intent to Bid | Add intent from bid detail, idempotent workspace-scoped intent creation, shared intent list/detail for organization members, status update. |
| AI-like bid brief | Deterministic brief, key dates, initial checklist, risk flags, persisted evidence citations, amendment/addenda freshness state, refreshable qualification snapshot, and Pro-gated document-grounded Q&A shown in Intent detail. |
| Submission Guidance | `submission_paths`, `submission_confirmations`, generator, service, current Pursuit Starter-gated API routes, API client, Intent workspace UI for generated guidance, editable submission fields, readiness/risk lists, and manual submission confirmation. |
| Compliance Manifest Lite | `compliance_manifest_items`, generator, service, current Response Builder-gated API route, API client, and Intent workspace UI for requirement status, evidence status, and notes. |
| Pursue / No-Bid Decision Lite | `pursuit_decisions`, recommendation generator with structured reason taxonomy/risk explanations, current Pursuit Starter-gated API route, API client, and Intent workspace UI for decision capture, structured recommendation reasons, notes, and history. |
| Response Workspace Lite | `response_workspace_items`, `response_workspace_comments`, deterministic workspace generator, current Response Builder-gated API routes, API client, and Intent workspace UI for response tasks, internal checkpoints, artifact placeholders, package outline sections, status, notes, owner assignment, and comments. The Intent detail page now renders Response Workspace through a dedicated component boundary so artifact-task linking and version/activity history can be implemented with fewer page-level conflicts. |
| Deadline Notifications Lite | `deadline_reminders`, deterministic reminder generator, current Response Builder-gated API route, API client, and Intent reminder UI for bid deadlines, response task due dates, quote due dates, artifact expiries, acknowledge, and snooze. |
| Admin Config Matrix | Editable Admin Config Registry / Config Matrix panel lists config entries from `/api/admin/config`, supports JSON value/status edits, requires change reasons, saves through PATCH `/api/admin/config/[id]`, refreshes local state, and reuses audit-linked backend config writes. |
| Admin Source Health / Approval Workflow | Admin Data Sources API returns latest persisted live source health details; `/admin` shows checked time/status/status code/error/latency and supports per-source Recheck, Approve, and Hold actions. |
| Static product demo | `/winbids-demo` isolated prototype page from Drive frontend references. |

## Latest Requirements Alignment

The refreshed Drive material now has two layers:

1. Commercial packaging and credits from the previous refresh.
2. Phase II foundation standards from 2026-05-29/2026-05-30, which introduce cross-cutting production, configuration, audit, transferability, UX-state, and source-governance requirements.

| Requirement Track | Current Local State | Alignment Needed |
|---|---|---|
| Phase II P0 Foundation Refined | Local app has strong dev foundations, risk checks, runbooks, and feature gates. | Add AWS-first service map, environment separation docs, source/security controls, QA/release gates, observability expectations, and transferability ownership docs. |
| Configurable Before Custom | Feature map, organization feature overrides, general configuration registry, seed defaults, admin config APIs, Admin editable config matrix, change reasons, effective dates, and audit linkage exist. | Add broader config domains, effective-date/rollback UI, and documented production governance operations. |
| Audit Event Logging Matrix | Several module-specific logs/tables exist. | Add unified event schema, shared writer, request/correlation ids, event outbox, activity/integration/usage/AI-output event coverage, and safe metadata rules. |
| Transferability Requirements | Setup and operations docs exist in pieces. | Build a complete Transferability Pack so a future developer/operator can set up, configure, deploy, troubleshoot, and continue development without hidden context. |
| Universal UX States | Some screens have loading/error/empty/locked states. | Add reusable state components, structured API state codes, coverage matrix, QA cases, and frontend/backend handling for all required universal states. |
| Source ingestion governance | 50-state source registry, health, non-empty checks, and attachment/detail archival exist. | Add legal-use approval metadata, APSI Registration Vault design, explicit blocked/needs-review source statuses, and risk checks for approval-required sources. |
| Plan names | Code and database use `free`, `pro`, `business`, `enterprise`. | Done locally: product copy exposes Free, Pursuit Starter, Response Builder, Growth, and Enterprise while preserving compatibility values. |
| Plan mapping | Pursuit Starter maps to `pro`; Response Builder maps to `business`; Enterprise maps to `enterprise`; Growth exists as planned/disabled. | Future: activate Growth only after exact entitlement boundaries and billing model are confirmed. |
| Credits | Credit vocabulary, included monthly credit metadata, premium action costs, refund semantics, Settings display, and ledger tables exist. | Future: connect real consumption/refund flows and paid credit packs when premium AI actions are implemented. |
| P1 data architecture | 50-state crawler coverage, admin runner, archive metadata, local public attachment/detail downloader, QA review queue, correction audit table, publish/suppress controls, batch QA actions, richer QA filtering, and correction history exist. | Separate Source Registry, Connector Engine, Normalization/Data Quality, and Bid Admin/Data QA responsibilities in docs and future implementation; next data-admin polish is raw/staged/normalized comparison. |
| Knowledge Station | Done locally: Enterprise-gated Intent workflow coach, reusable organization-scoped knowledge items, protected list/create APIs, Intent panel, and minimal `/knowledge` library are implemented. | Future depth: retrieval, embeddings, admin publishing workflow, artifact uploads, usage metrics, and credit metering. |

## Account / Permission / Billing Tracker

这部分专门跟踪普通账户、管理员账户、用户等级、付费功能关联。后续每次做完权限或商业化相关功能，都优先更新这里。

### Already Implemented

| Capability | Status | Notes |
|---|---|---|
| 普通账户注册 | Done | `/register` and `/api/auth/register` create local user accounts, default `role=user`, default `account_tier=free`, and create sessions. |
| 普通账户登录/退出/session | Done | `/login`, logout API, session cookie, `/api/auth/session`, disabled account rejection. |
| 普通账户基础管理 | Done | `/settings` supports display name update, password change, password reset request/confirm, versioned account data export, and soft account deletion/deactivation with admin-visible audit. |
| 普通账户团队空间 | Partial | Default organization/workspace exists with organization-level tier ownership; Team tab can rename workspace, invite local members, enqueue local invitation email notifications, show invitation delivery status, resend/revoke pending invitations, accept invitations, transfer owner, update member role, disable/restore members, and remove members. |
| Admin 账户基础分离 | Done | `role=admin` is distinct from `role=user`; operator/support are separate low-privilege back-office roles; `requireAdmin()` protects full-admin APIs; `/admin` is hidden/blocked for ordinary users. |
| Admin 用户管理 | Done | Full admin can list/search/filter users, create invited accounts with temporary passwords, update role/tier/enabled state, manage organization feature overrides, and filter access/deletion/override audit logs by actor/action/target/feature. |
| 细粒度后台角色 | Done | `operator` can access operational admin tools and run crawler/notification/dunning actions without user-management permission; `support` can access read-only operational admin views without mutation/run controls. |
| 用户等级模型 | Done | `account_tier` supports `free`, `pro`, `business`, `enterprise`; product-facing names are Free, Pursuit Starter, Response Builder, Growth, and Enterprise. |
| 功能与等级关联 | Done / Ongoing expansion | Central entitlement map controls legacy feature keys and PRD feature slugs; Free / Pursuit Starter / Response Builder / Enterprise matrix now has explicit regression coverage; paywalls use updated plan names and credit language. |
| 组织级功能覆盖 | Done | Full admin can force-enable, force-disable, or clear selected organization feature overrides beyond tier defaults; overrides support reason and expiry metadata; expired overrides are ignored by session entitlements and server feature gates. |
| 服务端功能拦截 | Done | `requireFeature()` exists and is already used by paid workspace APIs; manifest-backed coverage tests protect every registered gated API, require authenticated principal checks on intent paid routes, and explicitly track not-yet-implemented paid feature APIs; Knowledge Station now returns the shared `AUTH_REQUIRED` response for anonymous access before Enterprise gating. |
| 前端锁定态 | Done / Ongoing expansion | `useFeature()` and locked messages exist on key workspace modules and Settings feature overview; Settings now includes Pursue / No-Bid, Grounded Q&A, Response Workspace, Artifact Vault, Quote Workflow, Deadline Notifications, and Knowledge Station access states. Future work should add behavior-level browser regression around actual Free/paid sessions. |
| 使用额度限制 | Partial | Saved bids, intent workspace, search alerts, and team member usage are counted by organization tier/workspace; saved bids, intents, search alert creation, team invites, and invitation acceptance enforce quota; `/api/account/usage` and Settings Usage Dashboard show current usage, remaining quota, limited-resource summary, credit summary, and upgrade prompt. |
| 通知偏好与投递状态 | Partial | Users can persist saved-search alert and marketing preferences; disabled saved-search alerts are recorded as skipped by the notification service; search alert cards show recent digest delivery history; invited members show latest delivery status; Admin can view notification outbox rows and manually trigger delivery. |
| 订阅数据基础 | Partial | `account_subscriptions`, `subscription_events`, plan catalog, and Settings Billing tab exist. |
| 自助升级/取消基础 | Partial | Settings Billing can start Pro/Business checkout sessions through local fallback or Stripe Checkout, receive provider-compatible/Stripe webhook updates, sync account tier/status, dedupe provider events, schedule provider-side cancellation at period end, reconcile expired/canceled/past-due access, and run an operator-assisted Stripe test-mode E2E verifier. |
| 发票/支付历史基础 | Done | Provider invoice paid/payment-failed events write `billing_invoices`; payment failures enqueue deduped billing notifications; staged dunning reminders can be queued at T+2/T+5 only while invoices remain failed; users can filter invoice history in Settings, see summary totals, open invoice/PDF links, and retry failed invoices from hosted invoice links; signed webhook verification is supported when `BILLING_WEBHOOK_SECRET` is configured. |
| 支付服务商配置/门户基础 | Partial | Hosted checkout/customer portal templates can redirect to provider URLs; users can open Manage Billing from Settings; Stripe sandbox checkout/webhook/portal/cancel verification is documented and scriptable with real test credentials. |

### Still Needed

| Priority | Capability | Needed Work | Why It Matters |
|---:|---|---|---|
| P0 | Production Billing / Worker Deployment Runbook | Add production credential separation, deployment environment notes, webhook endpoint rotation process, and scheduled worker deployment instructions. | Sandbox verification is now scriptable; production readiness still needs deployment operations and credential hygiene. |
| P1 | Trial / Dunning Lifecycle | Add production scheduling for dunning worker and provider-specific dunning event handling. | Prevents stale paid access when payment state changes. |
| P1 | Advanced Usage Metrics | Add future quote workflow, Knowledge Station, and AI-call usage metrics after those resources exist. | Users need to understand why an upgrade is required for advanced paid features. |
| P2 | Custom Enterprise Permission Rules | Add a concrete rule model only after enterprise/customer-specific cases are known. | Avoids over-building a permissions engine before real enterprise policy needs are clear. |

### Current Tier-To-Feature Direction

| Internal Tier | Product-Facing Plan | User Type | Current / Planned Feature Access |
|---|---|---|---|
| `free` | Free | Ordinary trial/basic supplier | Search, saved bids with low quota, supplier profile, basic match score, limited intent workspace. |
| `pro` | Pursuit Starter | Individual paid supplier | Higher quotas, Submission Guidance, Pursue / No-Bid, full match explanation. |
| `business` | Response Builder | Small team supplier | Pursuit Starter features plus Compliance Manifest, team-ready workspace, future quote workflow. |
| planned | Growth | Growing supplier/team | Planned future tier; exact entitlements should remain disabled until confirmed. |
| `enterprise` | Enterprise | Advanced/team account | Response Builder features plus Knowledge Station, advanced intelligence, higher limits, support/admin assistance. |
| Role: `admin` | Admin | Full platform operator | Admin console, crawler/source tools, user management, tier assignment, feature overrides, audit visibility, subscription reconciliation. |
| Role: `operator` | Operator | Operations staff | Admin console operational tools, crawler/source controls, notification delivery, dunning reminders; no user role/tier management. |
| Role: `support` | Support | Support staff | Read-only admin console operational views for sources, logs, and notification outbox; no run/mutation controls. |

### Partially Implemented

| Area | What exists | Missing to be useful |
|---|---|---|
| Account management | Register/login/logout/session APIs and pages; account settings can update display name and password; password reset token flow; users can export account data with versioned metadata and soft-delete/deactivate their account with admin-visible deletion audit; admin can create invited accounts, enable/disable users, search/filter users, and review access/deletion audit logs | Future compliance polish such as export file signing or retention-policy configuration |
| Organization/workspace model | Registered users get a default organization, session payload includes current workspace and owner/member role, Settings Team tab can rename workspace, invite local members, queue invitation email notifications, show latest invite delivery status, resend/revoke pending invitations, accept invitations, transfer owner, change member roles, disable/restore members, remove members, and saved bids/intents are shared across organization members | Invite acceptance analytics and richer team audit history |
| Admin vs user separation | Admin APIs enforce full-admin role for account management and feature overrides; disabled admins are rejected; admin/operator/support can access `/admin`; operator/support receive lower-permission controls; sidebar hides Admin for ordinary users; `/admin` shows login-required or forbidden states before loading admin APIs | Optional per-route permission audit UI and custom enterprise back-office roles |
| User role model | `user`/`admin`/`operator`/`support` role enum, role update API, audit trail, role-aware frontend session payload | Optional company-level owner/member unification with global role model |
| Subscription / tier model | `account_tier` on users, organization-level `account_tier` for workspace/team entitlement, admin tier assignment, central entitlement map, updated product-facing plan catalog, planned Growth catalog entry, subscription status table, event history, Settings Billing tab, checkout sessions, hosted checkout/portal templates, Stripe SDK/API checkout and portal sessions, Stripe webhook mapping/signature verification, cancellation scheduling, subscription lifecycle reconciliation, filtered invoice history with summary totals/PDF links, payment retry links, payment-failed notification outbox entries, staged dunning reminders with resolved-payment suppression, optional generic webhook signature verification, and Stripe sandbox verifier/runbook | Production scheduled worker deployment and live credential/webhook operations runbook |
| Feature access control | Central feature map, server guard, client helper, visible locked states, PRD feature slugs, saved bid/intent/search alert/team invite quota enforcement, team member usage counting, Settings usage dashboard, credit summary, organization-level feature overrides with reason/expiry metadata, audit filtering by actor/action/target/feature, and manifest-backed static coverage tests; session entitlements and workspace quotas now use organization tier; Submission Guidance and Pursue / No-Bid are currently Pursuit Starter-gated, Compliance Manifest, Response Workspace, Artifact Vault, Quote Workflow, and Deadline Notifications are currently Response Builder-gated, and Knowledge Station is currently Enterprise-gated | Real credit consumption/refund flows, optional richer beta program workflow, and custom enterprise permission rules |
| Search alerts | API/service foundation exists; global saved-search notification preference can suppress outbound alert emails; skipped/sent/failed/duplicate digest outcomes are recorded; creation is quota-gated by tier; Settings now includes alert CRUD, pause/resume, editable filters/digest fields, and recent delivery history | Real email delivery provider, bounce/complaint handling, operator digest monitoring dashboard |
| Notifications | Notification outbox, file/console/http providers, retry worker, failed retry limits, user preferences, billing dunning reminders, deployable notification/dunning worker command, invite delivery status, admin notification history, admin delivery trigger, provider env validation, and production delivery runbook exist | Real production email provider credentials/webhooks, bounce/complaint handling, template governance |
| Admin data QA | Source status/logs exist; bid detail surfaces attachment archival status and failure notes; Admin now has a QA queue with score, archive issue counts, review status, reviewer timestamp/by metadata, correction audit persistence, inline title/deadline correction, public suppression filtering, publish/suppress actions, rich filters, batch operations, and correction history. | Broader editable-field UI and raw/staged/normalized comparison detail |

### Not Implemented

| Area | Needed capability |
|---|---|
| Production billing polish | Production worker deployment, production credential rotation, webhook endpoint operations, and richer provider dashboard setup notes. |
| Organization team lifecycle | Invite acceptance analytics and richer team audit history. |
| Sourcing / quote workflow depth | Supplier portal, outbound email, response uploads, comparison scoring, audit events, and deeper partner profiles. |
| Award / tabulation tracking | Award notices, bid status monitoring, tabulation records. |
| Win/loss learning | Outcome capture, reason taxonomy, future recommendation improvements. |
| Knowledge Station depth | Retrieval, embeddings, admin publishing workflow, artifact uploads, usage metrics, and credit metering. |
| Production AI layer | LLM-backed extraction with citations, confidence, prompt rules, uncertainty handling. |

## Last Completed Phase

### P0 Admin/User Auth Regression

Completed locally:

- Added `role-route-coverage.test.ts` to lock every `/api/admin/**` route to one of three explicit role groups: full admin, admin/operator mutation, or admin/operator/support read-only console.
- Made admin read routes pass explicit `roles: ["admin", "operator", "support"]` instead of relying on implicit defaults.
- Added a source-governance regression so `operator` can update source enablement but cannot approve/hold/change legal-review fields; those fields now require full admin.
- Made `/admin` Config Registry load/render admin-only because the backing config APIs are admin-only.
- Hid the dashboard source-health `/admin` link from ordinary users while preserving login/register entries for anonymous users.
- Added `/intents/[id]` auth gating so anonymous visitors see the registered-user state before any personal intent API loads.

Verified:

- `npm test`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Browser smoke for anonymous `/settings`, `/admin`, and `/intents/[id]` login-required states.

## Recommended Next Phase

Prioritize the **P1-P3 Remaining Execution Schedule** before returning to deeper workflow modules.

Implementation plans:

- Primary remaining schedule: `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`
- Broader alignment plan: `docs/superpowers/plans/2026-06-02-auth-tier-source-anonymous-alignment.md`

Reason:

- P1 Tier / Paid Feature Locking is complete locally and should now be treated as the permission baseline.
- Personal workspace routes still need a final cleanup pass so public anonymous browsing and registered-user workspaces cannot conflict.
- 50-state crawler coverage exists, but product readiness requires continued proof that data is non-empty, source-attributed, detail pages are safe, and downloads do not expose demo/404 URLs.
- Docs/runbooks must be updated after each wave so the next session can continue from the checklist without re-reading the codebase.

Execution order:

1. **P0 Admin/User Auth Regression**：Done locally; keep this regression suite in every future phase.
2. **Wave 1 / P1 Tier / Paid Feature Locking**：并行启动 backend entitlement/API gate worker 与 frontend locked/upgrade state worker；先统一 Free / Pro / Business / Enterprise 矩阵。
3. **Wave 2 / P1 Anonymous Boundary Cleanup**：Next. 保留公开浏览能力，移除个人工作区匿名持久化路径。
4. **Wave 3 / P2 50-State Source Validity Hardening**：Wave 2 API 测试通过后启动；强化 50 州数据非空、真实来源、详情可打开、附件可下载/可安全代理。
5. **Wave 4 / P3 Docs / Operations Handoff**：每个 wave 完成后更新本清单、runbook、risk-check/source-health 说明。

Parallel agent plan:

- Agent C：backend entitlement matrix, feature-gated API routes, `FeatureAccessError` / authenticated principal coverage.
- Agent D：frontend locked/upgrade states, Settings plan/usage display, Intent module plan-limit UX.
- Agent F：anonymous boundary cleanup and docs integration.
- Agent E：50-state source validity, non-empty crawler output, safe detail/download validation.

After this alignment phase, resume workflow depth in this order: Submission Guidance Completion, Response Package format depth, Config Matrix depth, Award / Tabulation Tracking, Win/Loss Learning.

## Account / Role / Tier Direction

### Roles

Use roles for operational authority:

- `user`: ordinary supplier account.
- `admin`: full platform operator with user management, tier assignment, audit visibility, subscription reconciliation, and operational controls.
- `operator`: operations staff with crawler/source, notification, and dunning controls but no user management.
- `support`: support staff with read-only operational admin views.

Later optional roles:

- `owner`: company account owner.
- `member`: company team member.

### Tiers

Use tiers for product entitlement. Current internal values remain compatibility values until a migration is justified:

- `free` / Free: basic search, limited saved bids, limited intents.
- `pro` / Pursuit Starter: more saved bids/intents, match explanations, submission guidance, pursue/no-bid.
- `business` / Response Builder: compliance manifest, team-ready workspace, quote workflow.
- Planned Growth: future plan, disabled until exact package boundaries are confirmed.
- `enterprise` / Enterprise: advanced intelligence, Knowledge Station, admin support, higher limits.

### Feature Keys

Start with a central feature map:

| Feature key | Free | Pursuit Starter (`pro`) | Response Builder (`business`) | Enterprise |
|---|---:|---:|---:|---:|
| `bid_search` | Yes | Yes | Yes | Yes |
| `saved_bids` | Limited | Yes | Yes | Yes |
| `supplier_profile` | Yes | Yes | Yes | Yes |
| `match_score` | Basic | Full | Full | Full |
| `intent_workspace` | Limited | Yes | Yes | Yes |
| `submission_guidance` | Preview | Yes | Yes | Yes |
| `compliance_manifest` | No | Preview | Yes | Yes |
| `pursue_no_bid` | No | Yes | Yes | Yes |
| `quote_workflow` | No | No | Yes | Yes |
| `knowledge_station` | No | No | Limited | Yes |
| `admin_console` | Admin only | Admin only | Admin only | Admin only |

### Usage Limits

Current local limits use internal tier values. Product-facing labels should be shown in UI after the commercial packaging reconciliation:

| Feature key | Free | Pursuit Starter (`pro`) | Response Builder (`business`) | Enterprise |
|---|---:|---:|---:|---:|
| `saved_bids` | 5 | 50 | 250 | Unlimited |
| `intent_workspace` | 2 | 20 | 100 | Unlimited |
| `search_alerts` | 2 | 10 | 50 | Unlimited |
| `team_members` | 1 | 3 | 10 | Unlimited |

## Suggested Implementation Order

1. **Product 2 Qualification Upgrade Continuation**
   - Deeper AI extraction and document-level evidence mapping can wait until real model integration.

2. **Response Workspace Lite**
   - Add tasks, artifacts, internal checkpoints, and a response package outline on top of Intent detail.

3. **Production operations polish**
   - Dry-run worker deployment and connect real provider credentials/webhooks when available.

4. **Product workflow depth**
   - Build Response Workspace, Artifact Vault, Quote Lite, deadline notifications, and award learning in thin MVP slices.

## Completed Phase: Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1

本阶段完成：
- `PursuitRecommendation` 新增 additive `reasonDetails`，包含 category、severity、summary、explanation、evidenceLabel、suggestedAction。
- deterministic generator 将 match score、geography、pricing、deadline、documentation、addenda、registration、risk flags、profile gaps 映射为稳定原因分类。
- 保留既有 `reasons: string[]` 和 `pursuit_decisions` 历史记录格式，不要求用户保存 taxonomy 输入。
- Intent detail 的 Pursue / No-Bid 面板新增结构化原因卡片，展示类别、严重度、证据标签、解释和建议动作。
- 中英文文案、server tests、route tests、client tests、页面静态 coverage 已补齐。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Product 2 Richer Evidence / Artifact Links。
2. Compliance evidence mapping。
3. Knowledge Station Lite、Response Workspace Lite、Artifact Vault Lite。

## Completed Phase: Product 2 Amendment/Addenda Awareness v1

本阶段完成：
- 新增 qualification freshness 服务，检测 title、description、archived detail text、attachments 中的 amendment/addenda/update/Q&A 信号。
- 新增 `/api/intents/[id]/qualification/freshness` GET/POST，GET 返回 current/stale/not-refreshed、last refreshed、latest signal 和 signal count；POST 刷新 match snapshot、deterministic brief/checklist/risk flags 和 evidence citations。
- 刷新逻辑不覆盖用户编辑过的 Submission Guidance、Compliance Manifest、Pursue/No-Bid decision 记录。
- Intent detail 证据区域新增 freshness 状态面板、信号数量、最新信号和刷新按钮；刷新后清空旧 Q&A answer，后续问答使用最新 citation snapshot。
- API client、route tests、server tests、详情页静态 coverage 和中英文文案已补齐。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Product 2 No-Bid Taxonomy + Qualification Risk Explanations。
2. Richer evidence/artifact links and compliance evidence mapping。
3. Knowledge Station Lite、Response Workspace Lite、Artifact Vault Lite。

## Completed Phase: Search Alerts Notification History + Digest Delivery Verification

本阶段完成：
- 新增 `search_alert_digest_runs` 表，记录 Search Alert digest 的 sent / failed / skipped 投递结果。
- `sendMatchedAlertNotifications()` 和 notification delivery worker 会在发送成功、provider 失败/抛错、worker 重试成功、重复 digest、通知偏好关闭、缺少收件邮箱、暂不支持渠道时写入 digest run。
- `listSearchAlerts()` 会按当前用户和 alert 列表读取最近 digest history，并作为 additive 字段返回。
- Settings Search Alerts 卡片展示最近投递状态、匹配数量、失败/跳过原因和历史摘要。
- 保持现有 Search Alerts CRUD、quota gate、通知偏好和 notification outbox wire shape 不变。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Product 2 Amendment/Addenda Awareness：检测 addenda/amendment 信号并刷新 qualification evidence/artifacts。
2. Production Email Provider：接入真实 provider credentials、bounce/complaint webhook 和运营监控。
3. Crawler Source Quality Monitoring：继续提升 beta 州源成熟度与生产监控。

## Completed Phase: Attachment Download Archival Downloader

本阶段完成：
- 新增 crawler archive downloader，公共 HTTP(S) 附件和可选详情页会写入本地 `attachments/<source>/<bid-id>/...`。
- 归档元数据会记录 `storage_path`、`byte_size`、`content_type`、`checksum_sha256`、`fetched_at`、`archive_status` 和失败原因。
- 非 HTTP、本地、登录/SSO/CAPTCHA/browser-required 类 URL 不强行抓取，会标记为 unavailable；下载失败会标记 failed，但不让非空爬虫导入整体失败。
- `import-fixture`、`fetch-sam-gov`、`fetch-state` 支持 `--archive-documents`、`--archive-dir`、`--archive-detail-pages`。
- 前端 SAM.gov/state runner 默认启用附件归档，并支持显式关闭或指定归档目录。
- 招标详情页附件列表显示本地归档状态与失败说明，便于诊断“有数据但文件 404”的问题。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Bid Admin/Data QA Correction + Publish Controls：字段修正、原始值保留、publish/suppress、批量审核。
2. Product 2 Qualification Upgrade：document-grounded citations、Q&A、amendment/addenda awareness、evidence mapping、no-bid taxonomy。
3. Knowledge Station Lite：工作流教练、模板/片段、可复用知识沉淀。

## Completed Phase: Admin Bid QA Console Thin Slice

本阶段完成：
- `bids` 增加 `admin_review_note`、`admin_reviewed_at`、`admin_reviewed_by`，保留 review 状态的操作者和时间。
- 新增 Admin Bid QA repository，计算质量分，汇总 total/needsReview/archiveIssues/lowQuality。
- 新增 `/api/admin/bids/qa` 列表 API，支持 `limit/q/stateCode/reviewStatus/archiveStatus`。
- 新增 `/api/admin/bids/qa/[id]` PATCH API，admin/operator 可更新 `reviewStatus` 和 note，support 只读。
- `/admin` 接入 Bid Data QA 队列，展示质量分、归档问题数、质量 flags、review status，并支持快速标记 Reviewed / Needs review。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Admin QA Batch Filters + Correction History：display status/score/reviewer 过滤、批量 publish/suppress/review、原始值对比、修正历史面板。
2. Product 2 Qualification Upgrade：document-grounded citations、Q&A、amendment/addenda awareness、evidence mapping、no-bid taxonomy。
3. Knowledge Station Lite：工作流教练、模板/片段、可复用知识沉淀。

## Completed Phase: Bid Admin/Data QA Correction + Publish Controls

本阶段完成：
- `bids` 增加 `display_status`，公开 search/detail 会过滤 `suppressed` 招标。
- 新增 `bid_field_corrections`，每次修正会记录字段名、原始值、修正值、note、操作者和时间。
- Admin QA repository/API/client 支持三类 PATCH：review status、display status、field corrections。
- `/admin` QA 队列展示展示状态和修正次数，admin/operator 可发布、隐藏、保存 title/deadline 修正；support 保持只读。
- 中英文文案已补齐，定向测试覆盖 schema、repository、公开过滤、API route、API client、Admin UI。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Admin QA Batch Filters + Correction History：display status/score/reviewer 过滤、批量 publish/suppress/review、原始值对比、修正历史面板。
2. Product 2 Qualification Upgrade：document-grounded citations、Q&A、amendment/addenda awareness、evidence mapping、no-bid taxonomy。
3. Knowledge Station Lite：工作流教练、模板/片段、可复用知识沉淀。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. QA 字段修正：title、deadline、issuer、amount、category、source URL 等有限字段编辑。
2. 原始值保留：记录 crawler original value 与 corrected value，避免覆盖证据。
3. Publish/suppress 控制：面向搜索结果的发布状态、隐藏/恢复、批量操作。
4. 更深 QA 筛选：按 source confidence、quality score range、archive failed/unavailable、reviewer、reviewed date 过滤。

## Completed Phase: Commercial Packaging And Credits Reconciliation

本阶段完成：
- 保留内部 `free/pro/business/enterprise` tier 值，同时将产品展示套餐改为 Free、Pursuit Starter、Response Builder、Enterprise。
- 在订阅 plan catalog 中加入 planned/disabled 的 Growth 计划，不进入当前 checkout/webhook tier。
- 新增 PRD feature slugs：`bid.brief.full.generate`、`compliance.manifest.generate`、`readiness.review.run`、`response.workspace.create`、`artifact.vault.upload`、`response.section.draft`、`package.review.run`、`amendment.delta.run`、`award.tabulation.analyze`、`price.to.win.run`、`team.member.invite`。
- 新增 credits foundation：included monthly credits、premium action credit costs、system refund semantics、usage credit summary。
- 新增 `credit_balances` 与 `credit_usage_events` ledger placeholder 表。
- Settings Billing/Usage 展示新套餐名、Growth planned 状态和 credits 摘要。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. P1 Data Pipeline Hardening：Source Registry metadata、attachment/detail archival、checksum/content-type、quality flags。
2. Bid Admin/Data QA Console Expansion。
3. Product 2 Qualification Upgrade：citations、Q&A、amendment awareness、evidence mapping、no-bid taxonomy。

## Completed Phase: Account / Role / Tier Foundation

本阶段完成：
- `users` 增加 `account_tier` 与 `is_disabled`，迁移会兼容已有本地库。
- `/api/auth/session`、注册、登录返回 `role`、`tier`、`features`。
- 新增中心化 entitlement map，覆盖 Free/Pro/Business/Enterprise 与 admin-only 功能。
- 新增 Admin 用户管理 API：注册用户列表、改角色、改套餐、启用/禁用。
- `/admin` 接入用户权限表，普通用户侧边栏不再显示 Admin 入口。

当时还剩：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Organization team management：成员角色调整、移除、owner 转移。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Feature Guards / Tier-Aware UI

本阶段完成：
- 新增 server `requireFeature()` / `FeatureAccessError`，API 可统一按功能键拦截。
- `resolvePrincipal()` 现在为匿名和登录用户都携带 `role`、`tier`、`features`。
- 新增 client `useFeature()` / `canUseFeature()` / `lockedFeatureMessage()`。
- Submission Guidance GET/PATCH/confirm API 已按 `submission_guidance` 做 Pro 门槛。
- Intent Workspace 的 Submission Path 模块会按套餐显示锁定态。
- Settings/Profile 区域显示当前套餐和功能可用/锁定状态。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Organization team management：成员角色调整、移除、owner 转移。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Admin User Management Polish

本阶段完成：
- 新增 `admin_user_audit_logs` 表与迁移。
- `/api/admin/users` 支持按关键词、角色、套餐、启用状态过滤。
- `/api/admin/users/[id]` 修改角色、套餐、启用/禁用时写入审计日志。
- 新增 `/api/admin/users/audit-logs` 管理员接口。
- `/admin` 用户权限区增加搜索/筛选控件与“用户权限审计”视图。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Organization team management：成员角色调整、移除、owner 转移。
3. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Account Settings Foundation

本阶段完成：
- 新增当前用户资料更新服务与 `/api/account/profile`。
- 新增当前用户密码修改服务与 `/api/account/password`，会校验当前密码与新密码强度。
- `/settings` 个人资料从静态占位数据改为真实登录用户邮箱/显示名称。
- `/settings` 安全页接入真实密码修改流程，并补齐中英文状态文案。
- 新增服务、API route、前端 API client、Settings 静态检查测试。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Billing provider 同步与真实 checkout/发票/取消订阅。
2. Organization team management：成员角色调整、移除、owner 转移。
3. Account deletion/export 账号数据导出与删除。
4. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Billing / Subscription Foundation

本阶段完成：
- 新增 `account_subscriptions` 与 `subscription_events` 表，支持当前订阅状态和套餐变更事件历史。
- 新增订阅服务：默认读取 admin/manual 当前套餐，也支持本地 checkout/provider 同步入口更新有效 `account_tier`。
- 新增 `/api/account/subscription`，登录用户可读取当前订阅、来源、状态、周期结束时间和套餐目录。
- `/settings` 新增 Billing 标签页，展示当前套餐、订阅状态、来源、可用套餐和升级入口占位。
- 新增订阅服务、API route、前端 API client、Settings 静态检查和 schema 测试。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Usage limits：继续覆盖 alerts、AI/高级功能调用次数，并增加使用量仪表盘。
3. Organization team management：成员角色调整、移除、owner 转移。
4. Account deletion/export 账号数据导出与删除。
5. Submission Guidance 真实编辑与确认 UI。

## Completed Phase: Usage Limits Foundation

本阶段完成：
- 新增中心化 `usage-limits` 服务，定义 Free/Pro/Business/Enterprise 的 saved bids 与 intent workspace 额度。
- `/api/saved-bids` 在新增保存前检查额度；已保存的同一 bid 可幂等通过。
- `/api/bids/[id]/intent` 在新增 Intent 前检查额度；已有同一 bid 的 Intent 可幂等通过。
- 超额时 API 返回 `USAGE_LIMIT_REACHED`、当前用量、额度和推荐升级套餐。
- 前端 API client 识别 `USAGE_LIMIT_REACHED`；Bid Detail 的 Intent 创建失败会展示升级到 Pro 的提示。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
3. Organization team management：成员角色调整、移除、owner 转移。
4. Account deletion/export 账号数据导出与删除。

## Completed Phase: Submission Guidance UI

本阶段完成：
- Intent 详情页从静态 Submission Path 预览改为真实读取 `/api/intents/[id]/submission`。
- Pro 及以上用户可编辑提交方式、门户链接、联系邮箱、注册/纸质递交/补遗确认要求。
- 页面展示生成的提交指导、复杂度、准备清单和提交风险提示。
- 新增手动“确认已提交”表单，写入 `/api/intents/[id]/submission/confirm`。
- 补齐中英文文案和页面静态检查测试。

验证：
- `npm test -- src/app/intents/page.test.ts src/lib/api/intents.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts'`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 Intent 工作台，保存提交指导成功，确认已提交成功。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Account deletion/export 账号数据导出与删除。
5. Organization team management：成员角色调整、移除、owner 转移。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

当时建议下一步：
- 优先开发 Compliance Manifest Lite，因为它直接承接 Submission Guidance，让用户开始把投标要求转成可执行清单。

## Completed Phase: Admin Page Access Guard

本阶段完成：
- `/admin` 页面接入当前 session 权限判断。
- 未登录用户访问 `/admin` 时显示登录提示和登录入口。
- 已登录但非 admin 用户访问 `/admin` 时显示无权限提示和返回控制台入口。
- 只有 admin 用户才触发 admin 数据源、用户、审计日志等管理 API 加载。
- 补齐中英文权限状态文案和 admin 页面静态检查测试。

验证：
- `npm test -- src/app/admin/page.test.ts`
- `npm test -- src/app/admin/page.test.ts src/app/layout.test.ts src/lib/api/admin.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 `/admin`，当前 admin 会话正常进入“管理员运维”页面。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Account deletion/export 账号数据导出与删除。
5. Organization team management：成员角色调整、移除、owner 转移。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 继续做 Organization team management，补齐成员角色调整、移除、owner 转移。

## Completed Phase: Admin User Invite Flow

本阶段完成：
- 新增 admin repository `createAdminUserInvite()`，可创建本地邀请账号并生成临时密码。
- 新增 `/api/admin/users` POST，管理员可创建账号并指定角色、套餐、显示名称。
- 创建邀请账号时写入 `admin_user_audit_logs`，action 为 `user_invited`。
- 前端 admin API client 新增 `createAdminUser()`。
- `/admin` 用户权限区新增邀请表单：邮箱、显示名称、角色、套餐，并显示一次性临时密码。
- 补齐中英文文案和 repository/route/client/page 测试。

验证：
- `npm test -- src/server/admin/users-repository.test.ts src/app/api/admin/users/route.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- 浏览器烟测：打开 `/admin`，确认“邀请用户”表单、角色/套餐选择和“创建邀请”按钮已渲染。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 优先做 Organization team management，因为账号、角色、套餐、恢复闭环和团队共享数据已经具备，下一块应补齐成员生命周期。

## Completed Phase: Password Reset Flow

本阶段完成：
- 新增 `password_reset_tokens` 表与迁移，保存一次性 token hash、过期时间、使用时间。
- 新增密码重置服务：请求重置、生成本地 reset token、未知邮箱不泄露账号存在性、确认 token 后更新密码。
- token 使用后会标记 `used_at`，过期/已使用/无效 token 都会拒绝；重置成功后清理该用户已有 session。
- 新增 `/api/auth/password-reset/request` 与 `/api/auth/password-reset/confirm`。
- 前端 API client 新增 `requestPasswordReset()` 与 `confirmPasswordReset()`。
- 登录页新增“忘记密码”入口；新增 `/forgot-password` 和 `/reset-password` 双语页面。

验证：
- `npm test -- src/server/auth/password-reset.test.ts src/server/db/schema.test.ts src/app/api/auth/password-reset/request/route.test.ts src/app/api/auth/password-reset/confirm/route.test.ts src/lib/api/auth.test.ts src/app/login/page.test.ts src/app/forgot-password/page.test.ts src/app/reset-password/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 优先开发 Organization team management，让普通账号、admin、套餐等级和未来高级功能真正落到可管理的公司团队上。

## Completed Phase: Organization / Workspace Foundation

本阶段完成：
- 新增 `organizations` 与 `organization_memberships` 表，支持组织和 owner/member 工作区角色。
- 注册普通用户时自动创建默认 organization，并写入 owner membership。
- 旧用户在读取 session/workspace 时会自动补齐个人工作区，兼容已有本地数据库。
- `/api/auth/session` 的用户 payload 可携带当前 workspace 信息：organizationId、organizationName、role。
- 新增 workspace 服务：读取工作区、修改组织名称、owner 邀请本地成员、member 管理操作会被拒绝。
- 新增 `/api/account/workspace` GET/PATCH 与 `/api/account/workspace/members` POST。
- 前端 API client 新增 `fetchAccountWorkspace()`、`updateAccountWorkspace()`、`inviteWorkspaceMember()`。
- `/settings` 新增 Team 标签页，可查看工作区、修改名称、邀请成员并显示一次性临时密码。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/app/api/auth/session/route.test.ts src/app/api/account/workspace/route.test.ts src/app/api/account/workspace/members/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/server/auth/service.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 继续做 Organization team management，补齐成员角色调整、移除、owner 转移。

## Completed Phase: Organization Shared Workspace Data

本阶段完成：
- 新增 workspace scope 工具：认证用户按所属 organization 的 active members 解析数据范围，匿名用户保持单用户 cookie 范围。
- Saved bids 支持组织共享：owner/member 任一方保存后，同 workspace 成员都能在 `/api/saved-bids` 看到；重复保存同一 bid 会复用已有记录；删除会从 workspace 视图移除。
- Intent workspace 支持组织共享：owner/member 任一方创建后，同 workspace 成员可在 `/api/intents` 与 `/api/intents/[id]` 读取同一 intent。
- Intent 创建按 workspace 维度幂等：同一 workspace 内同一 bid 只复用一个 intent，不会因为不同成员重复创建而分裂。
- Intent 状态更新按 workspace 授权：同 workspace 成员可更新共享 intent；其他 workspace 用户不可读取或更新。
- Saved bids 与 intent usage limits 改为 workspace 范围计数，避免免费/付费额度被成员拆分绕过。

验证：
- `npm test -- src/server/bids/repository.test.ts src/server/intents/service.test.ts src/server/auth/usage-limits.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- API 烟测：owner 注册并邀请 member；owner 保存 bid 与创建 intent；member 登录后能读取同一 saved bid 和 intent。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Organization team management：成员角色调整、移除、owner 转移。
2. Account deletion/export 账号数据导出与删除。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
6. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。

建议下一步：
- 继续做 Organization team management：先实现 owner 修改成员角色、移除成员、禁止移除最后一个 owner，再接 Settings Team UI。

## Completed Phase: Organization Team Management

本阶段完成：
- Workspace service 新增成员角色调整与成员移除能力，只有 workspace owner 可以执行。
- 系统会阻止降级或移除最后一个 active owner，避免团队失去管理者。
- 被移除成员会退出原 organization；再次访问 workspace 时会回到自己的个人工作区。
- 新增 `/api/account/workspace/members/[userId]` PATCH/DELETE，分别用于调整角色和移除成员。
- 前端 API client 新增 `updateWorkspaceMemberRole()` 与 `removeWorkspaceMember()`。
- `/settings` Team 标签页接入成员角色下拉和移除按钮，并补齐中英文状态文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/lib/api/auth.test.ts 'src/app/api/account/workspace/members/[userId]/route.test.ts' src/app/settings/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Compliance Manifest Lite：结构化需求、人工完成状态、备注和证据状态。
2. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
3. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
6. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。

建议下一步：
- 优先开发 Compliance Manifest Lite，把 Submission Guidance 生成的提交要求沉淀为可勾选、可备注、可追踪证据状态的执行清单。

## Completed Phase: Compliance Manifest Lite

本阶段完成：
- 新增 `compliance_manifest_items` 表与迁移，用于保存 Intent 维度的结构化合规清单。
- 新增 Compliance Manifest 生成器：基于 Intent 初始清单、风险提示和基础投标准备项生成合规条目。
- 新增 Compliance service/repository，支持按可访问 Intent 创建清单、读取清单、更新条目状态、证据状态和备注。
- 新增 `/api/intents/[id]/compliance` GET/PATCH，并使用 `compliance_manifest` feature gate；Business/Enterprise 可访问，Pro/Free 会返回 `FEATURE_NOT_AVAILABLE`。
- 前端 API client 新增 `fetchComplianceManifest()` 与 `updateComplianceManifestItem()`。
- Intent 工作台新增 Compliance Manifest 面板：低套餐显示锁定说明；Business+ 显示完成概览、条目状态、证据状态和备注编辑。
- 补齐中英文文案和静态页面检查。

验证：
- `npm test -- src/server/compliance/service.test.ts 'src/app/api/intents/[id]/compliance/route.test.ts' src/lib/api/intents.test.ts src/server/db/schema.test.ts src/app/intents/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- 浏览器烟测：从 bid detail 创建 Intent，打开 Intent 工作台，确认 Compliance Manifest 面板渲染 8 条清单、完成概览和证据备注输入。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Pursue / No-Bid Decision Lite：推荐、决策记录、原因和历史。
2. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
3. Account deletion/export 账号数据导出与删除。
4. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
5. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
6. Response Workspace：任务、文档、内部检查点和附件/证据管理。

建议下一步：
- 开发 Pursue / No-Bid Decision Lite，让 Pro+ 用户能基于匹配、风险、合规清单进度记录是否继续投标及原因。

## Completed Phase: Pursue / No-Bid Decision Lite

本阶段完成：
- 新增 `pursuit_decisions` 表与迁移，用于保存 Intent 维度的投标/放弃决策历史。
- 新增 Pursuit recommendation generator，基于匹配分数、风险提示、资料缺口和截止日期生成 `pursue` / `no_bid` / `review` 推荐。
- 新增 Pursuit service/repository，支持读取推荐、读取当前决策、保存新决策记录、返回历史记录。
- 新增 `/api/intents/[id]/decision` GET/PATCH，并使用 `pursue_no_bid` feature gate；Pro/Business/Enterprise 可访问，Free 会返回 `FEATURE_NOT_AVAILABLE`。
- 前端 API client 新增 `fetchPursuitDecisionBoard()` 与 `updatePursuitDecision()`。
- Intent 工作台新增 Pursue / No-Bid Decision 面板：低套餐显示锁定说明；Pro+ 显示推荐、置信度、决策选择、原因、备注和历史记录。
- 补齐中英文文案和静态页面检查。

验证：
- `npm test -- src/server/pursuit/service.test.ts 'src/app/api/intents/[id]/decision/route.test.ts' src/lib/api/intents.test.ts src/server/db/schema.test.ts src/app/intents/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- 浏览器烟测：打开 Intent 工作台，确认 Pursue / No-Bid Decision 面板、推荐区、保存决策按钮和决策历史渲染。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 真实 billing provider 接入：checkout、webhook、invoice、cancel、trial expiration。
2. Account deletion/export 账号数据导出与删除。
3. Organization team lifecycle：owner 转移流程、成员禁用/恢复、邀请接受/邮件投递。
4. Usage limits 扩展：alerts、AI/高级功能调用次数、用量仪表盘。
5. Response Workspace：任务、文档、内部检查点和附件/证据管理。
6. Production AI layer：LLM-backed extraction、引用、置信度和不确定性处理。

建议下一步：
- 优先做 Billing Provider Sync，把当前本地套餐/权限基础接到真实 checkout、webhook 和订阅状态同步上。

## Completed Phase: Billing Provider Sync Foundation

本阶段完成：
- 新增 `billing_checkout_sessions` 表，记录用户自助升级 checkout session。
- `subscription_events` 增加 `provider_event_id`，provider webhook 重放时可去重。
- 新增订阅服务能力：创建 Pro/Business checkout、接收 `checkout.completed` / `subscription.updated` / `subscription.deleted` provider event、同步 `account_subscriptions` 与 `users.account_tier`、安排 period end 取消。
- 新增 `/api/account/subscription/checkout`、`/api/account/subscription/cancel`、`/api/billing/webhook`。
- 前端 API client 接入 checkout/cancel。
- `/settings` Billing 标签页支持 Pro/Business 自助开始结账、显示 checkout 状态消息、取消当前订阅。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/api/account/subscription/checkout/route.test.ts src/app/api/account/subscription/cancel/route.test.ts src/app/api/billing/webhook/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/server/db/schema.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider Hardening：真实 provider credentials/config、webhook signature、hosted checkout redirect、customer portal。
2. Invoice / Payment History UI：发票记录、provider invoice link、账单历史。
3. Trial / Dunning Lifecycle：试用到期、扣款失败、逾期提醒、降级规则。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 继续做 Invoice / Payment History UI + Production Billing Provider Hardening；如果先补账户完整性，则做 Account deletion/export 与 owner 转移。

## Completed Phase: Invoice / Payment History + Webhook Signature Foundation

本阶段完成：
- 新增 `billing_invoices` 表，记录 provider invoice id、invoice number、金额、币种、状态、发票链接、PDF 链接、到期/支付时间。
- `applyBillingProviderEvent()` 支持 `invoice.paid` 与 `invoice.payment_failed`，能写入发票历史，并在支付失败时把订阅状态同步为 `past_due`。
- 新增 `listAccountInvoices()` 服务和 `/api/account/billing/invoices`，登录用户可读取自己的账单/发票历史。
- `/api/billing/webhook` 支持 `invoice.*` event，并在配置 `BILLING_WEBHOOK_SECRET` 时要求 `x-billing-signature` HMAC-SHA256 校验。
- 前端 API client 新增 `fetchBillingInvoices()`。
- `/settings` Billing 标签页新增 Invoice history 区域，展示发票编号、状态、金额、日期和发票链接。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/server/db/schema.test.ts src/app/api/account/billing/invoices/route.test.ts src/app/api/billing/webhook/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider Hardening：真实 provider SDK/config、hosted checkout redirect、customer portal、provider-specific event mapping、部署环境变量说明。
2. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
4. Account deletion/export 账号数据导出与删除。
5. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 如果继续商业化主线，做 Production Billing Provider Hardening + Customer Portal；如果补账户闭环，做 Account deletion/export + owner 转移。

## Completed Phase: Hosted Billing Provider + Customer Portal Foundation

本阶段完成：
- `createCheckoutSession()` 支持 `BILLING_CHECKOUT_URL_TEMPLATE`，配置后生成 hosted checkout URL，并填充 `providerSessionId`、`tier`、`userId`、`successUrl`、`cancelUrl`。
- 新增 `createCustomerPortalSession()`，支持 `BILLING_CUSTOMER_PORTAL_URL_TEMPLATE`，配置后用 provider customer id 生成 customer portal URL；未配置时回退本地 Settings。
- 新增 `/api/account/billing/portal`，登录用户可创建自己的账单门户会话。
- 前端 API client 新增 `createBillingPortalSession()`。
- `/settings` Billing 标签页新增 Manage Billing 入口，统一进入本地/hosted 账单门户。
- 补齐中英文账单门户文案。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/api/account/billing/portal/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run db:migrate`
- `npm run build`
- `git diff --check`
- 浏览器烟测：打开 `/settings`，切换 Billing/账单标签，确认“管理账单”“打开账单门户”和发票区域渲染。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Account deletion/export 账号数据导出与删除。
6. Organization team lifecycle：owner 转移、成员禁用/恢复、邀请接受/邮件投递。

建议下一步：
- 如果继续商业化主线，做真实 provider SDK/API adapter；如果先补账户闭环，做 Account deletion/export + owner 转移。

## Completed Phase: Account Export / Deletion + Owner Transfer

本阶段完成：
- 新增 `exportAccountData()`，导出当前用户账户、工作区、订阅/发票、收藏、供应商资料、投标意向、Submission/Compliance/Pursuit 数据和搜索提醒。
- 新增 `softDeleteAccount()`，软删除会匿名化邮箱、清空密码、禁用账户、清理 session/reset token，并移除 active workspace 访问。
- 删除账户时，如果当前用户是仍有其他 active 成员的唯一 owner，会返回 `OWNER_TRANSFER_REQUIRED`，要求先转让 owner。
- 新增 `transferWorkspaceOwnership()`，owner 可把工作区 owner 转给其他 active 成员，自己降为 member。
- 新增 `/api/account/export`、`DELETE /api/account`、`/api/account/workspace/ownership`。
- 前端 API client 新增 `exportAccountData()`、`deleteAccount()`、`transferWorkspaceOwnership()`。
- `/settings` Security 标签新增账户数据导出和删除账户入口；Team 标签新增显式“转让 Owner”操作。
- 补齐中英文账户生命周期文案。

验证：
- `npm test -- src/server/account/lifecycle.test.ts src/app/api/account/export/route.test.ts src/app/api/account/route.test.ts src/app/api/account/workspace/ownership/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`
- `npm test`
- `npm run db:migrate`
- `npm run lint`
- `npm run build`
- `git diff --check`
- 浏览器烟测：打开 `/settings`，Security/安全 标签显示“导出账户数据”“删除账户”；Team/团队 标签显示“转让 Owner”。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Organization team lifecycle：成员禁用/恢复、邀请接受/邮件投递。
6. Usage Dashboard：展示当前使用量与套餐额度。

建议下一步：
- 如果继续权限/账户主线，做成员禁用/恢复 + 邀请接受；如果继续商业化主线，做真实 provider SDK/API adapter。

## Completed Phase: Workspace Member Disable / Restore + Invitation Acceptance

本阶段完成：
- `organization_memberships.status` 现在支持 `active`、`invited`、`disabled`，Team 列表会展示成员状态。
- 新增 `workspace_invitations` 表，保存邀请 token hash、邀请人、被邀请用户、过期时间和接受时间。
- 邀请成员时不再直接给临时密码，而是创建 pending invited 用户、invited membership 和本地 invite URL。
- 新增 `acceptWorkspaceInvitation()`，被邀请用户可通过 token 设置密码并激活 membership，同时创建 session。
- 新增成员 `disableWorkspaceMember()` / `restoreWorkspaceMember()`，Owner 可暂停/恢复成员访问；停用会清理该成员 session 并排除在 workspace usage scope 之外。
- 新增 `/api/account/workspace/invitations/accept`，并扩展 `/api/account/workspace/members/[userId]` 支持 status PATCH。
- 前端 API client 新增 `acceptWorkspaceInvitation()` 与 `setWorkspaceMemberStatus()`。
- 新增 `/accept-invite` 页面，支持输入 token、显示名称、密码并接受邀请。
- `/settings` Team 标签显示 invited/disabled 状态、邀请链接、停用/恢复按钮。
- 补齐中英文邀请接受、成员状态、停用/恢复文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/app/api/account/workspace/members/route.test.ts src/app/api/account/workspace/members/[userId]/route.test.ts src/app/api/account/workspace/invitations/accept/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/app/accept-invite/page.test.ts`
- `npm run lint`
- `npm run build`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Production Notification Delivery：把本地 notification outbox 接到真实邮件服务、重试与投递状态。
6. Usage Dashboard：展示当前使用量与套餐额度。

建议下一步：
- 如果继续权限/账户主线，做 Usage Dashboard + entitlement coverage audit；如果继续商业化主线，做真实 provider SDK/API adapter。

## Completed Phase: Workspace Invitation Resend / Revoke + Local Email Outbox

本阶段完成：
- `workspace_invitations` 增加 `revoked_at` 与 `last_sent_at`，迁移兼容已有本地库。
- `inviteWorkspaceMember()` 会向 `notification_outbox` 写入本地邀请邮件记录，内容包含 invite URL。
- 新增 `resendWorkspaceInvitation()`，Owner 可为 pending invitation 轮换 token、延长过期时间并再次写入通知 outbox。
- 新增 `revokeWorkspaceInvitation()`，Owner 可撤销 pending invitation；撤销后旧 token 不可接受，并释放被邀请邮箱供后续重新邀请。
- 新增 `/api/account/workspace/invitations/[userId]/resend` 与 `/api/account/workspace/invitations/[userId]`。
- 前端 API client 新增 `resendWorkspaceInvitation()` 与 `revokeWorkspaceInvitation()`。
- `/settings` Team 标签对待接受成员显示“重发邀请 / 撤销邀请”，重发后展示新的邀请链接。
- 补齐中英文邀请重发、撤销、确认文案。

验证：
- `npm test -- src/server/account/workspace.test.ts src/server/db/schema.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/app/api/account/workspace/invitations/[userId]/resend/route.test.ts src/app/api/account/workspace/invitations/[userId]/route.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Production Notification Delivery：把 notification outbox 接到真实邮件服务、投递重试、投递状态展示与偏好。
6. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
7. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续权限/账户主线，做 Production Notification Delivery；如果继续商业化主线，做 Production Billing Provider SDK/API Adapter。

## Completed Phase: Usage Dashboard + Entitlement Coverage Audit

本阶段完成：
- 新增 `getAccountUsage()` 服务，复用现有 `usage-limits`，按 workspace scope 返回 saved bids 与 intent workspace 的 used/limit/remaining。
- 新增 `/api/account/usage`，登录用户可读取当前套餐下的工作区用量。
- 前端 API client 新增 `fetchAccountUsage()`。
- `/settings` Profile 区新增 Usage Dashboard，展示已用量、上限、剩余额度和升级提示。
- 新增 `feature-gate-coverage.test.ts`，静态检查 Submission Guidance、Submission Confirm、Compliance Manifest、Pursue / No-Bid 这些高级 API 继续包含 `requireFeature()` 和对应 feature key。
- 补齐中英文用量仪表盘文案。

验证：
- `npm test -- src/server/account/usage.test.ts src/app/api/account/usage/route.test.ts src/server/auth/feature-gate-coverage.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Production Notification Delivery：把 notification outbox 接到真实邮件服务、投递重试、投递状态展示与偏好。
6. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
7. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续权限/账户主线，做 Production Notification Delivery；如果继续商业化主线，做 Production Billing Provider SDK/API Adapter。

## Completed Phase: Production Notification Delivery Foundation

本阶段完成：
- `notification_outbox` repository 新增 `listDeliverableNotifications()`，可按创建时间读取 pending 和未超过重试次数的 failed 通知。
- 新增 `deliverPendingNotifications()`，统一投递 pending/failed 通知，成功标记 sent，失败记录错误并增加 attempt count，超过最大重试次数会跳过。
- 新增 HTTP notification provider：`NOTIFICATION_PROVIDER=http`、`NOTIFICATION_HTTP_ENDPOINT`、`NOTIFICATION_HTTP_TOKEN` 可把通知 payload POST 到外部邮件/通知服务。
- provider factory 支持 file、console、http 三种模式；file 仍作为本地默认 fallback。
- 新增 `/api/admin/notifications/deliver`，管理员可手动触发一次通知投递批处理并拿到 attempted/sent/failed/skipped 摘要。
- 补齐 outbox、delivery、HTTP provider、provider factory 和 admin API 测试。

验证：
- `npm test -- src/server/notifications/outbox-repository.test.ts src/server/notifications/delivery.test.ts src/server/notifications/providers/http.test.ts src/server/notifications/provider.test.ts src/app/api/admin/notifications/deliver/route.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Notification Preferences / Delivery Status UI：用户通知偏好、邀请投递状态、admin 通知投递历史 UI。
6. Scheduled Notification Worker：部署环境中的定时投递任务。
7. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
8. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续权限/账户主线，做 Notification Preferences / Delivery Status UI；如果继续商业化主线，做 Production Billing Provider SDK/API Adapter。

## Completed Phase: Notification Preferences / Delivery Status UI

本阶段完成：
- 新增 `user_notification_preferences` 表与账户通知偏好服务，默认启用 saved-search alerts，默认 daily digest，营销更新默认关闭。
- 新增 `/api/account/notification-preferences` GET/PATCH，前端 API client 和 `/settings` Notifications 标签已接入真实偏好。
- `sendMatchedAlertNotifications()` 会读取用户偏好，关闭 saved-search alerts 后不再入队或发送匹配提醒。
- Workspace Team 列表会展示 pending invitation 的最新通知投递状态，包括 pending/sent/failed、尝试次数和失败原因。
- 新增 `/api/admin/notifications`，Admin 页面可查看最近 notification outbox，并可从 UI 手动触发投递 worker。
- 补齐 notification preferences、workspace delivery status、admin notifications API/client/page、settings page 和 schema 测试。

验证：
- `npm test -- src/server/account/notification-preferences.test.ts src/app/api/account/notification-preferences/route.test.ts src/server/db/schema.test.ts src/server/notifications/outbox-repository.test.ts src/server/notifications/service.test.ts src/server/account/workspace.test.ts src/app/api/admin/notifications/route.test.ts src/lib/api/auth.test.ts src/lib/api/admin.test.ts src/app/settings/page.test.ts src/app/admin/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Trial / Dunning Lifecycle：试用到期、扣款失败重试、逾期提醒、自动降级规则。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Scheduled Notification Worker：部署环境中的定时投递任务。
6. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
7. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
8. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续商业化主线，做 Production Billing Provider SDK/API Adapter；如果继续账户/通知主线，做 Scheduled Notification Worker 和 Full Search Alerts UI。

## Completed Phase: Subscription Lifecycle Reconciliation

本阶段完成：
- 新增 `reconcileSubscriptionLifecycle()` / `reconcileUserSubscriptionLifecycle()`，统一处理订阅生命周期。
- 已支持 cancel-at-period-end 到期后取消并降级到 Free。
- 已支持 active 订阅过期后标记为 `past_due`，宽限期内保留原套餐功能。
- 已支持 `past_due` 超过宽限期后自动取消并降级到 Free。
- 已支持 trialing 到期后取消并移除付费功能。
- `loginUser()` 和 `getSessionUser()` 会在返回权限前同步当前用户订阅生命周期，避免过期 Pro/Business 权限长期滞留。
- 新增 `/api/admin/subscriptions/reconcile`，Admin 可手动批量同步订阅权限；`/admin` 顶部新增“同步订阅权限”按钮。

验证：
- `npm test -- src/app/api/admin/subscriptions/reconcile/route.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts src/server/billing/subscriptions.test.ts src/server/auth/service.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Billing Provider SDK/API：接真实 Stripe/其他 provider SDK、真实 hosted checkout/customer portal session 创建、sandbox credentials。
2. Provider-specific event mapping：把真实 provider payload 转换为当前内部 `BillingProviderEvent`。
3. Payment Retry / Dunning Communications：支付失败提醒邮件、支付重试链接、逾期提示 UI。
4. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
5. Scheduled Notification Worker：部署环境中的定时投递任务。
6. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
7. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
8. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续权限/商业化主线，做 Production Billing Provider SDK/API Adapter；如果继续通知主线，做 Scheduled Notification Worker 和 Full Search Alerts UI。

## Completed Phase: Stripe Billing Provider SDK/API Adapter

本阶段完成：
- 新增 `stripe` SDK 依赖与 `BillingProviderAdapter` 抽象，保留本地/template checkout fallback。
- Settings Billing 的 Pro/Business checkout 可在 `BILLING_PROVIDER=stripe` 时创建真实 Stripe Checkout subscription session。
- Manage Billing 可在已有 `providerCustomerId` 时创建真实 Stripe Billing Portal session。
- Cancel subscription 会在 Stripe 侧设置 `cancel_at_period_end=true` 后再更新本地取消状态。
- `/api/billing/webhook` 支持 Stripe `Stripe-Signature` 验签，并把 `checkout.session.completed`、`customer.subscription.updated/deleted`、`invoice.paid`、`invoice.payment_failed` 映射为内部 `BillingProviderEvent`。
- 新增 Stripe 价格环境变量说明：`STRIPE_PRICE_PRO_MONTHLY`、`STRIPE_PRICE_BUSINESS_MONTHLY`，并在 README 中补充本地/Stripe billing 配置。

验证：
- `npm test -- src/app/api/billing/webhook/route.test.ts src/server/billing/providers.test.ts src/server/billing/subscriptions.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Payment Retry / Dunning Communications：支付失败提醒邮件、支付重试链接、逾期提示 UI。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、支付重试链接、更完整的发票详情。
4. Scheduled Notification Worker：部署环境中的定时投递任务。
5. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
6. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
7. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续商业化主线，做 Payment Retry / Dunning Communications；如果要先稳定生产环境，做 Stripe Sandbox E2E Verification 和部署 runbook。

## Completed Phase: Payment Retry / Dunning Communications Foundation

本阶段完成：
- `invoice.payment_failed` 事件在写入 `billing_invoices`、同步订阅为 `past_due` 后，会向 `notification_outbox` 写入一条账单提醒。
- 支付失败提醒按 `billing:payment_failed:{providerInvoiceId}` 去重，Stripe 或 provider 重放/重试事件不会重复入队同一张发票提醒。
- 提醒内容包含 invoice number、应付金额、到期时间、hosted invoice/payment retry link，以及宽限期后可能影响付费功能的说明。
- Settings Billing 在订阅 `past_due` 时显示逾期提示，优先展示失败发票的“Retry payment”链接，同时保留 “Update payment method” 账单门户入口。
- Invoice history 中支付失败的发票按钮从 “View invoice” 切换为 “Retry payment”，让用户能直接进入 hosted invoice page 完成支付。
- 补齐中英文账单逾期、重试支付、更新支付方式文案。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/settings/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Multi-step Dunning Schedule：T+0/T+2/T+5 等多阶段提醒、频控、已支付后的提醒抑制。
2. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、更完整的发票详情。
4. Scheduled Notification Worker：部署环境中的定时投递任务。
5. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
6. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
7. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续商业化主线，做 Multi-step Dunning Schedule；如果要先稳定生产环境，做 Stripe Sandbox E2E Verification 和部署 runbook。

## Completed Phase: Multi-step Dunning Schedule

本阶段完成：
- 新增 `scheduleDunningReminders()`，按支付失败发票的 `updatedAt` 计算后续提醒阶段。
- 默认 dunning 阶段为 T+2 `day2` 和 T+5 `day5`，每个阶段使用独立 dedupe key：`billing:dunning:{stage}:{providerInvoiceId}`。
- 只对仍处于 `payment_failed` 的发票入队；发票已变为 `paid`、`void`、`uncollectible` 或其他非失败状态时会被抑制。
- 无邮箱用户会跳过，不产生无效通知。
- 新增 `/api/admin/billing/dunning`，Admin 可手动触发一次 dunning reminder 调度，并返回 checked/queued/skipped 摘要。
- 前端 Admin API client 新增 `scheduleAdminBillingDunning()`，为后续 Admin UI 或定时 worker 复用。

验证：
- `npm test -- src/server/billing/dunning.test.ts src/app/api/admin/billing/dunning/route.test.ts src/lib/api/admin.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Scheduled Notification / Dunning Worker：部署环境中的定时任务，自动执行 dunning 调度和通知投递。
2. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、更完整的发票详情。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
6. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续商业化/通知主线，做 Scheduled Notification / Dunning Worker；如果要先稳定生产环境，做 Stripe Sandbox E2E Verification 和部署 runbook。

## Completed Phase: Scheduled Notification / Dunning Worker

本阶段完成：
- 新增 `runNotificationWorkerOnce()`，统一编排 billing dunning 调度和 pending notification 投递。
- 新增 `scripts/notification-worker.ts`，可作为长期 worker 循环运行，也可用 `NOTIFICATION_WORKER_RUN_ONCE=1` 单次运行。
- 新增 npm 命令：`npm run worker:notifications`。
- worker 支持环境变量：
  - `NOTIFICATION_WORKER_INTERVAL_MS`
  - `NOTIFICATION_WORKER_DUNNING_LIMIT`
  - `NOTIFICATION_WORKER_DELIVERY_LIMIT`
  - `NOTIFICATION_WORKER_MAX_ATTEMPTS`
  - `NOTIFICATION_WORKER_RUN_ONCE`
- README 增加 notification worker 运行说明。
- 本地已用 `NOTIFICATION_WORKER_RUN_ONCE=1 NOTIFICATION_PROVIDER=console npm run worker:notifications` 验证脚本可执行。

验证：
- `npm test -- src/server/notifications/worker.test.ts scripts/notification-worker.test.ts`
- `NOTIFICATION_WORKER_RUN_ONCE=1 NOTIFICATION_PROVIDER=console npm run worker:notifications`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、更完整的发票详情。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
6. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果要稳定生产商业化链路，做 Stripe Sandbox E2E Verification；如果继续产品完整度，做 Invoice / Payment History Polish。

## Completed Phase: Account Export / Deletion Audit Polish

本阶段完成：
- Account export 新增 `metadata`，包含 `formatVersion`、`product`、`generatedAt`、`subjectUserId`、`subjectEmail`、retention notice 和导出 section 清单。
- `softDeleteAccount()` 在匿名化邮箱、清 session、移除 workspace access 后写入 `admin_user_audit_logs`。
- Admin user audit 现在支持 `actorKind=self-service` 和 `action=user_self_deleted`。
- 删除审计记录会保留邮箱匿名化变化、禁用状态变化、workspace access removal，方便 admin 追踪普通账户自助删除事件。

验证：
- `npm test -- src/server/account/lifecycle.test.ts src/server/admin/users-repository.test.ts src/app/api/account/export/route.test.ts src/app/api/account/route.test.ts src/app/api/admin/users/audit-logs/route.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、更完整的发票详情。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
6. Entitlement Coverage Expansion：未来新增高级功能 API 时继续加入 coverage 审计。

建议下一步：
- 如果继续权限/账户主线，做 Entitlement Coverage Expansion；如果要稳定商业化链路，做 Stripe Sandbox E2E Verification 和 Production Worker Deployment Runbook。

## Completed Phase: Entitlement Coverage Manifest

本阶段完成：
- 新增 `feature-gate-routes.ts`，把当前高级功能 API 的权限覆盖集中登记为 `FEATURE_API_COVERAGE`。
- 明确登记当时尚未实现 API 的付费功能：`quote_workflow`、`knowledge_station`；后续 Knowledge Station Lite 已接入受保护 API，当前仅 `quote_workflow` 保持未实现登记。
- `feature-gate-coverage.test.ts` 从手写路径升级为 manifest-backed coverage audit。
- 覆盖测试现在会检查：
  - 每个登记路由都包含 `requireFeature()`、对应 feature key、`FeatureAccessError`。
  - 所有导入 `@/server/auth/feature-gate` 的 API route 都必须登记在 manifest。
  - 每个付费功能必须处于“已有受保护 API”或“明确未实现 API”两种状态之一。
  - 明确未实现的付费功能不能悄悄暴露 API route。

验证：
- `npm test -- src/server/auth/feature-gate-coverage.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Invoice / Payment History Polish：PDF 下载体验、筛选、更完整的发票详情。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续产品/账户完整度，做 Invoice / Payment History Polish；如果稳定商业化链路，做 Stripe Sandbox E2E Verification 和 Production Worker Deployment Runbook。

## Completed Phase: Invoice / Payment History Polish

本阶段完成：
- `listAccountInvoices()` 支持按 invoice status 过滤，并返回 summary totals。
- `/api/account/billing/invoices?status=...` 支持 `open`、`paid`、`payment_failed`、`void`、`uncollectible`，非法状态返回 `INVALID_REQUEST`。
- 前端 API client `fetchBillingInvoices()` 支持 status query。
- Settings Billing 的 Invoice History 增加状态筛选、发票数量、已支付总额、待支付总额。
- 每张发票现在区分 `View PDF`、`View invoice`、`Retry payment` 三类动作。
- 补齐中英文发票筛选、汇总、PDF、支付/到期日期文案。

验证：
- `npm test -- src/server/billing/subscriptions.test.ts src/app/api/account/billing/invoices/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`
- `npm run lint`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Usage Dashboard Expansion：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续账户/权限体验，做 Usage Dashboard Expansion；如果稳定商业化链路，做 Stripe Sandbox E2E Verification 和 Production Worker Deployment Runbook。

## Completed Phase: Usage Dashboard Expansion

本阶段完成：
- `usage-limits` 从 saved bids / intent workspace 扩展到 `search_alerts` 和 `team_members`。
- `/api/account/usage` 现在返回四类 workspace 用量：已保存招标、投标意向工作区、搜索提醒、团队成员。
- Settings Usage Dashboard 增加 limited-resource summary，并补齐中英文功能文案。
- `/api/search-alerts` 创建前会检查搜索提醒额度，超过套餐限制时返回 `USAGE_LIMIT_REACHED` / HTTP 402，并携带 used、limit、requiredTier。
- 前端搜索提醒 API 错误类型支持 `USAGE_LIMIT_REACHED`。

验证：
- `npm test -- src/server/auth/usage-limits.test.ts src/server/account/usage.test.ts src/app/api/account/usage/route.test.ts src/app/api/search-alerts/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Team Seat Enforcement：邀请成员和接受邀请时强制检查 `team_members` 套餐席位。
2. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
3. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 继续账户/权限主线时，优先做 Team Seat Enforcement；如果要先稳定商业化链路，做 Stripe Sandbox E2E Verification 和 Production Worker Deployment Runbook。

## Completed Phase: Team Seat Enforcement

本阶段完成：
- `team_members` 额度开始在团队邀请和邀请接受流程中强制生效。
- Pending invitation 会占用团队席位，避免用户一次性发出超过套餐额度的多个邀请。
- 接受邀请时会再次检查席位，防止套餐降级或并发导致超额激活。
- 当前本地模型使用 workspace active owner 中的最高套餐作为团队席位来源，适合当前单 owner/team MVP。
- `/api/account/workspace/members` 和 `/api/account/workspace/invitations/accept` 超额时返回 `USAGE_LIMIT_REACHED` / HTTP 402，并携带 used、limit、requiredTier。
- Settings 邀请成员和 `/accept-invite` 接受邀请页面会显示中英文席位上限提示。

验证：
- `npm test -- src/server/account/workspace.test.ts src/app/api/account/workspace/members/route.test.ts src/app/api/account/workspace/invitations/accept/route.test.ts src/lib/api/auth.test.ts src/app/settings/page.test.ts src/app/accept-invite/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Organization-Level Billing Ownership：把团队席位/套餐归属从 owner 用户套餐升级为 organization 级订阅模型。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续生产商业化链路，优先做 Stripe Sandbox E2E Verification；如果继续产品体验，做 Full Search Alerts UI；如果继续账户模型深挖，做 Organization-Level Billing Ownership。

## Completed Phase: Organization-Level Billing Ownership

本阶段完成：
- `organizations` 新增 `account_tier`，迁移会给旧 organization 回填 active owner 中最高套餐，默认 Free。
- 新注册用户创建默认 workspace 时，会把用户当前套餐写入 organization tier。
- Session entitlements、workspace usage dashboard、团队席位限制现在优先使用 organization tier。
- Billing subscription lifecycle / checkout / webhook 同步用户套餐时，会同步该用户 active owner workspace 的 organization tier。
- Admin 调整用户套餐时，也会同步该用户 active owner workspace 的 organization tier。
- Business workspace 中的 Free 成员会继承 organization tier 的功能权限，用于团队账号场景。

验证：
- `npm test -- src/server/db/schema.test.ts src/server/account/workspace.test.ts src/server/billing/subscriptions.test.ts src/server/admin/users-repository.test.ts src/server/account/usage.test.ts src/server/auth/service.test.ts`
- `npm test`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Granular Operator Roles：support/operator 等低权限后台角色。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续权限/账户模型，做 Granular Operator Roles；如果要稳定商业化生产链路，做 Stripe Sandbox E2E Verification；如果继续产品体验，做 Full Search Alerts UI。

## Completed Phase: Granular Operator Roles

本阶段完成：
- `USER_ROLES` 扩展为 `user`、`admin`、`operator`、`support`，并把 `admin_console` 权限开放给三类后台角色。
- 新增 `requireAdminAccess()`，支持按接口限制后台角色；`requireAdmin()` 继续只允许完整 admin。
- 账号管理、用户审计、订阅核对继续保持 admin-only。
- 数据源/日志/通知列表允许 admin/operator/support 查看；数据源开关、爬虫运行、通知投递、dunning 操作允许 admin/operator。
- `/admin` 页面按角色展示控件：admin 可管理用户和订阅，operator 可做运营动作，support 只看运营状态。
- 侧边栏 Admin 入口支持 admin/operator/support，普通用户仍隐藏。
- 补齐 operator/support 中英文角色文案。

验证：
- `npm test -- src/server/auth/entitlements.test.ts src/server/admin/auth.test.ts src/app/api/admin/notifications/route.test.ts src/app/api/admin/notifications/deliver/route.test.ts src/app/api/admin/billing/dunning/route.test.ts src/app/layout.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Advanced Feature Flags：按账号/组织覆盖套餐默认功能，用于 beta 或企业定制权限。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续生产商业化链路，做 Stripe Sandbox E2E Verification；如果继续产品体验，做 Full Search Alerts UI；如果继续权限/账户模型，做 Advanced Feature Flags。

## Completed Phase: Advanced Feature Flags

本阶段完成：
- 新增 `organization_feature_overrides`，支持组织级功能覆盖。
- Session entitlements 会把套餐默认功能和组织 override 合并后返回；`requireFeature()` 因此自动使用合并后的权限。
- Full admin 可通过 `/api/admin/users/[id]/feature-overrides` 查看和更新用户所在组织的功能覆盖。
- `/admin` 用户管理区新增“功能覆盖”管理入口，可对 Submission Guidance、Compliance Manifest、Pursue / No-Bid、Quote Workflow、Knowledge Station 执行强制开启、强制关闭或清除回套餐默认。
- `admin_console` 不允许通过 feature override 开关，后台角色仍由 role 控制。
- 功能覆盖变更会写入用户权限审计日志。
- 补齐中英文后台文案和前端 API client。

验证：
- `npm test -- src/server/db/schema.test.ts src/server/auth/service.test.ts src/server/auth/entitlements.test.ts src/server/admin/users-repository.test.ts src/app/api/admin/users/[id]/feature-overrides/route.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Custom Enterprise Permission Rules：按真实企业客户需求扩展组织/账号级权限规则。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续权限/账户模型，等出现明确企业用例后做 Custom Enterprise Permission Rules；如果继续生产商业化链路，做 Stripe Sandbox E2E Verification；如果继续产品体验，做 Full Search Alerts UI。

## Completed Phase: Override Expiry / Audit Polish

本阶段完成：
- `organization_feature_overrides` 增加 `reason` 和 `expires_at`，迁移兼容已有本地数据库。
- Session entitlement 合并组织覆盖时会忽略已过期覆盖，避免临时 beta/企业授权过期后继续生效。
- `/api/admin/users/[id]/feature-overrides` GET/PATCH 支持读取和保存原因、过期时间、过期状态。
- `/admin` 功能覆盖管理区新增原因输入、过期日期输入和“已过期”状态标识。
- 功能覆盖审计日志从简单布尔值升级为结构化状态，记录开启/关闭、原因和过期时间。

验证：
- `npm test -- src/app/admin/page.test.ts src/server/db/schema.test.ts src/server/auth/service.test.ts src/server/admin/users-repository.test.ts 'src/app/api/admin/users/[id]/feature-overrides/route.test.ts' src/lib/api/admin.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Stripe Sandbox E2E Verification：使用真实 test mode keys、price ids、Stripe CLI/webhook endpoint 跑完整 checkout -> webhook -> tier 更新流程。
2. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Custom Enterprise Permission Rules：按真实企业客户需求扩展组织/账号级权限规则。
5. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。

建议下一步：
- 如果继续生产商业化链路，优先做 Stripe Sandbox E2E Verification；如果继续产品体验，做 Full Search Alerts UI；如果继续权限/账户模型，等出现明确企业用例后做 Custom Enterprise Permission Rules。

## Completed Phase: Admin Permission Audit Filters

本阶段完成：
- `listAdminUserAuditLogs()` 支持按 `actorKind`、`action`、目标用户邮箱/姓名/ID、`featureKey` 过滤权限审计日志。
- `/api/admin/users/audit-logs` 支持对应 query 参数，并会拒绝无效 actor/action/feature。
- 前端 admin API client 支持审计筛选参数拼接。
- `/admin` 用户权限审计区新增目标搜索、操作者、动作、功能筛选和清除按钮。
- 用户角色/套餐/启用状态、邀请、功能覆盖更新后，会按当前审计筛选条件刷新审计日志。

验证：
- `npm test -- src/server/admin/users-repository.test.ts src/app/api/admin/users/audit-logs/route.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控和失败告警说明。
2. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
3. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
4. Custom Enterprise Permission Rules：等有明确企业客户场景后，再扩展组织/账号级规则模型。

建议下一步：
- 账号权限主线已经比较完整；下一阶段建议转向 Production Worker Deployment Runbook 或 Full Search Alerts UI。

## Completed Phase: Stripe Sandbox E2E Verification

本阶段完成：
- 新增 `npm run billing:stripe:sandbox`，可在本地用 Stripe test mode keys 进行 operator-assisted E2E 验证。
- verifier 会校验 `BILLING_PROVIDER=stripe`、`STRIPE_SECRET_KEY=sk_test_...`、`STRIPE_WEBHOOK_SECRET=whsec_...`、Pro/Business price id，并且错误和摘要不会打印 secret 值。
- verifier 会自动创建唯一测试用户/session，通过本地 `/api/account/subscription/checkout` 发起 Stripe Checkout，输出 checkout URL，等待操作者完成测试卡支付。
- 支持轮询本地 `/api/account/subscription` 和 SQLite DB，确认 provider subscription 状态、用户 tier、organization tier 都同步到目标套餐。
- 支持调用 `/api/account/billing/portal` 验证 Stripe Customer Portal URL，并默认调用 `/api/account/subscription/cancel` 做 sandbox 清理；`--skip-cancel` 可保留测试订阅。
- 新增 Stripe sandbox runbook：Dashboard test mode 产品/价格配置、Stripe CLI webhook forward、`.env.local` 占位符、成功判定、排错和清理步骤。

验证：
- `npm test -- src/server/billing/stripe-sandbox-verifier.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run db:migrate`
- `npm audit --omit=dev --audit-level=high`
- `git diff --check`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Production Worker Deployment Runbook：部署平台的 cron/process 配置、监控、失败告警、Stripe live webhook endpoint 和 credential rotation 说明。
2. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
3. Advanced Usage Metrics：未来 quote workflow、AI 调用、Knowledge Station 落地后继续扩展用量项。
4. Custom Enterprise Permission Rules：等有明确企业客户场景后，再扩展组织/账号级规则模型。

建议下一步：
- 如果继续生产商业化链路，优先做 Production Worker Deployment Runbook；如果继续产品体验，做 Full Search Alerts UI；如果继续权限/账户模型，等出现明确企业用例后再做 Custom Enterprise Permission Rules。

## Completed Phase: 50-State Crawler Registry + Local Attachment Serving

本阶段完成：
- `winbids-current-gap-analysis.md` 已按当前实现重新拆分：Submission Guidance / Compliance Manifest / Pursue-NoBid 已从 gap 中移出，下一阶段重点转向 50 州 crawler 质量、Full Search Alerts UI、Sourcing/Quote、Response Workspace、Award/Knowledge。
- Python crawler `STATE_SOURCES` 覆盖美国 50 州；CA/TX/NY/FL/IL 保留专用 adapter，其余州使用通用 public procurement HTML/JSON fetcher 作为基础覆盖层。
- 前端 state runner、configured crawler runner、admin data source crawler-log mapping、state source mapping 全部扩展到 50 州。
- seed 数据现在会创建 50 个州级 `data_sources`，Admin source console 可以统一展示和按州运行。
- 新增 generic state crawler fixture/test，验证通用 HTML 表格可标准化为 bid 记录。
- 新增本地附件下载链路：本地 `file://`、绝对路径、相对路径附件会在 bid API 中改写为 `/api/bids/:id/attachments/:attachmentId`，下载 API 只服务受控附件目录内的本地文件，外部 URL 保持直链且不会被代理。

验证：
- `npm test -- src/server/bids/repository.test.ts src/server/bids/attachments.test.ts 'src/app/api/bids/[id]/attachments/[attachmentId]/route.test.ts'`
- `npm test -- src/lib/state-crawler-sources.test.ts src/server/crawler/state-runner.test.ts src/server/crawler/configured-runner.test.ts src/server/db/seed.test.ts src/app/api/crawler/state/run/route.test.ts src/server/admin/data-sources-repository.test.ts`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_generic_state.py crawler/tests/test_state_live_cli.py crawler/tests/test_state_live_sources.py`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 50-State Crawler Quality Batch 1：选择 5-8 个通用州替换成专用 adapter，补分页、查询、详情页和附件元数据。
2. Attachment Download Archival：crawler 侧下载附件到 `frontend/data/attachments` 或配置目录，记录 checksum/size/content type/original URL。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
5. Response Workspace Lite：tasks、artifacts、internal checkpoints。
6. Award / Tabulation Tracking Lite。

建议下一步：
- 如果继续数据覆盖主线，优先做 50-State Crawler Quality Batch 1；如果继续用户工作流，做 Full Search Alerts UI；如果继续投标准备深度，做 Sourcing Partner + Quote Inquiry Lite。

## Completed Phase: 50-State Crawler Quality Batch 1

本阶段完成：
- 新增 PA / SC / OR 三个州级 beta 专用 crawler adapter，替代原来的 generic fetcher 入口。
- 三个 adapter 均支持 `fixture_html` / `fixture_json`，可解析 source bid id、标题、机构、发布日期、截止日期、详情 URL 和附件链接元数据。
- `STATE_SOURCES` 已把 `pa_state_procurement`、`sc_state_procurement`、`or_state_procurement` 接入专用 fetcher；CA/TX/NY/FL/IL 继续保留已有专用 adapter。
- 前端 `STATE_CRAWLER_SOURCES` 增加 crawler 能力元数据：adapter kind、maturity、capabilities 和 base URL。
- Admin Data Sources API 增加 `crawlerSourceId`、`crawlerAdapterKind`、`crawlerMaturity`、`crawlerCapabilities`、`crawlerBaseUrl`。
- Admin 数据源表新增 Crawler 可见性，能区分 dedicated / generic、verified / beta / generic，以及 query、attachments、detail、pagination 等能力标签。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_state_live_cli.py crawler/tests/test_state_dedicated_spiders.py`
- `npm test -- src/lib/state-crawler-sources.test.ts src/server/admin/data-sources-repository.test.ts src/app/api/admin/data-sources src/app/admin/page.test.ts`
- `npx eslint src/lib/state-crawler-sources.ts src/lib/state-crawler-sources.test.ts src/server/admin/data-sources-repository.ts src/server/admin/data-sources-repository.test.ts src/app/api/admin/data-sources/route.test.ts src/app/admin/page.tsx src/app/admin/page.test.ts src/lib/i18n/dictionaries/en.ts src/lib/i18n/dictionaries/zh.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 50-State Crawler Quality Batch 2：继续选择 5-8 个州做专用 adapter，并补分页、详情页深抓、附件链接覆盖。
2. Dedicated Adapter Live Validation：对 beta adapter 做真实州站点连通、字段稳定性、失败回退和限流验证。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续数据覆盖主线时，优先做 50-State Crawler Quality Batch 2；如果想让现有 crawler 产出的附件真正可归档下载，优先做 Attachment Download Archival；如果转用户工作流，做 Full Search Alerts UI。

## Completed Phase: 50-State Crawler Quality Batch 2

本阶段完成：
- 新增 MA / NJ / OH / VA / WA 五个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- 五个 adapter 均支持 `fixture_html` / `fixture_json`，可解析 source bid id、标题、机构、发布日期、截止日期、分类、详情 URL 和附件链接元数据。
- `STATE_SOURCES` 已把 `ma_state_procurement`、`nj_state_procurement`、`oh_state_procurement`、`va_state_procurement`、`wa_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 MA/NJ/OH/VA/WA 为 `dedicated` + `beta`，并在 Admin Data Sources 中显示 query/attachments 能力。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA 为 beta dedicated；其余州保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_state_dedicated_spiders_batch2_east.py crawler/tests/test_state_dedicated_spiders_batch2_west.py`
- `npm test -- src/lib/state-crawler-sources.test.ts src/server/admin/data-sources-repository.test.ts src/app/api/admin/data-sources src/app/admin/page.test.ts`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 50-State Crawler Quality Batch 3：继续选择 5-8 个州做专用 adapter，并补分页、详情页深抓、附件链接覆盖。
2. Dedicated Adapter Live Validation：对 beta adapter 做真实州站点连通、字段稳定性、失败回退和限流验证。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续数据覆盖主线时，优先做 50-State Crawler Quality Batch 3；如果想把已抓到的附件链接变成可审计本地资产，优先做 Attachment Download Archival；如果转用户工作流，做 Full Search Alerts UI。

## Completed Phase: Crawler Non-Empty Guardrails

本阶段完成：
- `fetch-state`、`fetch-sam-gov`、`import-fixture` 在 fetcher/loader 返回空列表时不再写 `success`，而是写入 `failure` crawler log。
- 新增 `EmptyCrawlerResultError`，错误信息明确指出哪个 source 返回了 0 条 opportunity。
- State bid normalizer 新增 `StateBidNormalizationError`，缺少 source id 或 title 的州级记录会被拒绝，避免空内容被伪装成有效 bid。
- 对 description、full description、source URL、issuer name 增加非空回退：description/full description 回退到 title，source URL 回退到 source base URL，issuer name 回退到 `Unknown state agency`。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_cli.py crawler/tests/test_state_live_cli.py crawler/tests/test_state_normalizers.py crawler/tests/test_state_dedicated_spiders.py crawler/tests/test_state_dedicated_spiders_batch2_east.py crawler/tests/test_state_dedicated_spiders_batch2_west.py crawler/tests/test_generic_state.py`
- `git diff --check`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. 50-State Crawler Quality Batch 3：继续选择 5-8 个州做专用 adapter，并补分页、详情页深抓、附件链接覆盖。
2. Dedicated Adapter Live Validation：对 beta adapter 做真实州站点连通、字段稳定性、失败回退和限流验证。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Dedicated Adapter Live Validation，因为现在空结果会失败，下一步应验证 beta adapter 在真实站点下不会稳定产空；如果先补功能覆盖，则继续 50-State Crawler Quality Batch 3。

## Completed Phase: Dedicated Adapter Live Validation

本阶段完成：
- 新增 `validate-state-live` crawler CLI，用于对 beta dedicated state adapters 做真实站点非空验证，不写数据库，只验证 fetcher 是否返回有效 `source_bid_id`、`title`、`source_url`。
- PA adapter 支持当前 eMarketplace 嵌套结果表和真实页面空行过滤。
- MA/NJ/OR adapter 支持当前 RIO 平台 `advancedSearchBid.xhtml?openBids=true` 表格。
- WA adapter 支持当前 DES BidCalendar 页面的小表结构。
- VA adapter 从静态表格解析切换到公开 eVA Solr JSON 入口，解决 React 页面本身无 HTML 表格的问题。
- 通用 HTML parser 现在能发现嵌套表，同时保持外层表优先，避免同表头嵌套表抢先匹配。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_html_public_page.py crawler/tests/test_state_dedicated_spiders.py crawler/tests/test_state_dedicated_spiders_batch2_east.py crawler/tests/test_state_dedicated_spiders_batch2_west.py crawler/tests/test_state_live_validation.py crawler/tests/test_state_live_cli.py`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source pa_state_procurement --source ma_state_procurement --source nj_state_procurement --source or_state_procurement --source wa_state_procurement --limit 3 --timeout 15`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source va_state_procurement --limit 3 --timeout 20`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --limit 3 --timeout 20` 当前退出非零，但确认 PA/OR/MA/NJ/VA/WA 可返回非空；SC 仍在当前环境超时，OH 旧入口 404 且 OhioBuys 当前公开站点进入 browser_check/reCAPTCHA。

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 需要 browser/session/reCAPTCHA 策略或替代公开数据源。
2. 50-State Crawler Quality Batch 3：继续选择 5-8 个州做专用 adapter，并补分页、详情页深抓、附件链接覆盖。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先处理 SC/OH 的访问机制；并行可启动 50-State Crawler Quality Batch 3，避免被两个站点阻塞整体覆盖。

## Completed Phase: 50-State Crawler Quality Batch 3

本阶段完成：
- 新增 IA / GA / ME / MO / NV 五个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- IA 使用 Iowa Bid Opportunities JSON API；GA 使用 Georgia Procurement Registry DataTables JSON；ME/MO/NV 使用公开 HTML 表格解析。
- 五个 adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、机构、发布日期/截止日期、详情 URL；ME/MO 同步附件链接元数据。
- `STATE_SOURCES` 已把 `ia_state_procurement`、`ga_state_procurement`、`me_state_procurement`、`mo_state_procurement`、`nv_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 IA/GA/ME/MO/NV 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV 为 beta dedicated；其余州保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch3.py`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py crawler/tests/test_state_dedicated_spiders_batch3.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source ia_state_procurement --source ga_state_procurement --source me_state_procurement --source mo_state_procurement --source nv_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: IA/GA/ME/MO/NV each inserted 2 bids and wrote success crawler logs.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
2. 50-State Crawler Quality Batch 4：继续选择 5-8 个 generic 州做专用 adapter，优先能稳定返回非空的 JSON/HTML 公共源。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Batch 4 候选州筛选和 adapter 实现；同时把 SC/OH 保持为“受官方访问机制阻塞”的已知风险，不把它们伪装成稳定非空源。

## Completed Phase: 50-State Crawler Quality Batch 4

本阶段完成：
- 新增 UT / KS / MT / NM / CO / IN / MS / CT 八个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- UT 使用 Bonfire open opportunities JSON；MS 使用官方 DataTables JSON；CT 使用 CTsource/WebProcure JSON；KS 使用 Kansas eSupplier PeopleSoft 表格；MT 使用 Montana eMACS/Jaggaer 表格；NM 使用 SPD/Telerik 表格；CO 使用 BidNet open-bids HTML；IN 使用 IDOA current business opportunities 表格。
- 八个 adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、机构、发布日期/截止日期、详情 URL；IN/MS 同步附件链接元数据，CO/CT/MT/UT 同步详情页 URL。
- `STATE_SOURCES` 已把 `ut_state_procurement`、`ks_state_procurement`、`mt_state_procurement`、`nm_state_procurement`、`co_state_procurement`、`in_state_procurement`、`ms_state_procurement`、`ct_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 UT/KS/MT/NM/CO/IN/MS/CT 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT 为 beta dedicated；其余州保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch4.py`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py crawler/tests/test_state_dedicated_spiders_batch4.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source ut_state_procurement --source ks_state_procurement --source mt_state_procurement --source nm_state_procurement --source co_state_procurement --source in_state_procurement --source ms_state_procurement --source ct_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: UT/KS/MT/NM/CO/MS/CT each inserted 2 bids and wrote success crawler logs; IN currently has 1 public row and inserted 1 bid with a success crawler log.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
2. 50-State Crawler Quality Batch 5：继续选择 5-8 个 generic 州做专用 adapter，优先能稳定返回非空的 JSON/HTML 公共源。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Batch 5；候选方向可优先从 OK/WV/ND/NE/SD/VT/WY/ID 中筛选能稳定非空的公开源。若切到产品功能主线，则优先做 Full Search Alerts UI。

## Completed Phase: 50-State Crawler Quality Batch 5

本阶段完成：
- 新增 OK / AR / SD / WV / WY 五个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- OK 使用 Oklahoma PeopleSoft Supplier Portal 表格；AR 使用 Arkansas Current Solicitations HTML 表格；SD 使用官方 ESM Posting Board JSON；WV 使用 BidNet West Virginia open-bids HTML；WY 使用 A&I 公开 Google Sheet CSV bid status 清单。
- 五个 adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、机构、发布日期/截止日期、详情 URL或源 URL；AR 同步 buyer email，WV/SD 同步详情页 URL。
- `STATE_SOURCES` 已把 `ok_state_procurement`、`ar_state_procurement`、`sd_state_procurement`、`wv_state_procurement`、`wy_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 OK/AR/SD/WV/WY 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY 为 beta dedicated；其余州保持 generic foundation coverage。
- MN/NE/VT 在筛选中发现当前环境存在 Radware captcha 或网络 timeout，本批未纳入稳定源；ND 明确有 captcha，WV 官方 VSS timeout，因此 WV 本批采用公开 BidNet 列表作为 beta 覆盖。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch5.py`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch5.py crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source ok_state_procurement --source ar_state_procurement --source sd_state_procurement --source wv_state_procurement --source wy_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: OK/AR/SD/WV/WY each inserted 2 bids and wrote success crawler logs.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
2. 50-State Crawler Quality Batch 6：继续选择 5-8 个 generic 州做专用 adapter，优先能稳定返回非空的 JSON/HTML 公共源。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Batch 6；候选方向可从 AL/AK/ID/MI/MN/NE/NH/VT 等剩余 generic 州里筛选，但需要避开当前已确认的 captcha/timeout 源。若切到产品功能主线，则优先做 Full Search Alerts UI。

## Completed Phase: 50-State Crawler Quality Batch 6

本阶段完成：
- 新增 AL / AK / HI / KY / MN / WI / NH 七个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- HI 使用官方 HANDS JSON API，按 POST search endpoint 抓取 POSTED bidding opportunities，并解析 `solicitionNo`、标题、部门、发布日期、截止日期、分类和官方详情 URL。
- AL / AK / KY / MN / WI / NH 使用公开 BidNet state open-bids 页面作为 beta 覆盖入口；这些州的官方站点在当前本地环境中存在 timeout、403、Cloudflare、browser/session 或证书问题，因此先采用稳定非空公开数据源，后续可再升级到官方源。
- 六个 BidNet adapter 和 HI HANDS adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、机构、发布日期/截止日期和详情 URL。
- `STATE_SOURCES` 已把 `al_state_procurement`、`ak_state_procurement`、`hi_state_procurement`、`ky_state_procurement`、`mn_state_procurement`、`wi_state_procurement`、`nh_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 AL/AK/HI/KY/MN/WI/NH 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY/AL/AK/HI/KY/MN/WI/NH 为 beta dedicated；其余州保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_hi_hands_spider.py crawler/tests/test_state_dedicated_spiders_batch6.py crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source al_state_procurement --source ak_state_procurement --source hi_state_procurement --source ky_state_procurement --source mn_state_procurement --source wi_state_procurement --source nh_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: AL/AK/HI/KY/MN/WI/NH each inserted 2 bids and wrote success crawler logs.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
2. 50-State Crawler Quality Batch 7：继续从 AZ/DE/ID/LA/MD/MI/NE/NC/ND/RI/TN/VT 等剩余 generic 州中筛选稳定非空的公开 JSON/HTML/API 源。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Batch 7，并把官方源可用性高于 BidNet 聚合源；如果想补数据完整度，做 Attachment Download Archival；如果转用户工作流，做 Full Search Alerts UI。

## Completed Phase: 50-State Crawler Quality Batch 7

本阶段完成：
- 新增 DE / RI / TN 三个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- DE 使用 Delaware contracts jqGrid JSON；该站点需要先访问 `/Bids` 获取站点 cookie，并使用浏览器 UA + JSON POST 请求 `GetBids?status=Open`。
- RI 使用 Ocean State Procures 背后的 Proactis JSON 搜索接口，复用与 CTsource 类似的公开 search pattern。
- TN 使用 Edison PeopleSoft public bid grid HTML，解析 Event Name、Business Unit、Event ID、Start Date、End Date 等字段。
- 三个 adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、机构、发布日期/截止日期、分类和详情/源 URL。
- `STATE_SOURCES` 已把 `de_state_procurement`、`ri_state_procurement`、`tn_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 DE/RI/TN 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY/AL/AK/HI/KY/MN/WI/NH/DE/RI/TN 为 beta dedicated；其余州保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch7.py crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source de_state_procurement --source ri_state_procurement --source tn_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: DE/RI/TN each inserted 2 bids and wrote success crawler logs.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
2. 50-State Crawler Quality Batch 8：继续从 AZ/ID/LA/MD/MI/NE/NC/ND/VT 等剩余 generic 州中筛选稳定非空的公开 JSON/HTML/API 源。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 继续 crawler 质量主线时，优先做 Batch 8；但如果剩余州继续遇到 CAPTCHA/timeout，可以切到 Attachment Download Archival 提升已覆盖州的数据完整度，或转做 Full Search Alerts UI 补用户工作流。

## Completed Phase: 50-State Crawler Quality Batch 8

本阶段完成：
- 新增 AZ / ID / LA / MD / NE / NC / ND / VT 八个州级 beta 专用 crawler adapter，替代对应州的 generic fetcher 入口。
- 八个州均使用公开 BidNet state open-bids 页面作为 beta 覆盖入口；本阶段只纳入当前本地 `requests` 可稳定返回非空表格的州。
- MI 的 BidNet 页面当前返回 404，本阶段未纳入，避免把空数据伪装成可用 crawler。
- 八个 adapter 均支持 fixture-backed 测试，并解析 source bid id、标题、发布日期/截止日期和详情 URL。
- `STATE_SOURCES` 已把 `az_state_procurement`、`id_state_procurement`、`la_state_procurement`、`md_state_procurement`、`ne_state_procurement`、`nc_state_procurement`、`nd_state_procurement`、`vt_state_procurement` 接入专用 fetcher。
- 前端 crawler metadata 已同步标记 AZ/ID/LA/MD/NE/NC/ND/VT 为 `dedicated` + `beta`，Admin 可继续通过现有 state runner 单独运行这些州。
- 当前专用州覆盖：CA/TX/NY/FL/IL 为 verified dedicated；PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY/AL/AK/HI/KY/MN/WI/NH/DE/RI/TN/AZ/ID/LA/MD/NE/NC/ND/VT 为 beta dedicated；MI 保持 generic foundation coverage。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch8.py crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source az_state_procurement --source id_state_procurement --source la_state_procurement --source md_state_procurement --source ne_state_procurement --source nc_state_procurement --source nd_state_procurement --source vt_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: AZ/ID/LA/MD/NE/NC/ND/VT each inserted 2 bids and wrote success crawler logs.

当时还剩：
1. MI dedicated source resolution：MI 仍是 generic foundation；需要找到稳定公开源，或标记为 browser/session/manual 处理。
2. SC/OH portal access resolution：SCBO 当前环境超时；OhioBuys 官方公开流程进入 browser_check/reCAPTCHA，不应绕过 CAPTCHA，需要 browser-assisted/manual 或官方 feed/API 策略。
3. Attachment Download Archival：crawler 侧真正下载附件，记录 checksum、size、content type、original URL。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

当时建议下一步：
- 如果继续 crawler 主线，优先做 MI/SC/OH final gap resolution；如果要提升已抓数据质量，做 Attachment Download Archival；如果转用户工作流，做 Full Search Alerts UI。

## Completed Phase: 50-State Crawler Final Gap Resolution

本阶段完成：
- MI / SC / OH 均已接入可返回非空结果的 beta dedicated live fetcher，50 个州现在都有 verified 或 beta dedicated adapter 可由 state runner 调度。
- MI 默认 BidNet Michigan 页面返回 404，稳定公开入口改为 MITN open-bids 页面；SC 官方站点从本地环境超时，OH 官方旧入口 404 且 OhioBuys 公开流程进入 browser-check，因此 SC/OH 当前使用公共 BidNet open-bids fallback。
- 新增 MI/SC/OH fixture-backed parser 测试，覆盖 source bid id、标题、发布日期/截止日期、详情 URL、州缩写和 dedupe key。
- BidNet HTML 清洗现在会反转义实体，避免标题中保留 `&amp;` 这类页面编码内容。
- `STATE_SOURCES`、live validation beta source list、前端 crawler metadata、admin state runner 能力展示均已同步 MI/SC/OH。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_final_gap.py crawler/tests/test_state_sources.py crawler/tests/test_state_live_validation.py crawler/tests/test_state_live_cli.py::test_fetch_state_replays_state_fixture_html_for_live_fetcher crawler/tests/test_state_dedicated_spiders.py::test_selected_state_sources_are_registered_to_dedicated_fetchers`
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --source mi_state_procurement --source sc_state_procurement --source oh_state_procurement --limit 3 --timeout 30`
- Migrated temp SQLite fetch-state smoke: MI/SC/OH each inserted 2 bids and wrote success crawler logs.

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Attachment Download Archival：crawler 侧真正下载附件和详情页文档，记录 checksum、size、content type、original URL、local path、download status。
2. Official-source maturity：如果后续拿到稳定官方 feed/API，再把 MI/SC/OH 的公共 fallback 升级为官方源；不绕过 CAPTCHA 或访问控制。
3. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
4. Production Worker Deployment Runbook：生产 credential 隔离、worker 定时部署、webhook endpoint 轮换和运维说明。
5. Sourcing Partner + Quote Inquiry Lite：partner DB、quote request、quote comparison。
6. Response Workspace Lite：tasks、artifacts、internal checkpoints。
7. Award / Tabulation Tracking Lite。

建议下一步：
- 如果继续数据质量主线，优先做 Attachment Download Archival；如果转用户工作流，做 Full Search Alerts UI；如果准备上线，做 Production Worker Deployment Runbook。

## Completed Phase: Data Pipeline Hardening Metadata Foundation

本阶段完成：
- `bids` 增加 source confidence、quality flags、admin review status、detail archive status/path/checksum/fetched_at 字段，为后续 QA 和证据链做基础承载。
- `bid_attachments` 增加 original URL、local storage path、byte size、content type、checksum、fetched_at、archive status 字段；前端下载逻辑现在会优先使用 `storage_path`，解决“文件已落地但页面/API 404”的基础路径问题。
- `data_sources` 增加 source registry 和 connector capability 元数据字段，包括 provider/access/type/confidence/status、browser/manual/login 要求、query/pagination/attachment/detail 能力和 fallback notes。
- Admin Data Sources API 保留原 crawler metadata，同时派生/暴露 source registry 与 capability 布尔字段；Admin 页面展示 confidence、access mode、activation、archive metadata 能力和 browser/login/manual 标记。
- Python crawler storage 会在 upsert 时写入新增 bid/attachment metadata；state/SAM normalizer 会生成 `missing_title`、`missing_source_url`、`missing_deadline` 等质量标记，并继续保持空结果失败的 guardrail。

验证：
- `npm test -- src/server/db/schema.test.ts src/server/admin/data-sources-repository.test.ts src/server/bids/repository.test.ts`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_storage.py`
- `npm run lint`
- `npm run build`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Attachment Download Archival Downloader：真正下载附件/详情页到本地或对象存储，计算 checksum/size/content type，并把失败原因写入 archive status。
2. Bid Admin/Data QA Console Expansion：按 quality flags、archive status、source confidence、review status 做筛选、批量审核和修复入口。
3. Official-source maturity：后续拿到稳定官方 feed/API 后，把 MI/SC/OH 等公共 fallback 升级为官方源；不绕过 CAPTCHA 或访问控制。
4. Full Search Alerts UI：提醒列表、启停、编辑、按 alert 配置 digest 频率。
5. Production Worker Deployment Runbook：生产 credential 隔离、worker 定时部署、webhook endpoint 轮换和运维说明。
6. Response Workspace Lite / Artifact Vault Lite：tasks、artifacts、internal checkpoints、证据文件引用。
7. Sourcing Partner + Quote Inquiry Lite 与 Award / Tabulation Tracking Lite。

建议下一步：
- 继续数据质量主线时，优先做 Attachment Download Archival Downloader；如果希望 Admin 先可运营，做 Bid Admin/Data QA Console Expansion；如果转用户工作流，做 Full Search Alerts UI。

## Completed Phase: MySQL Crawler Import, Control, And Alert Matching Bridge

本阶段完成：
- 新增 crawler MySQL import bridge：MySQL 模式且未显式传入 SQLite 路径时，SAM.gov/state runner 会创建临时 SQLite、执行现有 Python crawler、再把非空结果导入 MySQL。
- 新增 `importCrawlerSqliteRunIntoMysql`，按 `dedupe_key` upsert bids，替换对应 attachment metadata，并把 crawler logs 导入 MySQL。
- 保留“成功 run 不能为空”的 guardrail：成功日志但没有 bid rows 会拒绝导入，防止空抓取被标记为成功。
- 新增 MySQL crawler lock acquire/release，orchestrator 在 MySQL 模式下会使用 MySQL `data_sources` 的启停状态和 MySQL `crawler_locks`，避免跨实例运行控制仍落在 SQLite。
- Admin Data Sources list/update 已支持 MySQL，前端后台禁用 source 后会影响 MySQL crawler 控制面。
- Crawler API route 和 crawler worker/run-once scripts 已把 MySQL control store 传给 orchestrator；MySQL 模式下成功抓取后会运行 MySQL search-alert matching，并通过 MySQL notification outbox/digest history 发送或记录提醒。
- `db:mysql:smoke` 已扩展 crawler import/upsert、crawler control、crawler alert matching fixture，验证 bid、attachment fallback、scraper health log、source enablement、lock lifecycle、alert lastMatchedAt/lastNotifiedAt、digest history 都能从 MySQL 读回。
- Bid 搜索过滤 now normalizes uppercase/lowercase state ids，避免 alert 中保存 `CA/TX` 大写州码时无法匹配 MySQL bid。

验证：
- `npm test -- src/server/crawler/lock-repository.test.ts src/server/crawler/orchestrator.test.ts src/server/crawler/configured-runner.test.ts src/server/admin/data-sources-repository.test.ts src/server/db/mysql-smoke.test.ts src/app/api/admin/data-sources/route.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/app/api/crawler/sam-gov/run/route.test.ts src/app/api/crawler/state/run/route.test.ts`
- `npm test -- src/server/bids/service.test.ts src/server/search-alerts/matcher.test.ts src/server/notifications/service.test.ts`
- `DATABASE_URL=mysql://... npm run db:mysql:smoke`

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. Operator-assisted Stripe sandbox run：脚本已支持 MySQL runtime，但需要真实 Stripe test keys 和 `whsec_...` 在 MySQL dev/staging DB 上跑一次完整 checkout/webhook/portal/cancel。
2. Production credential/webhook execution：真实生产凭证、webhook endpoint、secret rotation 和回滚流程仍需上线前执行。

建议下一步：
- 继续 MySQL cutover 时，优先准备真实 Stripe test env 并执行 MySQL sandbox verifier；然后做 production credential/webhook execution runbook。

## Completed Phase: Native Direct JSON/MySQL Crawler Ingestion

本阶段完成：
- Python crawler `fetch-sam-gov` / `fetch-state` 新增 `--output-json`，成功和失败都会输出结构化 run payload；`--output-json` 模式不再强制要求 `--database`。
- 前端 SAM.gov/state runner 在 MySQL URL 已配置且未显式传入 SQLite 路径时，改为运行 Python JSON 模式，不再创建临时 SQLite 中转库。
- 新增 `importCrawlerJsonRunIntoMysql`，直接按 `dedupe_key` upsert bids、替换 attachment metadata、写入 crawler log，并继续拒绝“success 但 bids 为空”的结果。
- 保留本地/测试显式 `databasePath` 的 SQLite 写入路径，避免破坏现有离线开发和 crawler fixture 测试。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_cli.py -q`
- `npm test -- src/server/crawler/mysql-json-importer.test.ts src/server/crawler/sam-gov-runner.test.ts src/server/crawler/state-runner.test.ts`

最新还剩（下一阶段优先级）：
1. 用真实 Stripe test credentials 在 MySQL dev/staging DB 上运行 operator-assisted sandbox verifier。
2. Final live billing execution：生产密钥 preflight 已脚本化，仍需上线环境执行低风险 live checkout/webhook/portal 验证。

## Completed Phase: Stripe Sandbox Verifier MySQL Compatibility

本阶段完成：
- Stripe sandbox verifier 改为通过本地 HTTP API 创建测试账号，而不是直接写 SQLite。
- subscription/tier 轮询改为同时读取 `/api/account/subscription` 和 `/api/auth/session`，验证用户 tier 与 workspace organization tier 都同步到目标套餐。
- verifier 可在 SQLite 默认模式或 MySQL `DATABASE_URL` 模式下使用同一条产品 API 路径。
- helper 增加 session cookie 提取和 user/workspace tier sync 判定，继续避免输出 secret values。
- Stripe sandbox runbook 新增 MySQL 模式启动、迁移和 verifier 执行说明。

验证：
- `npm test -- src/server/billing/stripe-sandbox-verifier.test.ts`

最新还剩（下一阶段优先级）：
1. 用真实 Stripe test credentials 跑一次 MySQL sandbox checkout/webhook/portal/cancel，全流程需要人工完成 Stripe Checkout。
2. Final live billing execution：生产密钥 preflight 已脚本化，仍需上线环境执行低风险 live checkout/webhook/portal 验证。

## Completed Phase: Production Worker Deployment Preflight

本阶段完成：
- `worker:crawler` 新增 `--check` 模式，校验 `CRAWLER_WORKER_INTERVAL_MS`、`STATE_CRAWLER_LIMIT`、`CRAWLER_OWNER`、生产环境数据库配置提示。
- `package.json` 新增 `worker:crawler:check` 和聚合 `workers:check`，一次性跑 crawler / event outbox / notification+dunning worker preflight。
- production billing/worker runbook 改为推荐部署前运行 `npm run workers:check`，crawler worker 启动前也单独执行 `worker:crawler:check`。

验证：
- `npm test -- scripts/notification-worker.test.ts`
- `npm run workers:check`

最新还剩（下一阶段优先级）：
1. 用真实 Stripe test credentials 跑一次 MySQL sandbox checkout/webhook/portal/cancel，全流程需要人工完成 Stripe Checkout。
2. Final live billing execution：生产密钥 preflight 已脚本化，仍需上线环境执行低风险 live checkout/webhook/portal 验证。

## Completed Phase: Production Billing Credential Preflight

本阶段完成：
- 新增 `billing:production:check`，在生产环境上线或 webhook rotation 前校验 `BILLING_PROVIDER=stripe`、`sk_live_...`、`whsec_...`、Pro/Business price ids 和 MySQL runtime URL。
- preflight 会拒绝 test-mode key、占位符、缺失 MySQL URL，不会打印 secret values。
- production billing/worker runbook 增加上线前 `NODE_ENV=production npm run billing:production:check` 步骤。

验证：
- `npm test -- src/server/billing/production-preflight.test.ts`

最新还剩（下一阶段优先级）：
1. 用真实 Stripe test credentials 跑一次 MySQL sandbox checkout/webhook/portal/cancel，全流程需要人工完成 Stripe Checkout。
2. Final live billing execution：在真实生产环境执行 `billing:production:check`、创建/轮换 webhook endpoint，并做低风险 live checkout/webhook/portal 验证。

## Completed Phase: 50-State Source Validity Hardening

本阶段完成：
- 50 州 frontend source registry 新增 source-validity metadata：`sourceAuthority`、`trustStatus`、`evidenceMode`、`validityNotes`。
- CA/TX/NY/FL/IL 等 verified source 继续标记为官方高可信来源；当前使用公共聚合 fallback 的州被明确标记为 `public_aggregator` + `fallback`，避免把 fallback 数据伪装成官方源。
- 新增 deterministic URL validator，拒绝空 URL、非法 URL、localhost/example/placeholder、以及 `sam.gov/opp/12345` 这类 demo/已知坏 URL。
- `risk:check` 新增 `source-validity-metadata` 与 `state-url-validity` 两项检查，能在本地阻断 placeholder source URL 和 unsafe external state attachment URL。
- Admin Data Sources repository 暴露 source-validity fields，SQLite 和 MySQL projection 都可读取。

验证：
- `npm test -- src/lib/state-crawler-sources.test.ts`
- `npm test -- src/server/source-validity/url-validity.test.ts`
- `npm test -- src/server/risk/checklist.test.ts`
- `npm test -- src/server/admin/data-sources-repository.test.ts`

最新还剩（下一阶段优先级）：
1. Operator-run live portal URL health reporting：对 50 州 source base URL 和样本 source/attachment URL 做可选 live 检测，但不要让默认 CI 依赖外部政府网站。
2. Python crawler source metadata parity：把 source-validity metadata 同步到 Python registry 或生成共享 registry，减少双端手动维护。
3. 继续做 Artifact Vault Lite，让附件/证据从“可下载/可标记”推进到供应商可管理的 evidence workflow。

## Completed Phase: 50-State Live Source Health Probe

本阶段完成：
- 新增 operator-run `source:health:check`，对 50 州 registry base URL 执行 live HTTP health probe。
- 支持 `--source CA`、`--source ca_caleprocure`、重复 `--source`、`--timeout-ms`、`--json`、`--report-only`。
- HEAD 被 403/405/501 拒绝时自动回退 GET；fetch 异常会记录为 structured unhealthy result，不会让报告生成中断。
- 命令保持在默认 `risk:check` 之外，避免外部政府网站 403/timeout 影响 deterministic CI。

验证：
- `npm test -- src/server/source-validity/live-source-health.test.ts`
- `npm run source:health:check -- --source CA --timeout-ms 5000 --report-only`

最新还剩（下一阶段优先级）：
1. Python crawler source metadata parity：把 source-validity metadata 同步到 Python registry 或生成共享 registry。
2. Admin UI source health surface：把最近一次 live health report 或 crawler source-health signal 展示到 Admin Data Sources，而不是只靠 CLI 输出。
3. Artifact Vault Lite：供应商证据/附件工作流仍是 Product 2/3 的最高价值业务功能。

## Completed Phase: Python Crawler Source Metadata Parity

本阶段完成：
- Python `Source` dataclass 新增 `source_authority`、`trust_status`、`evidence_mode`、`validity_notes`。
- 50 州 Python crawler registry 与前端 source-validity contract 对齐：verified 官方源、beta 官方源、public aggregator fallback 源都带同一套语义。
- `fetch-state --output-json` 的 run metadata 新增 `source_validity`，方便 MySQL direct JSON importer/crawler logs 保留源可信度。
- 既有静态/测试 Source 继续通过默认值兼容。

验证：
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_cli.py::test_fetch_state_output_json_writes_success_payload -q`

最新还剩（下一阶段优先级）：
1. Admin UI source health surface：把 source validity 与最近一次 live health/crawler health 信号展示到 Admin Data Sources 页面。
2. Persisted live health snapshots：把 `source:health:check` 输出保存到 DB 或 JSON artifact，便于运营对比趋势。
3. Artifact Vault Lite：供应商证据/附件工作流仍是最高价值业务功能。

## Completed Phase: Admin Source Validity Surface

本阶段完成：
- Admin Data Sources 表格新增 source validity 展示：source authority、trust status、evidence mode、validity notes。
- verified 官方源、beta 官方源、public aggregator fallback 源在后台页面可通过 badge 直接区分。
- 新增中英文文案，保持美国用户英文界面和中文运营界面都可读。
- 该阶段复用现有 Admin Data Sources API 字段，不新增 DB schema。

验证：
- `npm test -- src/app/admin/page.test.ts src/server/admin/data-sources-repository.test.ts src/app/api/admin/data-sources/route.test.ts`
- `npm run lint`
- `npm run build`
- `npm run risk:check`

最新还剩（下一阶段优先级）：
1. Artifact Vault Lite：供应商证据/附件工作流仍是最高价值业务功能。
2. Stripe sandbox/live billing signoff：需要真实 Stripe credentials 和人工 checkout 操作。
3. Longer-horizon source health charting：当前已展示最近一次 live probe，后续可做多次趋势图。

## Completed Phase: Persisted Live Source Health Snapshots

本阶段完成：
- 新增 `source_health_snapshots` 表，用于保存 operator-run live source health probe 的最近结果。
- `npm run source:health:check` 新增 `--persist` 参数；默认仍只输出报告，不让默认 CI 依赖外部政府站点。
- Admin Data Sources API 将最近一次 live probe 映射到对应 source，并暴露 `latestLiveHealth`。
- `/admin` Data Sources 表格展示最近 live source health、HTTP 状态、检查时间和错误摘要。
- README 补充 `--persist` 使用方式。

验证：
- `npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts src/server/admin/data-sources-repository.test.ts src/app/admin/page.test.ts`
- `npm run db:migrate`
- `npm run source:health:check -- --source CA --timeout-ms 5000 --report-only --persist`

最新还剩（下一阶段优先级）：
1. Artifact Vault Lite：供应商证据/附件工作流仍是最高价值业务功能。
2. Stripe sandbox/live billing signoff：需要真实 Stripe credentials 和人工 checkout 操作。
3. Longer-horizon source health charting：当前已展示最近一次 live probe，后续可做多次趋势图。

## Completed Phase: Admin Risk Snapshot Trend Summary

本阶段完成：
- `/api/admin/risk-check` 在生成风险巡检报告后写入最近快照，并返回 `history` 与 `trend`。
- 新增 `summarizeRiskChecklistTrend`，对最近快照汇总 global URL 是否持续通过、50 州覆盖是否下降、附件可下载数量是否变化。
- Admin 风险面板新增趋势摘要卡片、最近风险快照、手动刷新与 JSON 导出，并把风险详情链接回对应 `/bids/[id]`。
- 中英文文案已补齐，英文界面可给美国用户直接使用，中文界面方便运营检查。

验证：
- `npm test -- src/server/risk/snapshots.test.ts src/app/api/admin/risk-check/route.test.ts src/app/admin/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run risk:check`
- `git diff --check`

最新还剩（下一阶段优先级）：
1. Persisted live health snapshots：把 `source:health:check` 输出保存到 DB 或 JSON artifact，并在 Admin UI 展示最近一次 live probe。
2. Artifact Vault Lite：供应商证据/附件工作流仍是最高价值业务功能。
3. Stripe sandbox/live billing signoff：需要真实 Stripe credentials 和人工 checkout 操作。

## Completed Phase: Response Workspace Evidence Linking + Admin Live Health UI

本阶段完成：
- Response Workspace item 现在可以关联 Artifact Vault 中的 supplier artifacts，并在 GET response workspace 时返回每个 item 的 `linkedArtifacts`。
- 新增 `response_workspace_item_artifacts` 关联表；SQLite migration、Drizzle schema、MySQL DDL 转换、repository/service/API/client/UI 测试均覆盖。
- 更新 item 时支持 `linkedArtifactIds`，传空数组会清空旧关联；服务层校验 artifact 必须属于当前 user + intent，避免跨标/跨用户误挂证据。
- Intent detail 的 Response Workspace panel 增加 linked artifacts 展示、可选 artifact 清单和保存动作；下载 URL 使用本地 artifact API，避免外链 404。
- MySQL smoke verifier 现在会创建真实 Artifact Vault 文件，并验证 Response Workspace artifact-task link 可写入、可读取、可生成下载 URL。
- Admin Data Sources 页面现在直接展示 persisted live source health：状态 badge、checkedAt、HTTP/status code、latency、错误摘要和 no-check 空态。

验证：
- `npm test -- src/server/db/mysql-smoke.test.ts src/server/db/schema.test.ts src/server/response-workspace/repository.test.ts src/server/response-workspace/service.test.ts 'src/app/api/intents/[id]/response-workspace/route.test.ts' src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts' 'src/app/intents/[id]/page.test.tsx' src/app/admin/page.test.ts src/app/api/admin/data-sources/route.test.ts src/server/admin/data-sources-repository.test.ts`

最新还剩（下一阶段优先级）：
1. Response Workspace activity/version history：记录 item notes、status、assignee、linked artifacts 的变化历史，并在 Intent UI 中可读。
2. Editable Config Matrix governance：Admin 配置矩阵从只读升级为有审批/审计的编辑流。
3. Admin source approval workflow：把 source validity、live health、crawler logs 组合成可运营的 approve/hold/recheck 流程。
4. Settings reminder center + delivery preferences：把 Deadline Notifications 从 Intent 页面扩展到用户设置中心和真实通知渠道。
5. Production signoff：Stripe live/sandbox 人工验证、MySQL 真库 smoke、生产 worker runbook。

## Completed Phase: Response Package Export / Download Lite

本阶段完成：
- 新增 `response_package_snapshots` 表，用于冻结当前响应包目录和就绪度摘要。
- 新增 Response Package readiness summary：统计目录完成数、缺失材料、阻塞项、未完成项，并计算基础 ready 状态。
- 新增 SQLite/MySQL repository helper、service helper、Business-gated `/api/intents/[id]/response-workspace/package` GET/POST API 和前端 client helper。
- Intent Response Workspace panel 新增中英文响应包快照区，可创建快照、查看最近快照、查看目录/材料/阻塞/未完成摘要。
- 保存 Response Workspace item 或关联材料后会刷新 package readiness，避免页面展示旧状态。
- Feature gate coverage 已登记新 package route，防止后续新增 gated route 漏登记。
- 新增 `response_package_exports` 表，用于记录 snapshot 导出文件、checksum、大小、下载 URL 和 requested-by 用户。
- 新增 deterministic Markdown export 生成器，基于已保存 snapshot 输出 readiness 摘要、目录章节、备注和关联材料清单。
- 新增 Business-gated `/api/intents/[id]/response-workspace/package/exports` POST 和 `/exports/[exportId]` GET 下载路由。
- Intent UI 现在可从每个 snapshot 导出响应包，并显示最近导出的下载链接。

验证：
- `npm test`：194 files / 874 tests passed。
- `npm run lint`
- `npm run build`：通过；仍有 Turbopack NFT warning，本轮 trace 指向 `src/server/response-workspace/service.ts` 的本地文件写入路径。
- `npm run db:migrate`
- `npm run risk:check`：50/50 states、117 state bids、9 attachments、account-tier separation、source governance、URL validity 均 PASS；moderate audit 0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`

历史当时还剩（已被后续阶段部分完成，最新以当前文档末尾为准）：
1. Editable Config Matrix governance：已完成可编辑 JSON/status/reason/audit 保存闭环；effective-date、版本对比、回滚仍属未来深化。
2. Admin source approval workflow：把 source validity、live health、crawler logs 组合成 approve/hold/recheck 流程。
3. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
4. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Editable Config Matrix Governance

本阶段完成：
- Admin Config Matrix 从只读升级为可编辑：支持直接编辑每条 config 的 JSON value、状态，并要求填写 change reason 后才能保存。
- 新增前端 API client helper `updateAdminConfigEntry`，复用现有 PATCH `/api/admin/config/[id]` wire shape，不新增产品 API 形状。
- Admin 保存时会校验 JSON 可解析、reason 非空，成功后更新本地配置行并清空该条草稿；失败时在 Admin 页面展示错误提示。
- 后端 PATCH 现有 SQLite/MySQL 双路径、config validation、audit event linkage 继续复用；新增测试明确空 reason 会被拒绝。
- 静态 Admin 页面测试锁定了 `configEditDrafts`、`handleConfigRegistrySave`、`Config JSON`、`Change reason` 和 `Save config` 入口，防止 UI 回退成只读。

验证：
- `npm test -- src/lib/api/admin.test.ts 'src/app/api/admin/config/[id]/route.test.ts' src/app/admin/page.test.tsx`

历史当时还剩（已被后续阶段部分完成，最新以当前文档末尾为准）：
1. Admin source approval workflow：Lite 已完成 approve/hold/recheck/re-run；审批历史、blocked action、批量队列仍属未来深化。
2. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
3. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
4. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Admin Source Approval Workflow Lite

本阶段完成：
- Admin Data Sources 行级治理操作已接入：管理员可对来源执行 Approve / Hold，写入 `approvedForIngestion`、`approvalStatus`、`legalReviewStatus`、`approvalNotes` 和 `lastApprovalReviewedAt`。
- `/api/admin/data-sources/[id]` PATCH 从仅支持启停扩展为支持来源审批治理字段，保留 SQLite/MySQL 双路径。
- 新增 `POST /api/admin/data-sources/[id]/health-check`，可针对单个来源执行 live health check 并持久化最新 snapshot；Admin UI 通过 Recheck 刷新该来源健康状态。
- 新增前端 API helper `checkAdminDataSourceHealth`，并扩展 `updateAdminDataSource` input 类型以支持治理字段。
- Admin 页面将 source validity、approval status、live health、crawler run/re-run 放在同一行上下文中，形成 approve/hold/recheck/re-run 的轻量运营闭环。

验证：
- `npm test -- src/lib/api/admin.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' 'src/app/api/admin/data-sources/[id]/health-check/route.test.ts' src/app/admin/page.test.ts`

最新还剩（下一阶段优先级）：
1. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
2. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
3. Admin source governance 深化：审批历史、blocked action、批量 approval queue、source health 长期趋势。
4. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: P2 50-State Source Validity Hardening

本阶段完成：
- `source:health:check` 支持 `--all`，可以显式执行 50 州全量 live source health 巡检。
- 前端 50 州 source registry 增加真实 URL / 非占位 URL / source authority / trust status / evidence mode / validity notes 防回归测试。
- Python crawler source registry 增加真实 HTTP(S) base URL、禁止 placeholder / localhost / `sam.gov/opp/12345`、以及 validity metadata 防回归测试。
- 修复当前 registry 中的两个硬 404 base URL：OH 切到当前 BidNet Ohio fallback 抓取入口，WY 切到 Wyoming A&I 当前 Bid Opportunities 页面。
- legacy Ohio parser 测试改为显式历史 fixture source，避免旧 `procure.ohio.gov` parser fixture 影响当前 50 州 registry。

验证：
- `npm test -- scripts/source-health-check.test.ts src/lib/state-crawler-sources.test.ts`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_dedicated_spiders_batch2_west.py crawler/tests/test_state_sources.py`
- `PYTHONPATH=crawler python3 -m pytest crawler/tests`：209 passed。
- `npm run source:health:check -- --all --timeout-ms 5000 --report-only`：28/50 healthy，22 unhealthy，0 skipped；OH/WY 已 PASS，剩余为外部门户 403、超时或 fetch failed。
- `npm run risk:check`：50/50 states、117 state bids、9 attachments、state-content、detail routes、source governance、URL validity 均 PASS；audit 0 vulnerabilities。

最新还剩（下一阶段优先级）：
1. P3 Docs / Operations Handoff：补 source-health runbook，明确 live 403/timeout 的运营处理、复查节奏和审批策略。
2. Admin source governance 深化：审批历史、blocked action 执行保护、批量 approval queue、source health 长期趋势。
3. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
4. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Source Health Operations Lite

本阶段完成：
- `LiveSourceHealthResult` 新增 `operationalSeverity` 与 `recommendedAction`，把 live health 失败从原始错误升级为可运营处理项。
- 分类规则覆盖：404/410 更新 registry URL、401/403/429 浏览器或访问权限复查、timeout/aborted 重试或延长超时、fetch_error 网络/TLS 复查、缺失 base URL 补充元数据。
- CLI 文本报告现在输出 `action=... severity=...`，便于保存日志或交给运营排查。
- Admin Data Sources API 和页面展示最新 live health 的建议动作与严重级别，管理员不需要打开 JSON 也能判断下一步。
- 中英文文案已补齐，运营中文界面和美国用户/团队英文界面都可读。
- `docs/operations/source-health-check.md` 补充 action/severity 解释。

验证：
- `npm test -- src/server/source-validity/live-source-health.test.ts`
- `npm test -- src/server/admin/data-sources-repository.test.ts src/server/source-validity/health-snapshots.test.ts`
- `npm test -- src/app/admin/page.test.ts src/server/source-validity/live-source-health.test.ts src/server/source-validity/health-snapshots.test.ts src/server/admin/data-sources-repository.test.ts`
- `npm run source:health:check -- --all --timeout-ms 5000 --report-only`：20/50 healthy，30 unhealthy，0 skipped；失败项均带 `action=... severity=...`。

最新还剩（下一阶段优先级）：
1. Admin source governance 深化：审批历史、blocked action 执行保护、批量 approval queue、source health 长期趋势。
2. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
3. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
4. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Admin Source Approval History Lite

本阶段完成：
- 新增 `source_approval_events` 表，记录来源审批治理变更历史。
- `updateAdminDataSource` / MySQL runtime update path 在审批字段变化时写入历史事件，包含 actor、action、previous/next approval status、previous/next legal review status、previous/next ingestion approval、reason、createdAt。
- `PATCH /api/admin/data-sources/[id]` 会把当前 admin user id 传入 repository，确保审批历史能追踪操作者。
- Admin Data Sources API 每个 source 返回最近审批历史；Admin 页面在来源行内展示最近两条审批历史。
- 中英文文案补齐：Approval history、Actor、Approved、Blocked、Held for review、Updated。
- SQLite migration 和 MySQL DDL 转换均覆盖新表。

验证：
- `npm test -- src/app/admin/page.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/admin/data-sources-repository.test.ts src/server/db/schema.test.ts`
- `npm test -- src/server/db/mysql.test.ts src/server/db/schema.test.ts`
- `npm run db:migrate`

最新还剩（下一阶段优先级）：
1. Admin source governance 深化：source health 长期趋势。
2. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
3. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
4. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Admin Source Blocked Action Enforcement Lite

本阶段完成：
- `runCrawlerSourceOnce` 新增来源治理执行保护：当 `data_sources` 显式设置为 `approved_for_ingestion=0`、`approval_status != approved`、或 `legal_review_status` 未通过时，直接返回 `blocked`，不会抢 crawler lock，也不会调用 runner/matcher/notifier。
- SQLite 和 MySQL runtime 都使用同一套 source run control 判断。
- 兼容旧数据：没有 `data_sources` 行或治理字段为空的旧来源不会被突然停止；只有显式 Admin/DB 治理状态会拦截。
- `/api/crawler/state/run` 会透传 blocked 结果，批量状态返回 `completed_with_failures`，前端/运营可以看到被治理挡住的 source、审批状态、法务状态和抓取批准状态。

验证：
- `npm test -- src/server/crawler/orchestrator.test.ts`
- `npm test -- src/app/api/crawler/state/run/route.test.ts`

最新还剩（下一阶段优先级）：
1. Admin source governance 深化：source health 长期趋势。
2. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
3. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
4. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
5. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。

## Completed Phase: Admin Source Batch Approval Queue Lite

本阶段完成：
- 新增 `POST /api/admin/data-sources/batch`，支持 admin-only 批量 `approve` / `hold` 来源审批动作。
- 批量 API 复用现有 `updateAdminDataSource` / MySQL runtime update path，因此每个来源都会写入 `source_approval_events` 审批历史。
- Admin API role coverage 将批量来源审批路由纳入 full-admin-only 清单。
- Admin 页面 Data Sources 区域新增来源选择、全选、批量批准、批量暂缓按钮，更新成功后替换本地 source rows 并清空已处理选择。
- 中英文文案补齐：selected sources、select source、batch approve、batch hold、批量成功/失败提示。

验证：
- `npm test -- src/app/api/admin/data-sources/batch/route.test.ts`
- `npm test -- src/lib/api/admin.test.ts`
- `npm test -- src/app/admin/page.test.ts src/lib/api/admin.test.ts src/app/api/admin/data-sources/batch/route.test.ts`
- `npm test -- src/server/auth/role-route-coverage.test.ts src/app/api/admin/data-sources/batch/route.test.ts`
- `npm run build`

最新还剩（下一阶段优先级）：
1. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
2. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
3. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
4. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。
5. Source governance production depth：APSI Registration Vault、生产来源治理 runbook 深化。

## Completed Phase: Admin Source Health Trend Lite

本阶段完成：
- 复用现有 `source_health_snapshots`，新增 per-source 趋势聚合，不新增数据库表。
- `sourceHealthTrendBySource` 会按最近快照统计 sample size、healthy/unhealthy/skipped 次数、健康率、当前连续状态、当前连续次数、最近异常时间。
- Admin Data Sources API 每个 source 返回 `sourceHealthTrend`，SQLite 和 MySQL runtime 都使用最近 10 个 source health snapshots。
- Admin 页面在 live source health 卡片中展示近期趋势、健康率、当前连续状态和最近异常时间。
- 中英文文案补齐：Recent trend / 近期趋势、健康率摘要、当前连续状态、最近异常。

验证：
- `npm test -- src/server/source-validity/health-snapshots.test.ts`
- `npm test -- src/server/admin/data-sources-repository.test.ts src/server/source-validity/health-snapshots.test.ts`
- `npm test -- src/app/admin/page.test.ts src/server/admin/data-sources-repository.test.ts src/server/source-validity/health-snapshots.test.ts`
- `npm run lint`
- `npm run build`

最新还剩（下一阶段优先级）：
1. Settings reminder center + delivery preferences：把 Deadline Notifications 扩展到用户设置中心和真实通知渠道。
2. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
3. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
4. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。
5. Source governance production depth：APSI Registration Vault、生产来源治理 runbook 深化。

## Completed Phase: Settings Reminder Center Lite

本阶段完成：
- 新增账号级 Deadline Reminder Center API：`GET/PATCH /api/account/deadline-reminders`，复用现有 `deadline_reminders` 数据、workspace 边界和 `deadline_notifications` 付费功能 gate。
- Deadline service 新增 organization-level reminder center 聚合，支持跨 intent 汇总 active/due soon/overdue/snoozed，并支持 acknowledge / snooze。
- Settings 通知页新增“截止提醒中心”，Business/Enterprise 用户可查看账号级提醒、状态、优先级、到期时间，并可确认或延后 24 小时。
- Free/Pro 用户在 Settings 中看到明确的 plan-limit / upgrade 状态，不暴露个人工作区数据。
- 中英文文案、API client、feature-gate route coverage、Settings static coverage 已补齐。

验证：
- `npm test -- src/app/settings/page.test.ts src/server/auth/feature-gate-coverage.test.ts src/lib/api/auth.test.ts src/app/api/account/deadline-reminders/route.test.ts src/server/deadlines/service.test.ts`

最新还剩（下一阶段优先级）：
1. Submission Guidance Completion：补提交步骤深度、日历/邮件集成边界、任务归属和确认链路。
2. Response Package format depth：PDF/DOCX/ZIP、生产对象存储、导出审计事件和更严格 readiness blocking。
3. Config Matrix 深化：effective-date UI、版本对比、回滚按钮、生产变更审批规则。
4. Production signoff：Stripe sandbox/live、MySQL 真库 smoke、生产 worker runbook 执行。
5. Deadline Notification production depth：真实 email/calendar 投递、outbox scheduling、提醒审计事件、退信/失败监控。

## Status Update Template

Use this after every phase:

```text
本阶段完成：
- ...

验证：
- ...

历史当时还剩（最新以 Open Requirements Backlog 为准）：
1. ...
2. ...
3. ...

建议下一步：
- ...
```
