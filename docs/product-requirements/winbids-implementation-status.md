# WinBids Implementation Status

Updated: 2026-06-30

This document is the working checklist for local development. Update it after each completed phase so the next task can start from this list instead of re-reading the whole codebase.

## How To Use This Checklist

每完成一个阶段后，都要更新下面三块：

1. **Open Requirements Backlog**：当前未完成需求的唯一主清单，按优先级和产品域维护。
2. **Current Product Status**：哪些能力已经可用，哪些只是部分可用。
3. **Account / Permission / Billing Tracker**：账户、admin、套餐、功能权限这条商业化主线的差距。
4. **Recommended Next Phase**：下一阶段优先做什么，避免每次重新阅读代码后再判断。

## Current Local MVP Baseline

本地可用 MVP 的整体边界已整理到 `docs/product-requirements/winbids-local-usable-mvp-plan.md`，工程执行计划已整理到 `docs/superpowers/plans/2026-06-05-local-usable-mvp-completion.md`。当前统一 P0-P3 总体路线以 `docs/superpowers/plans/2026-06-12-overall-progress-execution-roadmap.md` 为准。

## 2026-06-30 P0 Wave 1 Execution Update

本阶段已排除生产发布准备，只做本地功能开发与可验证质量门禁。5 条 P0 线已按 TDD 多 agent 并行完成：

1. **Auth / Anonymous Boundary**：`resolvePrincipal` 不再创建或解析匿名个人用户，不再发匿名 cookie；`company/profile` 和 `dashboard/summary` 匿名返回 `401 AUTH_REQUIRED`；公共 bid/match 浏览仍可匿名。
2. **Homepage / Request Demo / Browser Evidence**：新增 `/request-demo` 本地体验，首页 CTA 不再把 Request Demo 当作隐式注册占位；`demo:browser-evidence` 支持 desktop/tablet/mobile、CTA smoke 和 `overflowFailures` 报告字段。
3. **50-State Data Quality Gate**：新增本地 50 州质量聚合与脚本，输出 50 行 state quality summary，区分 `real_file_openable`、`download_note`、`missing_or_failed`，并把 P0-P3 reason code 接入 risk checklist。
4. **Workflow Governance Lite**：Response Package 增加 reviewer summary、review timeline、approval threshold/readiness reason；Submission 增加 approved export、confirmation reference、required artifact gate；Deadline 增加 submission checkpoint/recovery reminder。
5. **AI Provider Seam + Credit Dry Run**：新增 deterministic/mock provider seam，覆盖 provider success/failure/timeout/fallback；AI run metadata 增加 provider/model/fallback/estimated cost/credits；credit dry-run quote 与 ledger 记录已接入。

验证结果：

- `npm test`: **238 files / 1,217 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- `npx tsx scripts/state-data-quality-check.ts --report-only`: returned 50 state rows and surfaced the then-current data risks before P0.5 cleanup: **5 P0 blocker states** and **45 P1 warning states**.

本阶段新增的主要风险不在代码层，而在数据层；P0.5 已处理其中的 P0 blocker：

- CA、FL、IL、NY、TX 当时触发 `P0:duplicate_canonical_enabled_source`，已在 P0.5 通过 canonical cleanup 清零。
- 50 个州均有 stale/source-health 或 attachment download-note 风险，仍作为 P1/P2 数据运营深度继续处理。
- `state-data-quality` 当时先覆盖 SQLite/AppDatabase 聚合；P0.5 已补 MySQL parity 和 Admin 可视化。

## 2026-06-30 P0.5 Data Quality Cleanup Update

P0.5 已完成，继续排除生产发布准备，只处理本地功能和质量闭环：

1. **Canonical source cleanup**：新增 `cleanupDuplicateCanonicalStateSources` 和 `state-data-quality-check --fix-canonical-sources`。本地 SQLite 已执行修复，CA、FL、IL、NY、TX 的 duplicate enabled canonical source P0 blocker 已清零。
2. **Admin 50-State Data Quality Matrix**：`/api/admin/risk-check` 现在返回 `stateDataQuality`，Admin risk 区块展示 total states、P0/P1/P2 counts、每州 risk/bids/enabled source/attachment real ratio/reason code，并支持基础过滤。
3. **MySQL parity**：新增 `createStateDataQualityReportFromMysql`，`state-data-quality-check` 在 MySQL URL runtime 下会走 MySQL gate；`/api/admin/risk-check` 在 MySQL runtime 下也会返回 `stateDataQuality`，SQLite 默认路径保持不变。
4. **Attachment openability copy**：附件 API 和 bid detail UI 明确区分真实归档可打开文件、source download note、archive missing/failed，不再把 fallback note 伪装成本地归档文件。
5. **Browser evidence hardening**：`demo:browser-evidence` 报告增加顶层 routes、viewports、overflowFailures、ctaFailures；SQLite fallback 实跑通过，30 entries / 30 screenshots / 7 routes / 3 viewports / 0 overflow / 0 CTA failures。

P0.5 验证结果：

- `npm test`: **238 files / 1,233 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed.
- `npx tsx scripts/state-data-quality-check.ts --report-only`: **PASS**, 50 states, **0 P0 blocker states**, 50 P1 warning states.
- `git diff --check`: passed.

剩余风险已降级为 P1/P2 数据运营深度：

- 50 州仍有 P1/P2 warning，主要是 crawler/source-health stale、needs_review source、fixture fallback、download_note 附件。
- 默认 `.env.local` 指向本地 MySQL；当前本机 `127.0.0.1:3306` 未监听时，browser evidence 会生成 `ok:false` 的清晰 setup warning。演示可以使用 SQLite fallback，或先恢复 MySQL 服务。
- 真实 live source health、生产类网络、AWS/Stripe/备份等仍属于生产发布准备，不计入本地 P0.5 完成度。

## 2026-06-30 P1 Data Operations Depth Slice Update

本阶段补齐默认 MySQL runtime 下的 Admin 50 州质量矩阵，并把 50 州质量 warning 转成可执行 action/worklist：

1. **Admin risk-check MySQL state quality parity**：`/api/admin/risk-check` 现在在 MySQL runtime 下调用 `createStateDataQualityReportFromMysql`，返回与 SQLite 路径一致的 `stateDataQuality` 结构；如果质量报告生成失败，仍按原有降级策略返回 `null`，避免整个 Admin risk-check 中断。
2. **State Quality Action Queue**：`StateDataQualityReport` 新增派生 `actions[]`，按 P0/P1/P2 排序，把 `missing_state_bid`、`crawler_success_zero_rows`、`attachment_download_note` 等 reason code 转成 `recommendedAction`、`ownerHint`、`dueInHours` 和 evidence，Admin 50-state matrix 会展示最高优先级 action queue。
3. **Attachment Depth Worklist**：`StateDataQualityReport` 新增 `attachmentWorklist[]`，列出需要本地归档或复核的附件，包括 state/source/bid/attachment、archive status、recommended action 和 evidence；只基于本地 DB 派生，不触发外部下载。
4. **Regression coverage**：`src/app/api/admin/risk-check/route.test.ts` 增加 MySQL runtime 测试，`src/server/source-validity/state-data-quality.test.ts` 覆盖 action queue 和 attachment worklist，`src/app/admin/page.test.ts` 覆盖 Admin action queue UI 入口。

验证结果：

- `npm test -- src/app/api/admin/risk-check/route.test.ts`: **1 file / 4 tests passed**.
- `npm test -- src/server/source-validity/state-data-quality.test.ts scripts/state-data-quality-check.test.ts src/app/api/admin/risk-check/route.test.ts src/app/admin/page.test.ts`: **5 files / 32 tests passed**.
- `npm test`: **249 files / 1,263 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `.env.local` loaded `npm run db:mysql:migrate`: passed, 52 statements applied / 150 skipped.
- `.env.local` loaded `npm run db:mysql:smoke`: passed, 53 tables verified.
- `.env.local` loaded `npm run demo:check`: passed, runtime mysql, 50/50 states, 216 safe local routes, 0 known placeholder URLs.

## 2026-06-30 P1 Funnel Persistence Slice Update

P1 Funnel Persistence 第一阶段和补齐切片已完成，仍只计入本地功能开发，不代表外部 CRM/邮件/Stripe/AWS 已上线：

1. **Request Demo 持久化**：新增 `/api/marketing/request-demo`，表单提交写入通用 `event_log`，同时支持 SQLite 与 MySQL runtime；lead metadata 会规范化 email、company、service states、language，并返回 `/register?intent=demo&lead=<eventId>`。
2. **Request Demo 页面表单**：`/request-demo` 从纯本地说明页升级为 bilingual lead capture 表单；提交成功后进入本地 demo 注册路径，仍保留安全边界文案和公开搜索入口。
3. **注册转化事件**：Demo 注册会把 `marketing.complete_signup` 写入 funnel event，关联 request-demo lead event id。
4. **Supplier Profile 事件**：公司资料 PUT 会写入 `marketing.start_supplier_profile`；当 completion score 达到本地 MVP 阈值 50+ 时写入 `marketing.complete_supplier_profile`。
5. **Admin Funnel Metrics**：新增 `/api/admin/marketing/funnel`，Admin 控制台显示 Request Demo、Signup complete、Profile started/complete、First matched bid 计数，以及最近 request-demo leads。
6. **Start Signup 事件**：新增 `/api/marketing/signup-start`，注册页 mount 时记录 `marketing.start_signup`，支持 demo/free intent、lead event 关联、SQLite/MySQL runtime 和幂等去重。
7. **First Matched Bid 事件**：bid match API 在已登录用户首次查看匹配结果时记录 `marketing.first_matched_bid_viewed`，按 user + bid 幂等去重，并把 score/confidence 写入 metadata。
8. **Request Demo Marketing Ops**：Request Demo 成功提交后会写入 `notification_outbox` 的本地运营通知，同时写入 `marketing.crm_handoff_queued` 和 `event_outbox` 的 `crm.marketing_leads` 交接记录；页面/API 增加 `websiteUrl` honeypot，bot payload 不写 lead、通知或 CRM 事件。
9. **SEO / Resources 首批页面**：新增 `/resources`、`/resources/glossary`、`/resources/supplier-workflow`，提供中英文资源中心、公共招标术语表、供应商 Match -> Learn 追标流程指南和 route-level metadata；首页 Resources 导航和资源卡片已指向真实页面。
10. **Admin Marketing Leads CSV Export**：新增 `/api/admin/marketing/leads/export`，Admin/Operator/Support 可下载 Request Demo leads CSV；导出内容聚合 `event_log` lead metadata、`notification_outbox` 通知状态和 `event_outbox` CRM handoff 状态，作为真实 CRM worker 前的本地运营交接口。

验证结果：

- `npm test -- src/server/marketing/funnel.test.ts src/app/api/marketing/request-demo/route.test.ts src/app/api/admin/marketing/funnel/route.test.ts src/app/api/auth/register/route.test.ts src/app/api/company/profile/route.test.ts src/app/request-demo/page.test.ts src/lib/api/admin.test.ts src/app/admin/page.test.ts`: **9 files / 67 tests passed**.
- `npm test -- src/app/api/marketing/signup-start/route.test.ts src/app/register/page.test.ts 'src/app/api/bids/[id]/match/route.test.ts' src/server/marketing/funnel.test.ts`: **4 files / 13 tests passed**.
- `npm test -- src/app/api/marketing/request-demo/route.test.ts src/server/marketing/ops.test.ts src/app/request-demo/page.test.ts`: **3 files / 8 tests passed**.
- `npm test -- src/lib/marketing/resource-content.test.ts src/lib/marketing/homepage-content.test.ts src/app/resources/page.test.ts src/app/resources/glossary/page.test.ts src/app/resources/supplier-workflow/page.test.ts src/app/page.test.ts`: **6 files / 22 tests passed**.
- `npm test -- src/server/auth/role-route-coverage.test.ts src/app/admin/page.test.ts src/lib/api/admin.test.ts src/app/api/admin/marketing/funnel/route.test.ts`: **5 files / 67 tests passed**.
- `npm test -- src/server/marketing/export.test.ts src/app/api/admin/marketing/leads/export/route.test.ts src/app/admin/page.test.ts`: **4 files / 16 tests passed**.
- `npm test`: **249 files / 1,263 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `.env.local` loaded `npm run db:mysql:migrate`: passed, 52 statements applied / 150 skipped.
- `.env.local` loaded `npm run db:mysql:smoke`: passed, 53 tables verified.
- `.env.local` loaded `npm run demo:check`: passed, runtime mysql, 50/50 states, 0 known placeholder URLs.
- `git diff --check`: passed.

剩余 funnel 深度：

- Request Demo 的本地通知 outbox、基础 spam/bot honeypot、CRM handoff event/outbox 和 Admin CSV export 已完成；真实邮件 provider、外部 CRM 同步、重试运营报表仍待做。
- SEO/resource 首批页面、glossary、supplier workflow pages 和 metadata 已完成；更深 use-case/resource pages、内容 CMS 化和 SEO/analytics 运营仍待深化。

## 2026-06-30 Local Non-Production Multi-Agent Slice Update

本阶段继续排除生产发布准备，按 `docs/superpowers/plans/2026-06-30-local-non-production-backlog-execution.md` 拆分执行本地功能深度：

1. **Local CRM Sync Adapter**：新增本地 fake CRM delivery seam，`crm.marketing_leads` outbox rows 可在无外部 CRM 凭证时标记 delivered/failed，并把 handoff 状态带入现有 marketing export 流程。
2. **RAG-ready Knowledge Retrieval Contract**：Knowledge retrieval trace 升级为 `lexical_mock_rag` 合同，返回 embedding/vector-store unavailable 状态、可展示 chunks、matched reason、source refs 和 excerpt，为后续真实 RAG 留稳定接口。
3. **Browser Expected Signals Gate**：`demo:browser-evidence` 的 expected signals 现在参与 pass/fail，并在报告里输出 `signalFailures`，防止页面“打开了但关键登录/注册/admin/paid 信号缺失”的假阳性。
4. **Data Ops Depth**：State Quality Action Queue 和 Attachment Depth Worklist 已作为 50 州 P1 warning 的运营输入，后续 source-ops filter/closure 可以直接消费。
5. **Admin Source Ops Filters**：Admin source/data-quality 区域新增 classification + triage status + recommended action 组合过滤，方便运营逐项关闭 warning/action。
6. **Marketing Email Delivery Seam**：Request Demo notification outbox 可用本地 fake provider 标记 sent/failed，导出 read model/CSV 带上 attempt/error 状态；不接真实邮件服务。
7. **Config/CMS-backed Marketing Content Resolver**：新增本地安全内容 resolver，支持 homepage/resources copy override，并拒绝或回退 unsafe claims（保证中标、代提交、完整合规保证等）。
8. **Procurement Workflow Depth Lite**：Response/submission evidence 自动关联 artifact，Quote summary 增加 comparison 指标，Award outcome 增加 win/loss learning summary read model。
9. **Grounded QA v2 Mock**：Q&A 增加 grounding status、evidence coverage、limitations，明确 deterministic/mock 边界。
10. **Product 6 Intelligence Lite**：新增本地 deterministic procurement intelligence read model、`/api/dashboard/intelligence` 和 API helper，供 Enterprise cockpit 后续接入。
11. **Locked / Upgrade State Audit**：Intent 和 Settings 的高级功能 locked state 统一走 shared upgrade helper；`admin_console` 继续保持角色要求文案，Free/Pro/Business/Enterprise/Admin 边界有静态契约覆盖。
12. **Admin vs Ordinary User Navigation Polish**：Sidebar 拆成 ordinary/admin item groups，普通用户不显示 admin-only 项，admin 显示 Admin Operations、Data Sources、Configuration；匿名首页 header 明确保留 login/register 入口，Admin 子导航 anchor 已落地。

Focused verification:

- `npm test -- src/server/source-validity/state-data-quality.test.ts scripts/state-data-quality-check.test.ts src/app/api/admin/risk-check/route.test.ts src/app/admin/page.test.ts src/server/marketing/crm.test.ts src/server/marketing/export.test.ts src/server/marketing/ops.test.ts src/server/events/event-log.test.ts src/server/knowledge/retrieval.test.ts src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts scripts/demo-browser-evidence.test.ts`: **13 files / 69 tests passed**.
- `npm test -- src/server/source-validity/state-data-quality.test.ts scripts/state-data-quality-check.test.ts src/app/api/admin/risk-check/route.test.ts src/app/admin/page.test.ts src/app/admin/page.test.tsx src/server/marketing/crm.test.ts src/server/marketing/ops.test.ts src/server/marketing/export.test.ts src/server/marketing/content-config.test.ts src/lib/marketing/homepage-content.test.ts src/lib/marketing/resource-content.test.ts src/server/events/event-log.test.ts src/server/knowledge/retrieval.test.ts src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts scripts/demo-browser-evidence.test.ts src/server/response-workspace/service.test.ts src/server/submission/service.test.ts src/server/quotes/service.test.ts src/server/awards/service.test.ts 'src/app/api/intents/[id]/quotes/route.test.ts' 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/award/route.test.ts' src/server/qualification/qa.test.ts 'src/app/api/intents/[id]/qa/route.test.ts' src/server/intelligence/service.test.ts src/app/api/dashboard/intelligence/route.test.ts src/lib/api/intelligence.test.ts`: **28 files / 171 tests passed**.
- `npm test -- src/app/local-mvp-auth-tier-boundaries.test.ts 'src/app/intents/[id]/page.test.ts' src/app/settings/page.test.ts src/components/layout/app-sidebar.test.ts src/app/page.test.ts src/app/admin/page.test.ts`: **8 files / 65 tests passed**.
- `npm test`: **254 files / 1,292 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `.env.local` loaded `npm run db:mysql:migrate`: passed, 52 statements applied / 150 skipped.
- `.env.local` loaded `npm run db:mysql:smoke`: passed, 53 tables verified.
- `.env.local` loaded `npm run demo:check`: passed, runtime mysql, 50/50 states, 216 safe local routes, 0 known placeholder URLs.

仍排除：真实邮件发送、真实 CRM 凭证、真实 LLM/embedding/vector DB、Stripe sandbox/live、AWS/S3/RDS staging、生产 source-health runner。

## 2026-06-30 UI Integration / Intelligence / Quote Parser Slice Update

本阶段继续只做本地功能，不触碰生产发布准备：

1. **Intent read model UI integration**：Intent 详情页新增 procurement read-model 摘要，展示 quote comparison low/median/high/spread/review flags、Award Win/Loss learning summary、submission/artifact evidence auto-link 汇总。
2. **Dashboard Product 6 Intelligence panel**：登录后 Command Center 并行加载 `/api/dashboard/intelligence`，展示 Product 6 procurement intelligence cockpit metrics、top signals、limitations，并明确 `deterministic_local` / `llm: not_used`；匿名首页不加载 intelligence。
3. **Admin Marketing Content CMS Lite**：Admin Config Registry 显示 Marketing Content CMS / Copy Library 入口，标出 `ux_state.copy_library`、homepage/resources scope、safe validation 和 unsafe claim guard。
4. **Quote upload parsing lite**：新增 deterministic CSV/JSON quote upload parser，输出 normalized rows、totals、warnings 和 comparison-ready summary；不做文件存储或 XLSX 解析。
5. **50-state gate status**：本轮 `demo:check` 和 `risk:check` 均证明 50/50 州、1,146 条 state bids、216 条 state attachments、0 placeholder URLs 仍通过；卡住的全量 state-data-quality report 已识别为后续性能/运营优化项，不影响本地 demo/risk gate。

Verification:

- `npm test -- 'src/app/intents/[id]/page.test.ts' src/app/page.test.ts src/lib/api/intelligence.test.ts src/app/admin/page.test.ts src/server/marketing/content-config.test.ts src/server/quotes/service.test.ts src/server/quotes/upload-parser.test.ts`: **9 files / 62 tests passed**.
- `npm test`: **255 files / 1,299 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `.env.local` loaded `npm run db:mysql:migrate`: passed, 52 statements applied / 150 skipped.
- `.env.local` loaded `npm run db:mysql:smoke`: passed, 53 tables verified.
- `.env.local` loaded `npm run demo:check`: passed, runtime mysql, 50/50 states, 216 safe local routes, 0 known placeholder URLs.
- `.env.local` loaded `npm run risk:check`: passed, 50/50 required states, 1,146 state bid detail routes, 216 attachments, and npm audit 0 vulnerabilities.
- `git diff --check`: passed.

当前判断采用产品可演示/可上线口径，而不是只按工程 smoke 是否通过计算。MySQL、权限、paid-tier、50 州 deterministic 检查已证明本地链路能跑；Track D 现在还把 source-health evidence 和 access-review evidence 都纳入 launch handoff 校验。2026-06-29 新增读取的 `WinBids_Homepage_and_Marketing_PRD.docx` 已纳入剩余需求：它主要补充公开官网首页、营销叙事、定价预览、转化漏斗、SEO/资源和安全宣传边界，不改变现有后台产品主线。但 UI 完整度、营销首页、真实外部服务、生产运维、真实 AI/Enterprise 深度仍会拉低整体完成度。

| Dimension | Completion | Status |
|---|---:|---|
| 本地可用 MVP | 98% | 搜索、50 州数据、账号、权限、意向工作台、响应工作区、材料库、报价、提醒都能跑；匿名个人边界、Request Demo lead capture、Response governance、AI provider seam、50-state quality gate、Admin matrix/action filters、role-aware nav、locked/upgrade audit、Admin funnel metrics、MySQL parity、funnel completion events、Marketing Ops outbox/email seam、SEO/resource 首批页面、workflow depth lite、Intent read-model UI、Dashboard Product 6 intelligence panel、quote upload parser lite 和 browser evidence hardening 已补齐；剩余主要是更深 UI polish、少量数据运营 closure、真实外部服务和生产类事项。 |
| 生产发布准备 | 73% | MySQL、AWS 部署文档、worker/runbook、risk check 已有；AWS staging dry-run、backup/restore evidence checklist、production/staging readiness preflight、S3-compatible provider、strict S3 posture preflight、source-health operations alias、source-health evidence + access-review handoff、artifact scan seam/version/audit coverage、统一 launch handoff report 更完整；这仍是 dry-run readiness，不代表已真实 AWS/S3/Stripe/邮件/备份演练。 |
| 商业化闭环 | 73% | 注册登录、admin/普通用户分离、套餐权限、Stripe foundation 已有；匿名个人工作区副作用已清理，Settings hosted checkout、webhook 安全、paid workspace smoke、locked/upgrade 状态一致性已补强；真实 Stripe sandbox/live 验证未完成。 |
| 公开营销首页 / 获客漏斗 | 94% | Track E 第一阶段已完成，P1 Funnel Persistence 已新增 Request Demo 表单持久化、start signup、demo signup/profile funnel events、first matched bid event、Marketing Ops notification/CRM handoff outbox、Admin CSV lead export、SEO/resource 首批页面和 Admin funnel metrics；本地 fake CRM sync adapter、fake email delivery seam、safe content-config resolver、Admin Marketing Content CMS lite 已完成；P0.5 已实跑 SQLite fallback browser evidence 并截图通过。剩余是外部 CRM credentials sync、真实邮件 provider credentials、更多 use-case 内容和完整 CMS 编辑体验。 |
| 采购工作流深度 | 93% | Submission/Compliance/Pursue-NoBid/Response/Artifact/Quote/Deadline 均有 Lite；Response Package governance、review timeline、approval threshold、submission readiness gate、deadline bridge、artifact evidence auto-link、quote comparison、quote upload parser lite、award win/loss learning summary 和 Intent read-model UI 已补齐；真实 AWS/S3 staging、外部 malware scanning、深度 review governance reporting、XLSX parsing 和生产 outcome analytics 未完成。 |
| AI/Enterprise 深度 | 60% | deterministic/mock provider seam、AI run metadata、Knowledge lexical retrieval trace、RAG-ready `lexical_mock_rag` chunks/embedding-unavailable contract、grounded QA v2 mock、Product 6 intelligence lite、Dashboard Product 6 panel、premium credit dry-run quote/ledger 已完成；真实 LLM、embedding/vector store、真实信用扣费、深 Enterprise cockpit 还未做。 |
| 完整 PRD/长期平台 | 76% | 基础平台、主工作流、lite intelligence seams、本地演示闭环、durable marketing funnel seam、local CRM/email/content config seams、workflow depth read models/UI、Dashboard intelligence panel、quote parser lite、生产 preflight/source ops/object storage seam、source-health access-review handoff、package export/review/version-history/comparison depth、artifact scan seam、50-state data quality gate/Admin matrix/action filters 已进一步铺开；真实生产运营、企业级治理和真实 AI 仍是后续主线。 |

总体判断：

- **Local usable MVP:** about **98% complete**.
- **Production launch readiness:** about **73% complete**.
- **Commercialization loop:** about **73% complete**.
- **Homepage / marketing acquisition:** about **94% complete**.
- **Procurement workflow depth:** about **93% complete**.
- **AI / Enterprise depth:** about **60% complete**.
- **Full PRD/platform scope:** about **76% complete**.

本地 MVP 的代码层主线已进一步收敛，当前最重要的剩余项不是重新做搜索页或后台框架，也不是 paid-tier smoke；下一步本地优先围绕“P1 数据运营深度 + 漏斗持久化 + 工作流深度 + AI/Enterprise Lite”推进，生产发布准备继续作为外部并行 track。

1. **Response Package Format Slice**：Done locally. `markdown | zip | pdf | docx` is explicit; Markdown remains downloadable, ZIP creates a local package with `README.md`, `manifest.json`, and readable linked artifacts, and lightweight PDF/DOCX exports are available from the Intent UI.
2. **Submission Completion Lite**：Done locally. Submission status, guarded transitions, confirmation history, and recovery handling exist.
3. **Auth/Tier Smoke Hardening**：Static local MVP regression coverage exists for anonymous/auth/admin/locked boundaries; MySQL-backed browser/API smoke now covers anonymous/free/admin/paid Business/Enterprise boundaries.
4. **50-State Validity Operations Pass**：Deterministic `risk:check` passed for 50/50 states, 1,146 state bids, 1,146 detail routes, and 216 state attachment records. Live `source:health:check -- --all --inspect-body` remains an operations-risk report because public portals can return access challenges, 403s, timeouts, TLS/network failures, or 503.
5. **MySQL-backed local runtime smoke**：Done locally. The existing `winbids-mysql` container is running on `127.0.0.1:3306`; migration, smoke, worker preflight, risk gate, public/user/admin/paid API smoke, and admin/user/paid browser smoke passed.
6. **Local MVP Handoff Sync**：Continue updating this file, next plan, runbook, risk checklist, and operations notes after each stage.

外部生产事项仍保留为 parallel track：Stripe sandbox/live signoff、AWS production deployment、Secrets Manager population、真实 backup/restore drill、production email provider、真实 S3/CloudFront/malware scanning、real LLM/credit consumption。当前 AWS/object-storage 文档、preflight 和 S3-compatible provider 只证明 dry-run readiness 与 adapter seam 更可执行，不等同于 AWS production 已上线。

## Current Unified Execution Roadmap

Use `docs/product-requirements/winbids-next-development-plan.md` as the next local execution entrypoint. `docs/superpowers/plans/2026-06-12-overall-progress-execution-roadmap.md` remains the high-level progress baseline, while production launch preparation stays in its separate external track.

Current track order:

1. **P1 Data Operations Depth**：减少 50 州 P1 warning，刷新 crawler/source-health snapshot，提升真实归档附件比例，处理 needs_review source。
2. **P1 Funnel Persistence / Marketing Ops**：Request Demo 持久化、start_signup、demo signup/profile events、first matched bid event、通知 outbox、honeypot 防刷、CRM handoff event/outbox、本地 fake CRM sync adapter、本地 fake email delivery seam、安全内容 config resolver、Admin Marketing Content CMS lite、Admin CSV lead export 和 SEO/resource 首批页面已完成；下一步补更深 resource/use-case pages、完整 CMS 编辑体验、真实外部 CRM/email credentials handoff。
3. **P1 Workflow Depth**：Artifact compliance auto-link、Quote comparison、quote upload parser lite、Win/Loss learning summary、Intent read-model UI 已完成；下一步做 quote upload UI、XLSX parsing、award tabulation、outcome analytics。
4. **P1 AI / Enterprise Lite**：RAG-ready Knowledge retrieval contract、grounded QA v2 mock、Product 6 intelligence lite、Dashboard Product 6 panel 已完成；下一步做深 Enterprise cockpit 和真实 provider 后置设计。
5. **Production readiness external track**：真实 AWS/S3/Stripe/邮件/备份/source-health production-like runner 仍独立排期，不混入本地 P1 完成度。

## Current Progress By Product Track

| Track | Completion | Already usable | Main gaps |
|---|---:|---|---|
| Public discovery and 50-state data | 95% | 50-state registry/data, public search/detail, deterministic no-placeholder checks, safe attachment routes, repeatable `demo:prepare/demo:check` readiness gates, `demo:smoke` coverage, state data quality gate with 0 P0 blockers, canonical source cleanup, MySQL parity, Admin quality matrix in SQLite/MySQL runtime, state quality action queue, attachment depth worklist, source ops classification/triage/recommended-action filters, live source-health classification, evidence bundle, access-review packet, and Admin filtering. | Reduce P1 warnings through action/worklist closure: stale crawler/source-health, needs_review sources, fixture fallback, and download-note attachment depth. Production-like live source work remains external. |
| Account, admin, tier access | 85% | Register/login/logout, admin/user/operator/support separation, Settings, workspace/org basics, tier gates, locked/upgrade states. | Behavior-level regression breadth, production identity hardening, enterprise-specific rules. |
| Commercial billing | 70% | Plan catalog, subscription tables, checkout/webhook/portal/cancel foundation, invoice/payment history, Stripe sandbox verifier script, production webhook hardening, hosted checkout navigation, helper env validation, route boundary coverage, and demo-smoke paid workspace coverage. | Real Stripe test/live credentials, webhook forwarding, portal/checkout acceptance, dunning production scheduling. |
| Pursuit workflow | 93% | Intent, deterministic brief, Submission Lite, Compliance Lite, Pursue/No-Bid Lite, Response Workspace Lite, Artifact Vault Lite, Quote Lite, Deadline Lite, Award/Win-Loss UI/API, package exports, approval/review/readiness governance, submission gate, deadline bridge, artifact replace/version flow, frozen submission evidence, artifact evidence auto-link, quote comparison summary, quote upload parser lite, win/loss learning summary, and Intent read-model UI. | Quote upload UI, XLSX parsing, award tabulation, outcome analytics, and deeper review reporting. |
| Admin operations | 89% | Admin users, source health, crawler controls, bid QA, config registry, risk check visualization, 50-state data quality matrix/action queue in SQLite/MySQL runtime, source ops triage/recommended-action filters, marketing funnel metrics, notifications foundation/email fake delivery seam, Admin Marketing Content CMS lite, section-level degradation, and source-health classification filtering. | Source approval governance depth, audit/event coverage expansion, full Admin CMS editing, production alerts. |
| Production operations handoff | 73% | `ops:production:check` validates production preflight, and `ops:launch-handoff` now summarizes Stripe sandbox, production preflight, AWS staging dry-run evidence, live source-health evidence, live source access-review evidence, browser evidence, and risk gate evidence with secret redaction and local JSON validation where available. | Real AWS/S3/RDS staging evidence, Stripe sandbox/live evidence, production email, backup/restore drill, worker execution, and owner signoff. |
| Homepage / marketing acquisition | 94% | Anonymous home implements the Homepage PRD slice; `/request-demo` exists with local lead capture; CTA smoke and local analytics capture exist; start signup, demo signup/profile events, first matched bid events, Marketing Ops notification/CRM handoff outbox, local fake CRM sync adapter, fake email delivery seam, safe content-config resolver, Admin Marketing Content CMS lite, Admin CSV lead export, `/resources` hub, glossary, supplier workflow guide, and Admin funnel metrics are durable/local; browser evidence hardening has a passing SQLite fallback run with 30 screenshots and 0 overflow/CTA failures. | External CRM credentials sync, production email credentials, deeper use-case/resource pages, SEO/analytics operations, full CMS editing. |
| UI/UE | 83% | Main shell, bilingual support, auth page styling, differentiated dashboard, static demo references, anonymous marketing homepage, role-aware sidebar/admin anchors, unified locked/upgrade states, Award / Win-Loss panel, Submission evidence summary, response package controls, Admin source-health and state-quality filters, repeatable smoke coverage, and hardened `demo:browser-evidence` where expected signals now affect pass/fail. | Deeper mobile polish, dashboard vs search product differentiation, visual consistency, and final target-style migration. |
| AI / Enterprise | 60% | Deterministic/mock provider seam, AI run metadata, Knowledge lexical retrieval trace, RAG-ready lexical mock chunks/embedding unavailable contract, grounded QA v2 mock with evidence coverage/limitations, Product 6 intelligence lite read model/API/helper, Dashboard Product 6 panel, credit dry-run quote/ledger, citations/freshness/Q&A surface, and constrained UI display of provider/model/cost/fallback facts. | Deep Enterprise cockpit, real LLM/embedding/credit later. |

## 2026-06-10 Multi-Agent Audit Queue

Five read-only agents reviewed the unified progress tracks. The current execution queue is:

| Priority | Track | Required slice | Why it comes next |
|---:|---|---|---|
| P0 | MVP demo boundary | Done in first worker batch: anonymous users now get login/register before personal Intent creation; logged-in users can still create/open Intent directly. | Removes a visible demo dead-end from `/bids/[id] -> Intent`. |
| P0 | Local demo data | Done locally in Worker A: `npm run demo:prepare` migrates/seeds deterministic local demo readiness data, ensures 50-state Admin/source visibility, normalizes state attachment URLs to safe local download routes, and fails non-zero on missing states, placeholder URLs, empty bid/detail content, or empty/unsafe attachments. `npm run demo:check` performs the same readiness gate without preparing data. | Intent workspace fixture depth can still be expanded separately, but Admin no longer looks like only a handful of data sources exist when the 50-state story is central. |
| P0 | Commercial security | Done in first worker batch: production Stripe mode requires signed Stripe events; generic production billing events require `BILLING_WEBHOOK_SECRET`. | Prevents an unauthenticated subscription mutation path before real billing launch. |
| P0 | Commercial UX | Done in first worker batch: Settings checkout uses real browser navigation for hosted checkout URLs. | Required for actual Stripe sandbox/live checkout. |
| P0 | Production readiness | Done across worker batches: production/staging worker checks fail closed for SQLite runtime and local notification providers; AWS runbook now defines an executable staging dry-run order, evidence artifacts, backup snapshot/logical dump, restore rehearsal, rollback decision, S3-compatible object-storage provider credentials, and `ops:production:check` requires backup/restore evidence metadata. | This is still dry-run readiness only; real AWS deploy, secret-manager population, real S3 smoke, CloudFront/signed URL posture, malware scanning, and restore drill execution remain external launch blockers. |
| P1 | Workflow depth | Done locally across second/third worker batches: `award_outcomes` schema/migration, SQLite/MySQL repository, service validation, `/api/intents/[id]/award`, client helpers, and Intent detail Award / Win-Loss UI panel are implemented. | Closes the procurement lifecycle from bid pursuit to outcome capture; deeper outcome learning remains future work. |
| P1 | Response package depth | Done locally across third/fifth/sixth/seventh/eighth/ninth/tenth/Wave 1/Storage Lite/Governance Lite slices: ZIP export packages Markdown/README, manifest, and readable linked artifacts; missing artifacts are recorded in manifest; lightweight PDF/DOCX exports are available; object-storage provider supports local and S3-compatible SigV4 operations; exports can be approved/returned; snapshots now expose full history totals, expandable version list, any-version side-by-side comparisons, governance summary, artifact replace/version flow exists, and submission confirmations freeze package/export version evidence. | Makes response package output more demo-real without waiting for full production storage; real AWS/S3 staging, external malware scanning, retention lifecycle proof, and deeper review governance reporting remain future work. |
| P1 | Submission evidence depth | Done locally across fourth/fifth/Wave 1 slices: submission responses include evidence links to package exports, linked supplier artifacts, and award outcome; Intent Submission panel surfaces the evidence summary; each submission confirmation now freezes the then-current package/export version evidence, linked artifacts, award outcome, and captured timestamp. | Strengthens the proof-of-submission story while preserving current package/export APIs; richer review history and production storage remain future work. |
| P2 | AI/Enterprise foundation | Done locally across second/fourth worker batches: deterministic AI run metadata, lexical Knowledge retrieval trace, zero-charge credit ledger dry-run, and constrained Enterprise UI display are implemented without model keys. | Raises AI/Enterprise depth without requiring real model keys yet. |
| P2 | Production source ops | Done locally in fourth/fifth/source-evidence/source-triage/access-review batches: live source-health results classify 403, timeout, bot-check, login-required, empty/placeholder, TLS/network, HTTP error, and unknown states with short redacted evidence snippets; Admin can filter by classification; `source:health:ops` / `source:health:scheduled` provide production-like run commands; `source:health:evidence` turns latest snapshots into release/operations evidence bundles; `source:health:triage` bulk-applies owner/disposition/next-review; `source:health:access-review` turns unhealthy rows into browser/vendor/timeout/network/portal/parser review queues; `ops:launch-handoff` validates both source-health and access-review evidence. | Repeat from production-like network/AWS runner and work through the 29-source access-review queue before promoting more sources from beta to verified. |

Primary multi-agent plan:

- `docs/superpowers/plans/2026-06-10-unified-progress-multi-agent-execution-plan.md`

First worker batch verification:

- `npm test -- 'src/app/bids/[id]/page.test.ts' 'src/app/api/bids/[id]/intent/route.test.ts' src/app/local-mvp-auth-tier-boundaries.test.ts src/app/api/billing/webhook/route.test.ts src/server/billing/production-preflight.test.ts src/app/settings/page.test.ts src/app/api/account/subscription/checkout/route.test.ts src/server/operations/production-readiness.test.ts scripts/notification-worker.test.ts`: 9 files / 45 tests passed.
- `npm test`: 219 files / 1,041 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

Progress adjustment after first worker batch:

- Local usable MVP remains about **80-82%**: one visible demo dead-end is fixed and demo data prep is now repeatable through `npm run demo:prepare`; browser smoke breadth and UI polish remain.
- Production launch readiness moves toward **62%**: worker/preflight launch blockers are stricter, but AWS/staging execution, email provider, and backup/restore proof remain.
- Commercialization loop moves toward **68%**: webhook safety and checkout navigation are fixed, but real Stripe sandbox/live validation remains.
- Procurement workflow depth remains about **65%** until Award / Win-Loss Lite is implemented.
- AI / Enterprise depth remains **20-30%** until metadata/retrieval/credit dry-run implementation begins.

Second worker batch verification:

- `npm test -- scripts/demo-readiness.test.ts src/server/db/schema.test.ts src/server/db/mysql.test.ts src/server/awards/repository.test.ts src/server/awards/service.test.ts 'src/app/api/intents/[id]/award/route.test.ts' src/server/ai/run-metadata.test.ts src/server/knowledge/retrieval.test.ts src/server/billing/credit-ledger.test.ts src/server/qualification/qa.test.ts 'src/app/api/intents/[id]/qa/route.test.ts' src/app/api/knowledge/route.test.ts src/lib/api/knowledge.test.ts src/app/admin/page.test.ts src/app/admin/page.test.tsx src/app/local-mvp-auth-tier-boundaries.test.ts src/lib/api/intents.test.ts`: 17 files / 105 tests passed.
- `npm test`: 226 files / 1,077 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `DATABASE_URL='mysql://...' npm run demo:check`: passed in MySQL mode with the same 50-state readiness summary.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed in MySQL mode.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from audit.
- `git diff --check`: passed.

Progress adjustment after second worker batch:

- Local usable MVP moves to about **84%**: repeatable demo readiness gates and Admin partial degradation are now available; browser smoke and UI polish remain.
- Production launch readiness remains about **62%** after the second worker batch: code gates are stronger, but AWS/staging, email provider, backup/restore, and real production worker proof remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **68%**: Award / Win-Loss backend/API is complete, but the Intent detail UI panel and downstream learning loop remain.
- AI / Enterprise depth moves to about **35%**: metadata, retrieval trace, and credit dry-run are implemented, but real LLM/RAG/credit debit is still out of scope.

Third worker batch / Worker D verification:

- `npm test -- src/server/operations/production-readiness.test.ts`: 1 file / 7 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

Progress adjustment after third worker batch:

- Award / Win-Loss UI, local ZIP response package export, and repeatable demo smoke were completed after the Worker D dry-run readiness slice.
- Focused third-batch suite: `npm test -- 'src/app/intents/[id]/page.test.ts' src/lib/api/intents.test.ts src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' scripts/demo-smoke.test.ts src/server/operations/production-readiness.test.ts`: 9 files / 81 tests passed.
- `npm test`: 227 files / 1,085 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `npm run demo:smoke -- --origin=http://localhost:3010`: passed against a temporary local dev server; 8 smoke checks passed.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed in MySQL mode.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from audit.
- `git diff --check`: passed.

Progress adjustment after full third worker batch:

- Local usable MVP moves to about **86%**: demo readiness, demo smoke, Award UI, Admin partial degradation, and ZIP export are now available.
- Production launch readiness moves to about **64%**: dry-run evidence gates are stronger, but real AWS staging, backup/restore, production email, and Stripe live/sandbox execution remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **72%**: Award / Win-Loss UI and local ZIP package export are now usable; production storage and advanced package formats remain.
- AI / Enterprise depth remains about **35%** until real LLM/RAG/credit debit or UI surfacing of metadata is implemented.

Fourth worker batch verification:

- AI metadata / Knowledge trace UI: deterministic provider/model/rules/prompt/cost/fallback/credit dry-run facts are displayed in the Enterprise/Knowledge-enabled Intent area without implying real LLM execution.
- Submission evidence links: submission read models now include package export download links, linked supplier artifact ids/names, and existing award outcome evidence without cross-intent leakage.
- Object storage adapter seam: local object storage remains default; S3-compatible provider now has a SigV4 REST implementation for PUT/GET/HEAD/DELETE with runtime-secret credential injection, production/staging preflight requirements, and no secret printing.
- Live source-health classification: source probes classify `ok`, `forbidden`, `timeout`, `bot_check`, `login_required`, `empty_or_placeholder`, `tls_or_network_error`, `http_error`, and `unknown`, with short redacted evidence snippets.
- Focused fourth-batch suite: `npm test -- 'src/app/intents/[id]/page.test.ts' src/lib/api/knowledge.test.ts src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts' src/lib/api/intents.test.ts src/server/storage/object-storage.test.ts src/server/storage/local-object-storage.test.ts src/server/operations/production-readiness.test.ts src/server/artifacts/service.test.ts src/server/response-workspace/service.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' scripts/source-health-check.test.ts src/server/source-validity/live-source-health.test.ts src/server/source-validity/health-snapshots.test.ts src/app/api/admin/data-sources/route.test.ts 'src/app/api/admin/data-sources/[id]/health-check/route.test.ts' src/server/admin/data-sources-repository.test.ts`: 20 files / 141 tests passed.
- `npm test`: 228 files / 1,102 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `npm run demo:smoke -- --origin=http://localhost:3011`: passed against a temporary local dev server; 8 smoke checks passed.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed in MySQL mode.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from audit.
- `git diff --check`: passed.

Progress adjustment after fourth worker batch:

- Local usable MVP moves to about **87%**: AI metadata visibility, submission evidence read models, storage seam, and live source classification now add explainability and operational confidence.
- Production launch readiness moves to about **66%**: object-storage preflight and source-health classification are stronger, but real AWS/S3/CloudFront, malware scanning, email provider, restore drill, and Stripe execution remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **74%**: submission evidence is now linked at API/read-model level, while UI summary polish and production storage remain.
- AI / Enterprise depth moves to about **38%**: deterministic metadata/retrieval/credit facts are now visible in UI, but real LLM/RAG/credit debit remains out of scope.

Fifth worker batch verification:

- Submission evidence UI: Intent Submission panel now surfaces package export links, linked supplier artifacts, award outcome evidence, and an empty-state explanation.
- Admin source-health filters: Admin Data Sources can filter loaded sources by `ok`, `forbidden`, `timeout`, `bot_check`, `login_required`, `empty_or_placeholder`, `tls_or_network_error`, `http_error`, and `unknown`.
- Source-health operations handoff: `npm run source:health:ops` and `npm run source:health:scheduled` provide fixed report-only snapshot commands with `--inspect-body --write-snapshot`; runbook covers daily/weekly cadence and escalation.
- Object storage production depth: S3-compatible provider now signs PUT/GET/HEAD/DELETE requests with AWS SigV4 when runtime credentials are injected, while missing credentials fail closed without writing local files or printing secret values.
- Focused fifth-batch suite: `npm test -- 'src/app/intents/[id]/page.test.ts' src/app/admin/page.test.ts src/app/admin/page.test.tsx scripts/source-health-check.test.ts src/server/storage/object-storage.test.ts src/server/storage/local-object-storage.test.ts src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts' src/lib/api/intents.test.ts`: 12 files / 91 tests passed.
- `npm test`: 228 files / 1,110 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `npm run demo:smoke -- --origin=http://localhost:3012`: passed against a temporary local dev server; 8 smoke checks passed.
- `npm run db:migrate`: passed.
- `DATABASE_URL='mysql://...' npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `DATABASE_URL='mysql://...' npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `DATABASE_URL='mysql://...' npm run workers:check`: passed in MySQL mode.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from audit.
- `git diff --check`: passed before final documentation edits; rerun after this status update before handoff.

Progress adjustment after fifth worker batch:

- Local usable MVP moves to about **88%**: proof-of-submission UI, Admin source-health triage, source-health ops commands, and S3-compatible storage execution path are now available locally.
- Production launch readiness moves to about **68%**: S3-compatible runtime provider and source-health handoff are stronger, but real AWS/S3/CloudFront, malware scanning, email provider, restore drill, and Stripe execution remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **76%**: submission evidence is now visible in UI and linked to exports/artifacts/award evidence; PDF/DOCX and deeper versioned submission packages remain future work.
- AI / Enterprise depth remains about **38%** until real LLM/RAG/credit debit begins.

Sixth worker batch verification:

- Response Package PDF/DOCX export: `ResponsePackageExportFormat` now supports `markdown | zip | pdf | docx`; service generation creates lightweight PDF bytes and DOCX OOXML packages; Intent UI exposes per-format export buttons and keeps existing API shape by passing `format`.
- Artifact security/retention seam: Supplier artifact metadata now includes derived `securityScanStatus` and `retentionPolicy`; uploads fail closed before storage/DB writes when deterministic local/noop malware signatures such as EICAR or `MALWARE_TEST_SIGNATURE` are detected.
- Audit/event expansion: response package export creation, response package download marking, and submission confirmation write durable audit events in SQLite/MySQL paths; metadata excludes storage paths and full notes.
- Focused sixth-batch suite: `npm test -- src/server/response-workspace/service.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts'`: 5 files / 70 tests passed.
- Worker integration suite: `npm test -- src/server/artifacts/service.test.ts src/server/submission/service.test.ts src/server/events/event-log.test.ts src/server/response-workspace/service.test.ts`: 4 files / 40 tests passed.
- `npm test`: 228 files / 1,112 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `npm run demo:smoke -- --origin=http://localhost:3013`: passed against a temporary local dev server; 8 smoke checks passed.
- `npm run db:migrate`: passed.
- `.env.local`-loaded `npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `.env.local`-loaded `npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from moderate audit.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed.

Progress adjustment after sixth worker batch:

- Local usable MVP moves to about **89%**: response package export options are clearer and PDF/DOCX demo artifacts are downloadable locally.
- Production launch readiness moves to about **69%**: artifact scan/retention seams and broader audit/event coverage improve handoff controls, but real AWS/S3/CloudFront, external malware scanning, email provider, restore drill, and Stripe execution remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **79%**: package/export/submission evidence is now deeper; remaining depth is versioned response packages, richer approval/review actions, external object-storage validation, and real submission package production.
- AI / Enterprise depth remains about **38%** until real LLM/RAG/credit debit begins.

Seventh implementation slice verification:

- Response Package review action workflow: existing `reviewStatus/reviewNotes` metadata now has a service/API/client/UI update path. Business users can approve an export or request changes with notes from the Intent Response Workspace panel.
- Review audit: `response_package.review_updated` writes a redacted event with previous status, new status, and `hasReviewNotes`; full review notes are intentionally excluded from event metadata.
- Validation: requesting changes requires a non-empty review note; invalid review statuses are rejected at the route boundary.
- Focused review suite: `npm test -- src/server/response-workspace/service.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts'`: 5 files / 73 tests passed.
- Extended workflow suite: `npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts' src/server/submission/service.test.ts src/server/artifacts/service.test.ts`: 9 files / 93 tests passed.
- `npm test`: 228 files / 1,117 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run demo:check`: passed in SQLite mode with 50/50 states, 1,146 active state bids, 216 safe state attachments, and 0 known placeholder URLs.
- `npm run demo:smoke -- --origin=http://localhost:3014`: passed against a temporary local dev server; 8 smoke checks passed.
- `npm run db:migrate`: passed.
- `.env.local`-loaded `npm run db:mysql:migrate`: passed with 50 statements applied and 134 skipped.
- `.env.local`-loaded `npm run db:mysql:smoke`: passed with 51 tables and all smoke domains verified.
- `npm run risk:check`: passed with 50/50 states, 1,146 state bids, 216 state attachments, and 0 vulnerabilities from moderate audit.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.

Progress adjustment after seventh implementation slice:

- Local usable MVP moves to about **90%**: response package review is now an actionable workflow, not only display metadata.
- Production launch readiness remains about **69%**: review audit coverage improves handoff, but real AWS/S3/CloudFront, external malware scanning, email provider, restore drill, and Stripe execution remain external.
- Commercialization loop remains about **68%** until real Stripe sandbox/live credentials are exercised.
- Procurement workflow depth moves to about **80%**: package export generation and approval/needs-changes loop are local; remaining depth is version history, package comparison, production storage/scanning, and real submission package production.
- AI / Enterprise depth remains about **38%** until real LLM/RAG/credit debit begins.

## Latest Local MVP Completion Batch

Completed on 2026-06-05:

| Slice | Status | Verification |
|---|---|---|
| Response Package Export Format Contract | Done locally | Focused response-workspace/API/client/UI tests passed; full `npm test`, lint, build, and schema tests passed. |
| Submission Completion Lite | Done locally | Focused submission service/repository/API/generator tests passed; full regression passed. |
| Auth/Tier local MVP smoke | Done locally as static coverage | `frontend/src/app/local-mvp-auth-tier-boundaries.test.ts` covers anonymous home, signed-in dashboard fetch boundary, login/register, admin-only controls, paid locked modules, personal workspace auth-required state, and feature matrix coverage. |
| 50-state deterministic validity | Passed | Latest `npm run risk:check` passed with 50/50 required states active, 1,146 state bids, 1,146 bid detail route checks, 216 state attachments, 1,147 active bid URLs for global URL validity, source-governance checks, and moderate-or-higher audit checks. |
| Live source-health operations probe | Report generated, not a release blocker | `npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body` completed and persisted a report; 20/50 were healthy and 30/50 were unhealthy due to live portal access conditions. |
| Browser smoke | Passed for anonymous/free/admin/paid | Anonymous home/search/Intent auth gate, bid detail, safe attachment links, ordinary-user login/settings/admin-denial, admin login/admin-console checks, paid Business Intent workspace checks, paid logout, and Enterprise Knowledge Station checks passed against MySQL. |
| MySQL-backed runtime smoke | Passed | `winbids-mysql` started successfully; MySQL migration/smoke, worker preflight, risk gate, bid/detail/attachment API checks, ordinary-user registration/login/admin-denial, admin login/admin API, and browser admin/user separation checks passed. |
| Admin invited paid-user workspace creation | Fixed and covered | Admin-created invited users now receive an owned organization/workspace aligned to the chosen tier; focused SQLite/MySQL repository tests passed, and Enterprise Knowledge Station no longer fails with workspace-missing auth behavior. |

Paid-tier smoke evidence from this batch:

- Admin-created Business test account exercised Intent, Submission, Compliance, Response Workspace, Artifacts, Quotes, Deadlines, response package snapshot, Markdown export/download, and later local ZIP export/download through local APIs.
- Business browser smoke verified the paid workspace page, logout entry, and normal Enterprise-only locked/upgrade visibility.
- Admin-created Enterprise test account opened `/knowledge` through API and browser without `AUTH_REQUIRED` or upgrade-lock state.

Regression evidence from this batch:

- `npm test`: 219 files, 1,030 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run db:migrate`: passed.
- `npm run db:mysql:migrate`: passed with 49 statements applied and 129 skipped.
- `npm run db:mysql:smoke`: passed with 50 tables and all listed smoke domains verified.
- `npm run workers:check`: passed in MySQL mode.
- `npm run risk:check`: passed.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `git diff --check`: passed after final documentation sync.

Earlier environment blocker, now resolved locally:

- `npm run db:mysql:migrate` with `DATABASE_URL=mysql://winbids:...@127.0.0.1:3306/winbids` failed with `ECONNREFUSED 127.0.0.1:3306`.
- Docker later became available; `docker start winbids-mysql` brought MySQL up on `127.0.0.1:3306`, and the MySQL-backed checks above passed.

Latest small UI/admin smoke fixes:

- `AuthRequiredState` now sets `nativeButton={false}` when rendering Link-backed Base UI buttons, removing the Base UI native button semantics warning for login/register action links.
- `frontend/src/components/auth/AuthRequiredState.test.ts` locks this behavior.
- Admin-created invited users now get a workspace immediately in both SQLite and MySQL invite paths; `frontend/src/server/admin/users-repository.test.ts` locks this behavior.
- `demo:browser-evidence` now emits stable local JSON output, top-level route/viewport/overflow/CTA failure fields, and degraded `ok:false` evidence when authenticated demo fixtures fail. A 2026-06-30 localhost run with SQLite fallback captured 30 screenshots and passed with 0 overflow and 0 CTA failures; the default MySQL env still needs a running local MySQL service.

## Open Requirements Backlog

这部分是后续开发的主清单。每完成一个阶段，优先更新这里；历史阶段记录只保留背景，不再作为下一步判断依据。

### P0 / Homepage & Marketing Acquisition

Source: `WinBids_Homepage_and_Marketing_PRD.docx`, read from Google Drive on 2026-06-29. This track is a public-site and conversion layer over the already-built product. It should not replace the logged-in Command Center; anonymous visitors should see a marketing homepage, while authenticated users should continue into their role/tier-aware workspace.

Current homepage relationship to product:

- Current `/` already differentiates anonymous vs authenticated users and provides Browse public bids, Create account, and Sign in entry points.
- Existing product capabilities can support the homepage promise: search/matched bids, supplier profile, Bid Brief, Compliance Manifest, Pursue/No-Bid, Response Workspace, Submission Guidance, Award/Win-Loss, Knowledge Station Lite, and tier gating.
- The missing part is packaging these capabilities into the Homepage PRD lifecycle: **Match -> Understand -> Decide -> Prepare -> Submit -> Learn**.

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| HM-001 Responsive marketing homepage | Done locally for current baseline: anonymous homepage first slice exists with full PRD section structure and logged-in Command Center preserved; SQLite fallback browser evidence captured 30 screenshots with 0 overflow failures. | Deeper mobile polish can still improve the experience. | Continue polish only after funnel persistence/SEO slices. |
| HM-002 Global marketing navigation | Done locally for desktop/tablet baseline: Product, How It Works, Knowledge Station, Pricing, Resources, Sign In, Start Free are present for anonymous homepage only. | Mobile collapsed nav is not a separate component yet; current nav wraps responsively. | Add mobile-specific nav only if browser evidence shows wrap is not good enough. |
| HM-003 Hero promise and CTAs | Done locally: hero uses `Find public bids you can actually pursue.`, Start Free, See How It Works, and public search CTA from typed bilingual content. | Product preview could become more visual later. | Add visual product preview after core browser evidence. |
| HM-004 How It Works lifecycle | Done locally: Match, Understand, Decide, Prepare, Submit, Learn are rendered from content module. | Deep links to specific product modules are not yet attached to every step. | Add route-level links after Product Map route strategy is finalized. |
| HM-005 Product Map | Done locally: Supplier Profile, Bid Discovery, Pursuit Readiness, Pursuit Pipeline, Knowledge Station cards exist. | Cards are marketing-level and do not yet include per-module screenshots. | Add lightweight product visuals after UI polish pass. |
| HM-006 Pricing Preview | Done locally: Free, Pursuit Starter, Response Builder, Growth, Enterprise preview exists; paid CTAs route to request-demo/start-free route map instead of anonymous `/settings`. | Stripe/live pricing copy and launch availability still need business confirmation. | Keep local preview, later bind live plan display if product asks. |
| HM-007 Knowledge Station marketing role | Done locally: Knowledge Station is presented as embedded mentor/literacy layer with safe copy; public resource pages now provide glossary and workflow literacy depth. | Knowledge-specific examples can still be richer. | Add Knowledge guide examples when RAG/Product Intelligence Lite deepens. |
| HM-008 Start Free route | Done locally for funnel baseline: Start Free CTAs route through `/register`; register page records durable `marketing.start_signup`; Demo registration writes durable `marketing.complete_signup` when a lead id is supplied. | Downstream sales attribution is local-only until real CRM/export exists. | Add external CRM/export attribution only when sales handoff is prioritized. |
| HM-009 Request Demo / lead capture | Partial+ done locally: `/request-demo` has bilingual lead capture, `/api/marketing/request-demo` persists the lead in `event_log`, queues a local `notification_outbox` operator email, records `marketing.crm_handoff_queued`, exposes Admin leads CSV export, and rejects honeypot bot payloads without writing lead/outbox records. | Real email provider, external CRM sync, richer spam/rate limits, and marketing-content CMS are not implemented. | Add real CRM sync worker and content CMS after current resource routes. |
| HM-010 Analytics events | Partial+ done locally: local/no-op homepage event capture exists; durable server analytics now cover `request_demo_submitted`, `start_signup`, `complete_signup`, `start_supplier_profile`, `complete_supplier_profile`, `first_matched_bid_viewed`, and CRM handoff queued, with Admin funnel metrics. | Notification delivery analytics, external CRM sync outcome, and content/SEO performance analytics remain future work. | Add notification delivery events, CRM/export handoff status, and SEO/resource tracking later. |
| HM-011 FAQ and safe claims | Done locally: FAQ and safe claims state no direct submission, no compliance/win guarantee, and official source of truth. | Legal copy still needs final business/legal signoff before public launch. | Keep as local-safe copy until launch review. |
| HM-012 Editable marketing content | Partial+: headline, section copy, FAQ, pricing and CTA labels now live in a typed local content module. | Not yet editable through Config Registry/CMS. | Migrate content module to Config Registry/CMS when admin content editing is prioritized. |
| SEO / Resources layer | Partial+ done locally: homepage Resources nav/cards link to `/resources`; `/resources`, `/resources/glossary`, and `/resources/supplier-workflow` exist with bilingual content, route metadata, safe claims, glossary, and Match -> Learn workflow guidance. | Deeper use-case pages, structured SEO data, content CMS editing, and SEO/analytics operations are not implemented. | Add use-case pages and Config/CMS-backed editing after CRM/export surface. |

Marketing acceptance criteria:

1. A first-time U.S. supplier visitor can explain WinBids in one sentence after hero + How It Works.
2. Homepage shows lifecycle: Match -> Understand -> Decide -> Prepare -> Submit -> Learn.
3. Supplier Profile appears independently; Pursuit Pipeline groups Response Workspace, Submission Guidance, and Award Tracking.
4. Start Free and Request Demo CTAs work and are trackable.
5. Pricing preview aligns to Free, Pursuit Starter, Response Builder, Growth, Enterprise.
6. Knowledge Station is presented as learning/mentor layer, not a standalone course product and not a fully real AI/RAG promise.
7. Public claims avoid direct submission, guaranteed compliance, guaranteed wins, and fully verified source-data language.

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
| MySQL Cutover | Done locally as the default dev runtime: MySQL 8 container, `.env.local` MySQL URLs, migration/import/admin reset, SQLite runtime guard, route-level MySQL guard coverage, MySQL smoke, worker preflight, 50-state risk check, dashboard summary, Knowledge Station, subscription reconcile, admin pages, admin/user browser smoke, ordinary-user locked states, and safe bid detail/attachment checks all pass. | Remaining production signoff: run the operator-assisted Stripe sandbox flow with real test credentials against MySQL and execute low-risk live checkout/webhook validation. Production worker/owner/backup preflight is now scriptable through `npm run ops:production:check`, but still needs a real production-like environment execution. | Run Stripe sandbox verifier against a MySQL dev/staging DB, then execute live billing webhook/checkout smoke from the runbook. |

### P0 / Completed Recently

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| Source Health Triage + Report Export | Done locally: `data_sources` now persists owner/disposition/next-review/notes/reviewed-at for live source health operations in SQLite and MySQL; Admin PATCH supports admin/operator triage updates with notes redaction; Admin Data Sources shows triage status and quick save actions; `npm run source:health:report` exports latest persisted SQLite/MySQL snapshots as sanitized Markdown/JSON/CSV operations reports. | Longer-term source ownership workflow, scheduled production-network live probe handoff, and alerting remain. | Start Worker 5 Browser demo evidence harness, then Worker 6 Response Package governance lite. |
| P1 Anonymous Boundary Cleanup | Done locally: public `/search`, bid detail, match, and safe attachment routes remain anonymously browsable; saved bids, intents, profile/settings, search alerts, and paid workspace APIs now require registered users; Search Alerts anonymous GET/POST/PATCH/DELETE return the shared `AUTH_REQUIRED` response and no longer issue anonymous cookies; browser smoke confirms `/saved`, `/intents`, `/profile`, and `/settings` show sign-in/create-account states. | Continue full-chain authenticated browser regression for ordinary/paid users as future UI smoke depth. | Start P2 50-State Source Validity Hardening next: strengthen source/content/detail/download checks and live source-health reporting. |
| P1 Tier / Paid Feature Locking | Done locally: Free / Pursuit Starter / Response Builder / Enterprise entitlement matrix now covers legacy feature keys and PRD feature slugs; paid intent APIs are protected by authenticated + feature-gated route coverage; Knowledge Station requires registered workspace access before Enterprise gating; Settings feature access now shows upgrade/locked guidance for Pursue / No-Bid, Grounded Q&A, Response Workspace, Artifact Vault, Quote Workflow, Deadline Notifications, and Knowledge Station; Intent paid modules have static locked-state coverage. | Behavior-level browser smoke and future usage/credit consumption depth remain. | Start P1 Anonymous Boundary Cleanup next: keep public anonymous browsing, but require registered users for saved bids, intents, profile/settings, alerts, and paid workspace APIs. |
| P0-P3 Parallel Batch 1 | Done locally: Intent detail workflow sections were split into dedicated panel components for Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications; Admin has an editable Config Registry / Config Matrix section; Admin Data Sources API exposes latest persisted live source health details; P3 entitlement/Knowledge/Credit tests now cover Enterprise-only Knowledge defaults, org overrides, expired overrides, Growth as planned/disabled, and credit metadata. | Intent panel business logic is still mostly owned by the page; source-health approval actions are not complete; P3 remains a preparation layer without real credit consumption or production AI. | Next deepen Admin source approval workflow now that source health and config governance are visible. |
| Product 2 Compliance Evidence Mapping v1 | Done locally: Compliance Manifest items now include derived `evidenceRefs` linked to supplier profile, match snapshot, deadline citation, bid detail/source URLs, generated checklist/risk output, and attachment download routes; Intent detail renders linked evidence chips under each compliance item while preserving status/evidenceStatus/notes editing. | User-editable evidence mappings, evidence history, and document-level extraction remain future depth. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Product 2 Richer Evidence / Artifact Links v1 | Done locally: pursue/no-bid reason details now include additive `evidenceRefs` linked to match snapshots, supplier profile, bid detail/source URLs, generated output, citation ids, and attachment download routes; Intent detail renders linked evidence chips while preserving the legacy evidence label fallback. | Deeper document parsing remains future AI work. | Continue with Knowledge Station Lite or Admin risk-check visualization. |
| Risk Checklist Automation | Done locally: `npm run risk:check` verifies 50-state active data coverage, required non-empty bid content, bid detail route ID round-trips, safe attachment download routes, admin/user/paid entitlement separation, and production dependency audit at moderate-or-higher severity. | Keep this command in the phase handoff checklist and expand it as new high-risk workflows ship. | Run after each crawler/auth/billing/frontend phase before reporting completion. |
| Admin risk-check visualization | Done locally: `/api/admin/risk-check` exposes the existing risk checklist report to admin/operator/support roles, persists recent snapshots, returns a trend summary, and `/admin` shows pass/fail status for global URL health, 50-state coverage, non-empty state content, bid detail routes, attachment downloads, account-tier separation, recent history, and trend deltas. | Optional future alerting, per-check remediation actions, and longer-horizon charts. | Continue with persisted live source-health snapshots or Artifact Vault Lite. |
| Response Workspace Lite | Done locally: `response_workspace_items` model/migration, Business-gated APIs, client helpers, Intent detail panel, grouped tasks/checkpoints/artifacts/outline sections, editable status/notes, owner assignment, item comments, linked artifacts, activity history, response package readiness summary, package snapshots, local Markdown/ZIP/PDF/DOCX export/download, package/artifact manifest metadata, download audit timestamps, local/S3-compatible object-storage abstraction, export checksum/byte-size download integrity validation, response package export review-state metadata/display, and soft-delete-aware linked artifact filtering are implemented. | Production AWS/S3 validation, external malware scanning, richer export approval workflow, richer team member directory, version history, configurable retention, and LLM drafting remain future depth. | Continue with versioned package/review depth next. |
| Artifact Vault Lite | Done locally: `supplier_artifacts` and `artifact_versions` model/migration, safe local object-storage writer, checksum/byte-size validated downloads, Business-gated list/upload/download/delete/replace APIs, client helpers, Intent detail upload/list/delete/replace panel, file type/purpose/expiry/review/security-scan/retention metadata, deterministic local/noop malware scan seam for test signatures, soft delete columns, `artifact.deleted` / `artifact.replaced` audit events, active-vault filtering, response-workspace/quote deleted-artifact filtering, empty/upload-failed UniversalState handling, and English/Chinese copy are implemented. | Compliance auto-linking, real external malware scanning, signed URL/CDN posture, and approved retention lifecycle proof remain future depth. | Continue with real AWS/S3 staging validation or compliance evidence auto-linking. |
| Quote / Supply Chain Lite | Done locally: `sourcing_partners`, `quote_requests`, and `quote_request_artifacts` schema/migration, Business-gated GET/POST/PATCH APIs, client helpers, Intent detail Quote Workspace, partner creation, quote status/amount/notes editing, artifact linking, quote comparison summary, deterministic CSV/JSON quote parser lite, empty/error/locked states, and English/Chinese copy are implemented. | Quote upload UI, XLSX parsing, email sending, supplier portal, deeper comparison scoring, partner profile depth, audit events, and richer artifact/compliance linkage remain future depth. | Continue with quote upload UI, then XLSX and richer scoring. |
| Deadline Notifications Lite | Done locally: `deadline_reminders` schema/migration, Business-gated GET/PATCH APIs, idempotent generator for bid deadlines, response task due dates, quote request due dates, and artifact expiries, acknowledge/snooze actions, Intent detail reminder panel, Settings reminder center, MySQL runtime adapter, locked/error/empty states, and English/Chinese copy are implemented. | Production notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, and audit events remain future depth. | Continue with Submission Guidance Completion or production notification delivery depth. |
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
| Production Billing / Worker Deployment Runbook | Stripe sandbox E2E verifier、checkout/webhook/portal/cancel foundation 已完成；production billing/worker runbook 和 AWS deployment runbook 已新增；notification worker 支持部署前检查；`npm run ops:production:check` 可校验 live billing/MySQL/owner/backup handoff 变量且不泄露密钥。 | 真实 AWS 资源创建、真实生产凭证填充、生产 webhook 端点创建/轮换演练、ECS/App Runner worker dry run、真实备份恢复演练。 | 上线前按 AWS runbook 做一次 staging/prod dry run。 |
| Notification production hardening | outbox、file/console/http provider、retry worker、Admin 手动 delivery、provider env validation、生产投递 runbook、Search Alert digest delivery history 已有。 | 生产邮件 provider 真实账号、退信/投诉回流、模板版本治理、投递监控 dashboard。 | 接入选定邮件 provider 后补 bounce/complaint webhook。 |
| UI/UE production polish | 有 `/winbids-demo` 与 `/generative-art-static` 静态 demo，主应用已有部分视觉调整和中英文切换；匿名首页已有 public search / register / login 入口。 | 将 demo 风格系统性迁移到真实业务页面；按 Homepage PRD 重做匿名营销首页；统一表格/筛选/空状态/加载态/移动端布局；避免只停留在静态 demo。 | 先做匿名 `/` marketing homepage + `/search`、`/bids/[id]`、`/admin` 三页可用性与视觉收敛。 |

### P2 / Product Workflow Depth

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| Knowledge Station Lite | Done locally: Enterprise-gated Intent workflow coach, reusable organization-scoped knowledge items, protected list/create APIs, Intent panel, and minimal `/knowledge` library are implemented. | Full retrieval, embeddings, admin publishing workflow, artifact uploads, usage metrics, and credit metering remain future depth. | Continue with Response Workspace Lite or Artifact Vault Lite. |
| Response Workspace Lite | Done locally: Business-gated task/checkpoint/artifact/outline workspace exists on Intent detail with durable DB rows, API/client, editable status, editable notes, owner assignment, item comments, linked artifacts, soft-delete-aware artifact filtering, activity history, package readiness summary, package snapshots, local Markdown/ZIP/PDF/DOCX export/download, package/artifact manifest metadata, download audit timestamps, local/S3-compatible object-storage abstraction, checksum/byte-size validated export downloads, export review-state metadata/display, and bilingual UI; task due dates now feed Deadline Notifications Lite. | Production AWS/S3 validation, external malware scanning, richer export approval workflow, richer team member directory, version history, configurable retention, and LLM drafting remain future depth. | Next continue with versioned package/review depth. |
| Artifact Vault Lite | Done locally: Business-gated supplier artifact upload/list/download/delete/replace exists on Intent detail with durable `supplier_artifacts` and `artifact_versions` rows, safe local/S3-compatible object-storage writer, checksum/byte-size validated downloads, intent/bid association, type/purpose/expiry/review/security-scan/retention metadata, deterministic local/noop malware test-signature blocking, soft delete, delete/replaced audit events, version display, and bilingual UI. | Compliance auto-linking, real AWS/S3 validation, external malware scanning, and approved retention lifecycle proof remain future depth. | Later connect uploaded artifacts back into Compliance Manifest evidence history. |
| Quote / Supply Chain Lite | Done locally: Business-gated supplier/partner records, quote request drafts, status flow, quote amount/response notes, linked supplier artifacts, API/client helpers, bilingual Intent UI, quote due-date reminders, quote comparison summary, and deterministic CSV/JSON quote parser lite exist. | Quote upload UI, XLSX parsing, email sending, supplier portal, richer partner profile depth, audit events, and richer compliance linkage remain future depth. | Next expose quote parser in the Intent UI, then add XLSX and richer scoring. |
| Deadline Notifications Lite | Done locally: Business-gated deadline registry, Intent reminder panel, Settings reminder center, and MySQL runtime adapter derive reminders from bid deadlines, response task due dates, quote due dates, and artifact expiries; users can acknowledge and 24-hour snooze reminders. | Production notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, and audit events remain future depth. | Continue with production notification delivery depth after worker deployment is signed off. |
| Submission Guidance Completion | Guidance 生成、编辑、确认已存在。 | 更完整的 submission path 状态机、确认凭证、错误恢复、历史版本。 | 补 submission version/history 和 readiness completion。 |
| Award / Tabulation Tracking | Lite implemented: Award outcome API/client/UI, status/winner/amount/loss reason/next action fields, and submission evidence links exist. | Tabulation record depth, buyer notice monitoring, portfolio analytics, and richer competitive analysis input remain. | Deepen with award tabulation capture and outcome analytics. |
| Win/Loss Learning | Lite implemented: deterministic learning summary is derived from captured award outcome and surfaced in the Intent read model. | Portfolio-level reason taxonomy, feedback loops into qualification, and analytics dashboards remain. | Deepen after tabulation capture. |

### P3 / Later / Enterprise / AI Depth

| Requirement | Current state | Remaining work | Suggested next slice |
|---|---|---|---|
| Real credit consumption and paid credit packs | credit tables、plan copy、usage summary 已有。 | AI action 真实扣费、refund flow、credit purchase packs、admin adjustment、ledger reconciliation。 | 等 premium AI actions 接入后再做真实扣费。 |
| Advanced usage metrics | saved bids / intents / alerts / team usage 已计数。 | quote workflow、Knowledge Station、AI call、artifact storage 等指标。 | 随对应模块落地逐项补。 |
| Organization lifecycle polish | workspace/team 管理可用。 | invite acceptance analytics、更完整 team audit、company owner/member 与 global role 的统一策略。 | 做 team audit history 列表。 |
| Custom enterprise permission rules | 中心 entitlement map + org feature overrides 已有。 | enterprise policy model、custom packages、contract-specific limits。 | 等真实 enterprise case 再建规则模型。 |
| Production AI layer | 当前为 deterministic/AI-like foundation。 | LLM extraction、citations、confidence、prompt rules、uncertainty handling、cost controls。 | 从 Product 2 citations/Q&A 的受限场景开始。 |
| Product 6 intelligence | Lite implemented: deterministic cockpit metrics, top signals, source policy, limitations, `/api/dashboard/intelligence`, client helper, and Dashboard panel exist with explicit `llm: not_used`. | Deep Enterprise cockpit, real buyer/competitor/pricing/category datasets, forecasting, real LLM/RAG, and credit charging remain. | Next deepen Enterprise cockpit with deterministic/local sources first. |

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
| 普通账户团队空间 | Mostly done locally | Default organization/workspace exists with organization-level tier ownership; Team tab can rename workspace, invite local members, enqueue local invitation email notifications, show invitation delivery status, resend/revoke pending invitations, accept invitations, transfer owner, update member role, disable/restore members, and remove members. Admin-created invited users also receive an owned workspace immediately. |
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
| P0 | Production Billing / Worker Deployment Runbook | Done locally: production credential separation, deployment environment notes, webhook endpoint rotation, scheduled worker deployment instructions, and `ops:production:check` owner/backup handoff preflight exist. | Real production/staging dry run, secret-manager population, backup restore drill, and low-risk live checkout/webhook validation still require external environment access. |
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

### Artifact Soft Delete / Delete Audit Events

Completed locally:

- `supplier_artifacts` now has soft-delete metadata across SQLite and MySQL migrations.
- Artifact Vault exposes a Business-gated DELETE API and bilingual Intent UI delete action.
- Deleted artifacts are excluded from active vault listing/download lookup.
- Response Workspace linked artifacts and Quote Workspace linked artifacts exclude deleted artifacts and reject deleted artifact reuse.
- `artifact.deleted` audit events are written with intent, bid, file, artifact type, and purpose metadata.
- The current workflow-depth implementation plan is tracked at `docs/superpowers/plans/2026-06-03-production-signoff-workflow-depth-schedule.md`.

Verified:

- `npm test -- src/server/artifacts/service.test.ts src/server/db/schema.test.ts src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts src/server/response-workspace/service.test.ts src/server/quotes/service.test.ts src/app/intents/[id]/page.test.ts`
- Full regression commands are listed in the latest completed phase entry below.

## Recommended Next Phase

Run **Track D Live Source Health Operations** as the next active phase. The local usable MVP is already strong enough for demonstration, so the next high-value work is validating the 50-state source story from a production-like network and resolving the access-review queue. Stripe and production-like AWS/worker dry runs remain P0 signoff work, but they require external credentials/environment and should run as external parallel tracks.

Implementation plans:

- Local MVP execution plan: `docs/superpowers/plans/2026-06-05-local-usable-mvp-completion.md`
- Local MVP product boundary: `docs/product-requirements/winbids-local-usable-mvp-plan.md`
- Production signoff schedule: `docs/superpowers/plans/2026-06-03-production-signoff-workflow-depth-schedule.md`
- Current production readiness plan: `docs/superpowers/plans/2026-06-03-production-readiness-e2e.md`
- Historical P1-P3 cleanup schedule: `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`

Reason:

- The current local system is usable and repeatedly verified, including account/tier separation, 50-state deterministic data, response package depth, source-health evidence, and access-review handoff.
- The remaining 50-state risk is no longer local route/data emptiness; it is live public portal behavior from the actual operator network.
- Track D already has executable commands and evidence formats: `source:health:ops`, `source:health:evidence`, `source:health:access-review`, and `ops:launch-handoff`.
- Stripe sandbox and production readiness are scriptable, but real Stripe test keys, AWS resources, secret-manager values, backup/restore evidence, and production worker execution are still external.
- Docs/runbooks must continue to be updated after each wave so the next session can continue from the checklist without re-reading the codebase.

Execution order:

1. **Track D Production-Like Probe**：从生产类网络或 AWS runner 运行 `npm run source:health:ops`，生成新的 persisted snapshot。
2. **Track D Evidence Refresh**：运行 `source:health:evidence` 和 `source:health:access-review`，对比本地网络与生产类网络结果。
3. **Track D Source Decisions**：对 29 个 follow-up source 逐项标记 verified / beta / fallback / manual-review / hold。
4. **External Track A/B/C Readiness**：有 AWS/Stripe/backup 凭证时运行 AWS/S3/RDS staging、Stripe Sandbox E2E、Production worker/secrets/backup dry run。
5. **Docs Handoff**：更新 implementation status、next plan、runbook、风险清单和操作说明。

Parallel agent plan:

- Agent A：Response package format contract, API, service, schema, and UI display.
- Agent B：Submission completion status/history/recovery service, API, and Intent UI.
- Agent C：Auth/tier local MVP smoke for anonymous, free, paid, and admin experiences.
- Agent D：50-state deterministic and live source-health verification.
- Agent E：Docs, operations handoff, and verification evidence.

After local MVP freeze, resume post-MVP workflow depth in this order: versioned response packages and richer approval actions, production object storage and external malware scanning, Config Matrix rollback/effective-date UI, Award / Tabulation Tracking, Win/Loss Learning, and production AI.

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
- 明确登记当时尚未实现 API 的付费功能：`quote_workflow`、`knowledge_station`；后续 Knowledge Station Lite 和 Quote Workflow 均已接入受保护 API，当前该历史登记不再代表最新功能状态。
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

## Completed Phase: MySQL Default Runtime Verification

本阶段完成：
- 本地 dev runtime 已切到 MySQL：`winbids-mysql` 容器运行在 `127.0.0.1:3306`，`.env.local` 指向 MySQL，管理员账号重置到 MySQL。
- 修复 MySQL guard 暴露出的运行时缺口：bid match、dashboard summary、Knowledge Station list/create、subscription lifecycle reconcile，以及 Admin config/data-sources/crawler logs/bid QA/notifications 等页面 API。
- 新增 route-level MySQL 覆盖测试，防止 API route 在 MySQL 模式下静默回落 SQLite。
- 扩展 `db:mysql:smoke`，新增 billing reconcile 与 Knowledge Station 验证；保留 auth/account/workspace/crawler/billing/dunning/deadline/workflow 等既有生命周期验证。
- 完成浏览器和 HTTP 回归：管理员与普通用户展示不同，普通用户 `/admin` 被拒绝，Free 用户看到 paid features locked/upgrade，`/search`、50 州 bid detail、内部附件下载可用。
- 已生成本地 post-cutover MySQL dump：`frontend/data/backups/winbids-mysql-post-cutover-20260603.sql`，不提交仓库。

验证：
- `DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run db:mysql:smoke`：50 tables，billing reconcile verified，knowledge station verified。
- `DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run risk:check`：当时快照为 50/50 states，1096 state bids，166 state attachments，0 audit vulnerabilities；最新 2026-06-30 快照见本文顶部总览，已刷新为 1,146 active state bids 和 216 safe local attachment routes。
- `DATABASE_URL=mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids npm run workers:check`：crawler/event/notification workers 均为 `database: mysql`。
- HTTP 50-state check：50 state codes，50 sampled detail routes，166 attachment routes，0 detail failures，0 attachment failures。
- Browser smoke：admin `/admin` 加载成功；ordinary `/settings` Free tier + locked features；ordinary `/admin` permission denied；bid detail 页面可打开。
- `npm test`：214 test files、990 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed；本阶段当时仍有 Turbopack NFT trace warning，已在后续 Build / Dashboard Warning Cleanup 阶段清理。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
2. Production Worker Deployment：在生产类环境执行 crawler、notification/dunning、event outbox worker preflight 和一次性 dry run。
3. Production Secrets / Backup Ownership：确认 secret manager、生产 MySQL 备份恢复、webhook rotation、低风险 live checkout 签核。
4. Live Source Health Operations：继续处理外部门户 403/timeout/fetch failed，逐步把 beta/fallback 州源提升到 verified。
5. Artifact / Response Package Production Depth：本地对象存储抽象、下载完整性校验、export review metadata、artifact soft delete/delete audit 已完成；剩余为 explicit export format model、生产对象存储 adapter、恶意文件扫描、PDF/DOCX/ZIP、richer approval workflow、artifact version/replace history 和 retention policy。
6. Build / Dashboard Warning Cleanup：已在后续阶段完成。

## Completed Phase: Artifact Soft Delete / Delete Audit Events

本阶段完成：
- `supplier_artifacts` 新增 `deleted_at`、`deleted_by_user_id`，SQLite migration 和 MySQL idempotent migration 均已补齐。
- `deleteSupplierArtifact` 会软删除材料、排除 active vault 列表，并写入统一 `artifact.deleted` audit event。
- `DELETE /api/intents/[id]/artifacts/[artifactId]` 已接入现有 auth + feature gate，返回刷新后的 Artifact Vault。
- Intent Artifact Vault 面板新增中英文删除按钮、删除中状态、删除成功提示。
- Response Workspace 和 Quote Workspace 均过滤已删除 artifact，并拒绝重复引用已删除 artifact，避免响应包/RFQ 继续露出旧材料。

验证：
- `npm test -- src/server/artifacts/service.test.ts src/server/db/schema.test.ts src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts src/server/response-workspace/service.test.ts src/server/quotes/service.test.ts src/app/intents/[id]/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run db:migrate`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:migrate`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`
- `npm run risk:check`
- `npm audit --omit=dev --audit-level=high`
- `npm run workers:check`
- `git diff --check`

最新还剩（下一阶段优先级）：
1. Track C / First Richer Export Format Slice：为 response package exports 建模 `markdown`/`zip` format，保持 Markdown 默认，ZIP 先做明确 validation placeholder。
2. Response Package production depth：PDF/DOCX 实际生成、真实 AWS/S3 staging validation、malware scanning、richer approval workflow。
3. Artifact Vault future depth：version history、replace flow、compliance auto-linking、retention policy。
4. Stripe Sandbox E2E、Production worker/secret/backup dry run、Live Source Health Operations 仍按外部凭证/环境并行推进。

## Completed Phase: Response Package Export Review State

本阶段完成：
- `response_package_exports` 新增 review metadata：`review_status`、`reviewed_at`、`reviewed_by_user_id`、`review_notes`。
- SQLite migration 和 MySQL idempotent column migration 均已补齐，已有 MySQL 表可通过 `db:mysql:migrate` 补列。
- Response Package export 创建时默认进入 `pending_review`，API 返回 snapshot export list 时带出 review metadata。
- Intent Response Workspace 的最近导出链接旁显示中英文 review 状态 badge。
- 新增 service、repository、schema、route mock、Intent panel 静态测试覆盖。

验证：
- `npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts src/server/db/schema.test.ts src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts src/app/intents/[id]/page.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run db:migrate`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:migrate`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`
- `npm run risk:check`
- `npm audit --omit=dev --audit-level=high`
- `npm run workers:check`
- `git diff --check`

最新还剩（下一阶段优先级）：
1. Track C / First Richer Export Format Slice：response package export format model、Markdown default、ZIP placeholder validation。
2. Response Package production depth：PDF/DOCX actual generation、richer approval action、malware scanning、real AWS/S3 staging validation。
3. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids。
4. Production worker/secret/backup dry run 和 live source health operations。

## Completed Phase: Response Package / Artifact Storage Integrity Lite

本阶段完成：
- 新增本地对象存储 helper，统一处理安全 object key、绝对存储路径、写入大小和 SHA-256 manifest。
- Artifact Vault 上传改为通过安全本地对象存储写入；下载时按 `byteSize` 和 `checksumSha256` 复核，文件被替换或损坏时返回 `ARTIFACT_INTEGRITY_FAILED`。
- Response Package Markdown export 改为通过同一存储 helper 写入；下载时按 manifest 复核并保留下载审计时间戳，文件损坏时返回 `EXPORT_INTEGRITY_FAILED`。
- 新增路径穿越、checksum/byte-size 校验、artifact 下载完整性、response export 下载完整性相关测试覆盖。

验证：
- `npm test -- src/server/storage/local-object-storage.test.ts src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts src/server/artifacts/service.test.ts src/server/response-workspace/service.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run db:migrate`
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`
- `npm run risk:check`
- `npm audit --omit=dev --audit-level=high`
- `npm run workers:check`
- `git diff --check`

最新还剩（下一阶段优先级）：
1. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
2. Production Worker Deployment：在生产类环境执行 crawler、notification/dunning、event outbox worker preflight 和一次性 dry run。
3. Production Secrets / Backup Ownership：确认 secret manager、生产 MySQL 备份恢复、webhook rotation、低风险 live checkout 签核。
4. Live Source Health Operations：继续处理外部门户 403/timeout/fetch failed/access challenge，逐步把 beta/fallback 州源提升到 verified。
5. Response Package / Artifact 深度：explicit export format model、生产对象存储 adapter、恶意文件扫描、PDF/DOCX/ZIP、richer approval workflow、artifact version/replace history、retention policy。

## Completed Phase: Build / Dashboard Warning Cleanup

本阶段完成：
- 首页 Command Center 的 Link CTA 不再通过 Base UI `Button render={<Link />}` 输出，改为 `Link + buttonVariants`，避免客户端出现 native button semantics warning。
- Response Package Markdown export 的默认本地存储路径收敛到 `process.cwd()/data/response-package-exports`，并保留测试可注入 `storageRoot`。
- `next.config.ts` 增加窄范围 Turbopack issue ignore：仅匹配 `**/next.config.ts` 上的 `Encountered unexpected file in NFT list`，用于清理已知的 response package export route 文件追踪 warning。
- 新增配置测试、首页静态语义测试和默认导出路径测试，防止 warning 回归。

验证：
- `npm test -- src/app/page.test.ts src/server/response-workspace/service.test.ts next.config.test.ts`
- `npm run build`：通过，未再输出 Turbopack NFT warning。
- Browser console smoke：打开 `http://localhost:3000/`，warnings/errors 为 `[]`。

最新还剩（下一阶段优先级）：
1. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
2. Production Worker Deployment：在生产类环境执行 crawler、notification/dunning、event outbox worker preflight 和一次性 dry run。
3. Production Secrets / Backup Ownership：确认 secret manager、生产 MySQL 备份恢复、webhook rotation、低风险 live checkout 签核。
4. Live Source Health Operations：继续处理外部门户 403/timeout/fetch failed，逐步把 beta/fallback 州源提升到 verified。
5. Artifact / Response Package Production Depth：本地对象存储抽象、下载完整性校验、export review metadata、artifact soft delete/delete audit 已完成；剩余为 explicit export format model、生产对象存储 adapter、恶意文件扫描、PDF/DOCX/ZIP、richer approval workflow、artifact version/replace history 和 retention policy。

## Completed Phase: Response Package Version / Comparison Lite

本阶段完成：
- Response Package snapshot 现在在服务层自动生成 `versionNumber`、`previousSnapshotId`、`changeCount` 和相邻版本 `changes`，不新增数据库字段，SQLite/MySQL 读取路径共用同一计算逻辑。
- 第一版 snapshot 标记为 `created`，后续 snapshot 会比较 readiness 摘要、目录项状态变化、目录项关联材料变化。
- `createResponsePackageSnapshot` 返回值和刷新后的 `getResponsePackageWorkspace` 返回值保持一致，避免创建后 UI 和刷新后 UI 版本信息不一致。
- Intent Response Workspace 的最近快照 UI 显示版本号、较上一版变化数量和最多三条具体变化，中英文文案已补齐。
- Response Package export 创建时会用版本化后的 snapshot 读取路径，后续扩展导出 manifest 时可直接使用版本元数据。

验证：
- `npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'`：3 files / 40 tests passed。
- `npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/intents/[id]/page.test.ts' src/lib/api/intents.test.ts src/server/artifacts/service.test.ts src/server/quote-builder/service.test.ts src/server/deadlines/service.test.ts src/server/submission-planner/service.test.ts`：7 files / 78 tests passed。
- `npm test`：228 files / 1,118 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run demo:check`：50/50 states，1,146 active state bids，216 safe local attachment routes，0 placeholder URLs。
- `npm run demo:smoke -- --origin=http://localhost:3015`：8 smoke checks passed。
- `npm run db:migrate`：passed。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:migrate`：50 statements applied，134 skipped。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`：51 tables，response workspace verified=true，attachment verified=true，intent verified=true。
- `npm run risk:check`：50/50 required states，1,146 state bids，216 state attachments，0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Response Package deeper history：完整多版本历史/比较视图、版本化 submission package、richer review history、导出 manifest 展示版本元数据。
2. Production Artifact / Package Storage：真实 AWS/S3 staging validation、CloudFront/signed URL、外部 malware scanning、configurable retention、artifact replace/version flow。
3. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
4. Production Worker / Secrets / Backup：生产类环境执行 crawler、notification/dunning、event outbox worker dry run，并完成 secret manager、备份恢复、webhook rotation 签核。
5. Live Source Health Operations：继续处理外部门户 403/timeout/fetch failed/access challenge，逐步把 beta/fallback 州源提升到 verified。

建议下一步：
- 如果继续本地产品深度，做 Response Package full version history / comparison view；如果切生产主线，优先做真实 AWS/S3 staging smoke 或 Stripe Sandbox E2E。

## Completed Phase: Response Package Full History / Comparison View Lite

本阶段完成：
- `ResponsePackageWorkspace` 新增 `versionHistory` 响应字段，汇总 `totalVersions`、`latestVersionNumber`、`totalChanges` 和全量历史 `entries`。
- `versionHistory` 仍由现有 `response_package_snapshots` 计算生成，不新增数据库字段，不需要 SQLite/MySQL 迁移。
- Intent Response Workspace 的快照区新增版本历史汇总卡片：版本总数、最新版本、变化总数。
- 最近快照列表从固定只显示 3 条，升级为默认显示最近 3 条，并在超过 3 条时支持“查看全部版本 / 收起为最近版本”。
- 每个展开版本仍显示与上一版的变化摘要，形成完整历史列表 + 相邻版本比较的 Lite 视图。

验证：
- `npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'`：3 files / 41 tests passed。
- `npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/intents/[id]/page.test.ts' src/lib/api/intents.test.ts src/server/artifacts/service.test.ts src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts'`：10 files / 97 tests passed。
- `npm test`：228 files / 1,119 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run demo:check`：50/50 states，1,146 active state bids，216 safe local attachment routes，0 placeholder URLs。
- `npm run demo:smoke -- --origin=http://localhost:3016`：8 smoke checks passed。
- `npm run db:migrate`：passed。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:migrate`：50 statements applied，134 skipped。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`：51 tables，response workspace verified=true，attachment verified=true，intent verified=true。
- `npm run risk:check`：50/50 required states，1,146 state bids，216 state attachments，0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。

最新还剩（下一阶段优先级）：
1. Response Package side-by-side comparison：做两个版本之间的逐字段/逐目录差异视图，而不是只显示相邻摘要。
2. Versioned submission package evidence：把提交确认与具体 package version/export version 绑定，形成可追溯提交包。
3. Production Artifact / Package Storage：真实 AWS/S3 staging validation、CloudFront/signed URL、外部 malware scanning、configurable retention、artifact replace/version flow。
4. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
5. Production Worker / Secrets / Backup：生产类环境执行 crawler、notification/dunning、event outbox worker dry run，并完成 secret manager、备份恢复、webhook rotation 签核。

建议下一步：
- 如果继续本地工作流深度，做 Response Package side-by-side comparison；如果切生产主线，做真实 AWS/S3 staging smoke 或 Stripe Sandbox E2E。

## Completed Phase: Response Package Side-by-Side Comparison Lite

本阶段完成：
- `ResponsePackageWorkspace` 新增 `versionComparisons` 和 `defaultVersionComparison`，为所有“旧版本 -> 新版本”组合生成比较摘要。
- 比较项覆盖 readiness、目录状态、目录备注、目录关联材料；默认比较为“上一版 -> 最新版”。
- Intent Response Workspace 新增双版本对比面板，可从所有版本组合里选择任意一组进行 side-by-side 对比。
- 对比 UI 显示源版本、目标版本、差异字段、源值、目标值；无差异时展示空态文案。
- 该能力仍是计算型响应字段，不新增数据库表/列，不影响 SQLite/MySQL 迁移。

验证：
- `npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'`：3 files / 42 tests passed。
- `npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/intents/[id]/page.test.ts' src/lib/api/intents.test.ts src/server/artifacts/service.test.ts src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts'`：10 files / 98 tests passed。
- `npm test`：228 files / 1,120 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run demo:check`：50/50 states，1,146 active state bids，216 safe local attachment routes，0 placeholder URLs。
- `npm run demo:smoke -- --origin=http://localhost:3017`：8 smoke checks passed。
- `npm run db:migrate`：passed。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:migrate`：50 statements applied，134 skipped。
- `DATABASE_URL=mysql://winbids:***@127.0.0.1:3306/winbids npm run db:mysql:smoke`：51 tables，response workspace verified=true，attachment verified=true，intent verified=true。
- `npm run risk:check`：50/50 required states，1,146 state bids，216 state attachments，0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。

最新还剩（下一阶段优先级）：
1. Versioned submission package evidence：把提交确认与具体 package version/export version 绑定，形成可追溯提交包。
2. Response Package richer review history：审核意见时间线、审批人展示、版本/导出关联的 review activity。
3. Production Artifact / Package Storage：真实 AWS/S3 staging validation、CloudFront/signed URL、外部 malware scanning、configurable retention、artifact replace/version flow。
4. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
5. Production Worker / Secrets / Backup：生产类环境执行 crawler、notification/dunning、event outbox worker dry run，并完成 secret manager、备份恢复、webhook rotation 签核。

建议下一步：
- 如果继续本地采购工作流，做 Versioned submission package evidence；如果切生产主线，做真实 AWS/S3 staging smoke 或 Stripe Sandbox E2E。

## Completed Phase: Versioned Submission Package Evidence Lite

本阶段完成：
- `submission_confirmations` 新增 `evidence_snapshot_json`，SQLite/MySQL 迁移路径均覆盖。
- 创建提交确认时会冻结当时可见的 response package exports、snapshot id/title/version、export format/review status、linked supplier artifacts、award outcome 和 capturedAt。
- 提交确认历史现在携带 `evidenceSnapshot`，后续新增响应包导出不会改变旧确认记录的冻结证据。
- Intent Submission confirmation history 展示每条确认绑定的响应包版本、导出格式、审核状态和下载入口。
- Source health ops 小修：snapshot persist 写入使用 `try/finally` 关闭 DB，`source:health:ops` 测试锁定 `--timeout-ms 10000`，runbook 同步当前 deterministic baseline。

验证：
- `npm test -- src/server/submission/service.test.ts src/server/submission/repository.test.ts 'src/app/api/intents/[id]/submission/route.test.ts' 'src/app/api/intents/[id]/submission/confirm/route.test.ts' src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' 'src/app/intents/[id]/page.test.ts' src/lib/api/intents.test.ts src/server/db/schema.test.ts src/server/db/mysql.test.ts scripts/source-health-check.test.ts`：14 files / 130 tests passed。
- `npm test -- scripts/source-health-check.test.ts src/server/risk/checklist.test.ts src/lib/state-crawler-sources.test.ts`：3 files / 21 tests passed。
- `npm run risk:check`：50/50 states，1,146 state bids，1,146 detail routes，216 state attachments，1,147 active bid URLs，0 vulnerabilities。
- `npm run lint`：passed。
- `npm run build`：passed。

最新还剩（下一阶段优先级）：
1. Response Package richer review history：新增 export review event history、审批人展示、版本/导出关联的 review timeline。
2. Production Artifact / Package Storage：真实 AWS/S3 staging validation、CloudFront/signed URL、外部 malware scanning、configurable retention、artifact replace/version flow。
3. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
4. Production Worker / Secrets / Backup：生产类环境执行 crawler、notification/dunning、event outbox worker dry run，并完成 secret manager、备份恢复、webhook rotation 签核。
5. UI/UE Wave 1 polish：修 `/search` 搜索按钮反馈、匿名保存登录引导、移动端 bid detail 按钮/附件溢出和 ResponseWorkspacePanel error state 一致性。

建议下一步：
- 本地继续做 Response Package richer review history；生产主线则并行准备真实 AWS/S3 staging smoke 或 Stripe Sandbox E2E 凭证。

## Completed Phase: Response Package Review History + UI Polish Wave 1

本阶段完成：
- 新增 `response_package_export_review_events` 审核历史表，SQLite schema、SQLite migration、MySQL migration conversion、SQLite/MySQL repository 均覆盖。
- Response package export 继续保留最新 `reviewStatus/reviewedAt/reviewedByUserId/reviewNotes` 摘要字段，同时每次审核追加一条不可覆盖的 review event。
- `ResponsePackageExport` API 响应新增 `reviewHistory`，Intent Response Workspace 的导出卡片现在显示最近审核流转、时间和备注。
- 审核历史已贯通重复审核场景：例如 `pending_review -> needs_changes -> approved` 会保留两条时间线，而旧提交确认冻结证据仍绑定具体 export/snapshot 版本。
- UI Wave 1 支线完成 `/search` 搜索状态反馈、空态/错误/筛选摘要、匿名收藏登录/注册引导，以及 `/bids/[id]` 移动端标题、按钮、附件/证据链接换行溢出修复。
- 搜索状态和匿名保存提示已接入中英文 `t()` 字典，不再硬编码英文。

验证：
- Focused suite：`npm test -- src/server/response-workspace/service.test.ts src/server/response-workspace/repository.test.ts src/server/db/schema.test.ts 'src/app/api/intents/[id]/response-workspace/package/exports/route.test.ts' 'src/app/api/intents/[id]/response-workspace/package/exports/[exportId]/route.test.ts' 'src/app/intents/[id]/page.test.ts' src/app/search/page.test.ts src/components/bids/BidCard.test.ts 'src/app/bids/[id]/page.test.ts'`：10 files / 76 tests passed。
- `npm test`：228 files / 1,125 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run db:migrate`：passed。
- `.env.local` loaded `npm run db:mysql:migrate`：56 statements applied，135 skipped。
- `.env.local` loaded `npm run db:mysql:smoke`：52 tables，response workspace verified=true，migration check 51 applied / 140 skipped。
- `npm run demo:check`：50/50 states，1,146 active state bids，216 safe local state attachment routes，0 placeholder URLs。
- `npm run demo:smoke -- --origin=http://localhost:3019`：8 smoke checks passed。
- `.env.local` loaded `npm run workers:check`：crawler/event/notification checks passed on MySQL runtime.
- `npm run risk:check`：50/50 required states，1,146 detail routes，216 state attachments，1,147 active URLs，0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Production Artifact / Package Storage：真实 AWS/S3 staging validation、CloudFront/signed URL、外部 malware scanning、configurable retention、artifact replace/version flow。
2. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
3. Production Worker / Secrets / Backup：生产类环境执行 crawler、notification/dunning、event outbox worker dry run，并完成 secret manager、备份恢复、webhook rotation 签核。
4. Live Source Health Operations：继续强化真实州级源站 403/timeout/bot-check 巡检、告警和人工 triage runbook。
5. Response Package Review 深化：展示审批人摘要、支持 review policy/approval threshold、导出审核报表。
6. UI/UE Wave 1 剩余小项：ResponseWorkspacePanel error/locked/empty state 一致性、移动端更细粒度视觉回归。

建议下一步：
- 如果继续本地功能深度，做 Production Artifact / Package Storage Lite；如果切生产主线，优先跑 Stripe Sandbox E2E 或 AWS/S3 staging smoke。

## Completed Phase: Production Artifact / Package Storage Lite

本阶段完成：
- Production/staging S3 preflight 进一步 fail-closed：strict S3 posture 要求 private public access、signed URL mode、CloudFront/CDN marker、external malware scanner marker、retention policy、staging smoke evidence URL，并且只输出 configured marker。
- 新增 `artifact_versions`，SQLite schema、SQLite migration、MySQL DDL conversion、schema tests 均覆盖；Artifact Vault 返回每个材料的版本历史。
- 上传材料会创建 v1 version record；替换材料会先跑 malware scan，再写入 object storage，追加新 version，更新当前 manifest，并写 `artifact.replaced` audit metadata。
- 新增 `PUT /api/intents/[id]/artifacts/[artifactId]`，复用现有 auth、feature gate、multipart file 解析和 Artifact Vault 响应结构。
- API client 新增 `replaceSupplierArtifact()`；Intent Artifact Vault UI 显示当前版本/版本数，并提供替换文件、替换原因、替换中状态和成功提示。
- AWS deployment runbook 补齐严格 S3 姿态变量和生产缺口说明；README / next development plan / status doc 同步当前边界。

验证：
- `npm test -- src/server/storage/object-storage.test.ts src/server/operations/production-readiness.test.ts`：2 files / 17 tests passed。
- `npm test -- src/server/db/schema.test.ts src/server/db/mysql.test.ts src/server/artifacts/service.test.ts 'src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts'`：4 files / 28 tests passed。
- `npm test -- src/lib/api/intents.test.ts 'src/app/intents/[id]/page.test.ts' src/server/artifacts/service.test.ts 'src/app/api/intents/[id]/artifacts/[artifactId]/route.test.ts'`：5 files / 59 tests passed。
- `npm test`：228 files / 1,131 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run db:migrate`：passed。
- `.env.local` loaded `npm run db:mysql:migrate`：57 statements applied，140 skipped。
- `.env.local` loaded `npm run db:mysql:smoke`：53 tables，migration check 52 applied / 145 skipped。
- `.env.local` loaded `npm run workers:check`：crawler/event/notification checks passed on MySQL runtime。
- `npm run demo:check`：50/50 states，1,146 active state bids，216 safe local state attachment routes，0 placeholder URLs。
- `npm run demo:smoke -- --origin=http://localhost:3020`：8 smoke checks passed。
- `npm run risk:check`：50/50 required states，1,146 detail routes，216 state attachments，1,147 active URLs，0 vulnerabilities。
- `npm audit --omit=dev --audit-level=high`：0 vulnerabilities。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Real AWS/S3 staging validation：真实 bucket/IAM/Secrets/CloudFront/signed URL/upload/download/delete/head smoke。
2. External malware scanning proof：接入并验收真实扫描边界，不再只依赖 deterministic local/noop seam。
3. Retention/legal hold proof：确认 retention policy id、生命周期规则、备份/恢复和审计保留责任人。
4. Stripe Sandbox E2E：需要真实 `sk_test...`、`whsec...`、Pro/Business price ids，在 MySQL dev/staging DB 上跑 checkout/webhook/portal/cancel。
5. Production Worker / Secrets / Backup、Live Source Health Operations 仍是生产发布并行主线。

建议下一步：
- 进入 Real AWS/S3 staging smoke 或 Stripe Sandbox E2E，取决于外部凭证哪个先就绪。

## Completed Phase: Live Source Health Operations + Demo Smoke Continuation

本阶段完成：
- 按 `2026-06-12-overall-progress-execution-roadmap.md` 继续执行 Track D / Track E 中不依赖外部凭证的部分。
- 运行 50 州 live source-health report-only，并持久化最新 snapshot 给 Admin Data Sources 使用。
- 定位并修复 `ms_state_procurement` 的 stale registry URL：旧 `https://www.dfa.ms.gov/procurement` 返回 HTTP 404；前端 registry 和 crawler registry 已统一到 `https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true`，与现有 Mississippi spider 的 referer/source URL 保持一致。
- 单独重跑 MS live health 后从 HTTP 404 变为 PASS。
- 重跑全州 live health 后当前 MySQL 运行时运营基线为 22/50 healthy、28 unhealthy、0 skipped；剩余均为外部门户运营风险分类，包括 login_required、timeout、forbidden、bot_check、tls_or_network_error、empty_or_placeholder、HTTP 503。
- 修复 `source-health-check --persist` 的 MySQL 化边界：当 `DATABASE_URL` / `MYSQL_DATABASE_URL` 指向 MySQL 时，snapshot 现在写入 MySQL `source_health_snapshots`，而不是只写 SQLite；Admin Data Sources 能读取最新 live-health classification。
- Track E 自动化 smoke 继续通过：匿名公共页、匿名 workspace auth boundary、bid detail API/附件下载、普通用户 auth/settings、普通用户 admin 拒绝、admin reset/login/API、paid gated workspace API 均通过。
- Track E 浏览器级检查完成本轮人工/Browser 辅助验证：匿名桌面/移动端 `/`、`/search`、`/bids/1`、`/settings` 有登录/注册入口且无页面级横向溢出；普通 Free 用户可见 Settings Free locked/upgrade 状态且访问 `/admin` 被拒绝；管理员登录后可见 Admin Operations、风险清单、Data Sources、crawler 操作；Admin source-health `Login required` 过滤显示 14/56 sources 并展示 HTTP/status/evidence snippets。

验证：
- `npm run source:health:check -- --source MS --timeout-ms 10000 --report-only --persist --inspect-body`：1/1 healthy。
- `set -a; source .env.local; set +a; npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body`：report-only completed and persisted to MySQL，22/50 healthy，28 unhealthy，0 skipped。
- `npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts src/server/admin/data-sources-repository.test.ts`：3 files / 21 tests passed。
- `PYTHONPATH=crawler python3 -m pytest crawler/tests/test_state_sources.py crawler/tests/test_state_dedicated_spiders_batch4.py`：23 passed，1 environment warning from urllib3/LibreSSL。
- `npm run demo:smoke -- --origin=http://localhost:3021`：8 smoke checks passed。
- `npm run demo:smoke -- --origin=http://localhost:3022`：8 smoke checks passed。
- `npm run demo:check`：SQLite runtime PASS，50/50 states，1,146 active state bids，216 safe state attachments，0 placeholder URLs。
- `set -a; source .env.local; set +a; npm run demo:check`：MySQL runtime PASS，50/50 states，1,146 active state bids，216 safe state attachments，0 placeholder URLs。
- `npm run risk:check` and `.env.local`-loaded `npm run risk:check`：PASS，50-state/content/detail/attachment/account-tier/source-governance/source-validity/global URL checks passed，0 moderate-or-higher audit vulnerabilities。
- `npm run lint`：passed。
- `npm run build`：passed。
- `git diff --check`：passed。
- `npm test -- src/app/search/page.test.ts 'src/app/bids/[id]/page.test.ts' 'src/app/intents/[id]/page.test.ts' src/app/settings/page.test.ts src/app/admin/page.test.ts src/app/page.test.ts src/components/bids/BidCard.test.ts`：9 files / 48 tests passed。

最新还剩（下一阶段优先级）：
1. Track D continued：对 28 个 live unhealthy source 做运营 triage，优先 repeated `login_required`、`bot_check`、`timeout`、`forbidden`；从生产类网络复跑并给每类风险标 owner/disposition/next review date。
2. Track E continued：本轮 Browser 辅助 walkthrough 已完成；下一步如果继续 UI 质量门禁，应补自动化截图/视觉回归 harness，并补 `/intents/<real intent id>` 的更深移动端截图检查。
3. Track A：真实 AWS/S3 staging validation、CloudFront/signed URL、external malware scanner、retention lifecycle proof。
4. Track B：Stripe Sandbox E2E 仍等待真实 `sk_test...`、`whsec...`、Pro/Business price ids。
5. Track C：Production Worker / Secrets / Backup dry run 仍等待生产类环境和 owner/evidence 变量。

建议下一步：
- 如果仍没有 AWS/Stripe 凭证，继续 Track D 的运营 triage 和 Track E 的浏览器级 UI/UE 检查；如果凭证就绪，切到 Track A 或 Track B。

## Completed Planning Phase: Multi-Agent Production Readiness And Depth Planning

本阶段完成：
- 按 superpowers `dispatching-parallel-agents` / `subagent-driven-development` / `writing-plans` 流程启动四条只读 agent 轨道。
- Agent A 完成 AWS/S3/RDS/worker/backup/secrets 外部生产验证分析。
- Agent B 完成 Stripe/商业化/tier/paid gate 分析。
- Agent C 完成 50 州 source-health/live portal 运营风险分析。
- Agent D 完成 UI/UE、workflow governance、AI/Enterprise depth 分析。
- 新增总控执行计划：`docs/superpowers/plans/2026-06-12-multi-agent-production-readiness-and-depth-plan.md`。

下一批推荐 worker：
1. Worker 1 + Worker 2：Source-health triage data layer + Admin triage UI。
2. Worker 3：Source-health weekly/release report export。
3. Worker 5：Browser demo evidence harness。
4. Worker 6：Response Package governance lite。
5. Worker 4：Billing local hardening。

外部凭证/环境就绪时优先切换：
1. AWS/S3/RDS staging signoff。
2. Stripe Sandbox E2E。
3. Production worker/secrets/backup dry run。

## Completed Phase: Source Health Triage Queue Batch 1

本阶段完成：
- 按 `2026-06-12-multi-agent-production-readiness-and-depth-plan.md` 启动 Worker 1 / Worker 2 并完成本地可实现的 source-health triage 队列第一批。
- `data_sources` 新增 source-health triage 字段：`liveHealthOwner`、`liveHealthDisposition`、`liveHealthNextReviewAt`、`liveHealthNotes`、`liveHealthReviewedAt`。
- SQLite / MySQL schema、迁移、Admin repository、Admin Data Sources PATCH API 均支持这些字段。
- Admin/operator 可更新运营 triage 字段；source legal/use approval governance 仍保持 admin-only。
- `liveHealthNotes` 在服务层做轻量 credential-like redaction，避免明显 password/token/secret/api key 进入持久化备注。
- Admin Data Sources 的 live health 区域新增 Health triage 面板，显示 owner、disposition、next review、reviewed at、notes。
- Admin UI 新增 unassigned / overdue / review scheduled / reviewed 状态，以及 assign review、accept fallback、manual path、vendor account、clear triage quick actions。
- 修复 build 发现的 MySQL risk-check mapper 接缝：新增 triage 列后，风险检查的 MySQL data source row 映射同步补齐。

验证：
- `npm test -- src/server/admin/data-sources-repository.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/db/schema.test.ts`：31 passed。
- `npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx`：11 passed。
- `npm test -- src/lib/api/admin.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/admin/data-sources-repository.test.ts`：48 passed。
- `npm test -- src/server/risk/checklist.test.ts`：8 passed。
- `npm run db:migrate`：passed。
- `set -a; source .env.local; set +a; npm run db:mysql:migrate`：passed，52 statements applied / 150 skipped。
- `npm run risk:check`：PASS，50/50 states、1,146 state bids、1,146 detail routes、216 state attachments、0 vulnerabilities。
- `npm run lint`：passed。
- `npm run build`：passed。
- `git diff --check`：passed。
- Browser 辅助验证 `/admin`：Data Sources、Health triage、Assign review、Accept fallback、Manual path、Vendor account、Clear triage 均出现；无 runtime error；1280px 无页面级横向溢出。

最新还剩（下一阶段优先级）：
1. Worker 3：Source-health report export，读取最新 DB snapshot 输出 JSON/CSV/Markdown，用 owner/disposition/next-review 形成 weekly/release handoff。
2. Worker 5：Browser demo evidence harness，自动化桌面/移动核心页面证据，不再只靠人工 Browser walkthrough。
3. Worker 6：Response Package governance lite，补 review governance reporting 和 submit readiness summary。
4. Worker 4：Billing local hardening，继续扩 sandbox helper、checkout/portal/cancel/webhook/tier regression。
5. 外部 Track A/B/C：真实 AWS/S3/RDS staging、Stripe Sandbox E2E、Production worker/secrets/backup dry run 仍等待真实外部环境/凭证。

建议下一步：
- 没有 AWS/Stripe 凭证时，启动 Worker 3 Source-health report export；如果 Stripe test keys 或 AWS access 先准备好，则切换到对应 external track。

## Completed Phase: Source Health Report Export

本阶段完成：
- 按 `2026-06-12-multi-agent-production-readiness-and-depth-plan.md` 完成 Worker 3。
- 新增 `npm run source:health:report`。
- 新增 `frontend/scripts/source-health-report.ts`，可从当前 DB runtime 的最新 persisted `source_health_snapshots` 生成运营报告。
- 支持 `--format=markdown|json|csv`，默认 markdown；支持 `--output=<path>` 写文件。
- 报告不会触发 live source probe，不会访问公共门户，只读取 SQLite 或 MySQL 当前 runtime。
- 报告包含 summary、unhealthy classification counts、owner/disposition/next-review、trend/current streak、healthy percentage、recommended action、operational severity。
- 报告输出前会清洗长 HTML、credential-like assignments、Bearer token 和 URL secrets，避免 raw portal URL query/fragment、evidence snippets、外部附件 URL secrets 泄露到运营报告。
- 更新 `docs/operations/source-health-check.md`，加入 report export 使用说明、导出字段、安全边界和运营交接方式。

验证：
- `npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts`：2 files / 16 tests passed。
- `npm run source:health:report -- --format=markdown --output /tmp/winbids-source-health-report.md`：passed，SQLite report 50 total / 20 healthy / 30 unhealthy / 0 skipped。
- `npm run source:health:report -- --format=json --output /tmp/winbids-source-health-report.json`：passed。
- `npm run source:health:report -- --format=csv --output /tmp/winbids-source-health-report.csv`：passed。
- `set -a; source .env.local; set +a; npm run source:health:report -- --format=json --output /tmp/winbids-source-health-report.mysql.json`：passed，MySQL report 50 total / 22 healthy / 28 unhealthy / 0 skipped。
- Sanitization scan on generated reports found no `raw-password`、`raw-token`、`<html`、raw example attachment URL、Bearer token、`token=` or `password=` matches.
- `npm run risk:check`：PASS，50/50 states、1,146 state bids、1,146 detail routes、216 attachments、0 vulnerabilities。
- `npm run lint`：passed。
- `npm run build`：passed。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Worker 5：Browser demo evidence harness，自动生成桌面/移动核心页面证据，覆盖 anonymous/free/admin/paid 关键路径。
2. Worker 6：Response Package governance lite，补 pending/approved/needs_changes 汇总、longest pending age、last reviewer、submit readiness。
3. Worker 4：Billing local hardening，扩 Stripe sandbox helper、checkout/portal/cancel/webhook/tier regression。
4. 外部 Track A/B/C：真实 AWS/S3/RDS staging、Stripe Sandbox E2E、Production worker/secrets/backup dry run。

建议下一步：
- 没有 AWS/Stripe 凭证时，启动 Worker 5 Browser demo evidence harness；如果更看重采购 workflow 深度，也可以先启动 Worker 6。

## Completed Phase: Source Health Evidence Bundle And Live Probe Refresh

本阶段完成：
- 新增 `npm run source:health:evidence`。
- 新增 `npm run source:health:triage`。
- 新增 `frontend/scripts/source-health-evidence.ts` 和 `frontend/scripts/source-health-evidence.test.ts`。
- 新增 `frontend/scripts/source-health-triage.ts` 和 `frontend/scripts/source-health-triage.test.ts`。
- Evidence bundle 读取当前 shell runtime 的最新 persisted `source_health_snapshots`，不主动访问公共门户。
- Evidence bundle 检查 50 州覆盖、snapshot stale 状态、unhealthy 总数、critical/warning unhealthy、缺 owner、缺 disposition、缺 next-review、overdue next-review。
- Evidence bundle 输出 Markdown/JSON，包含 blocker list、classification counts、high-priority source queue、建议命令，并清洗 credential-like 内容。
- Triage bulk assignment 默认 dry-run，`--apply` 后才写入当前 DB runtime；默认只补 unhealthy sources 缺失的 owner/disposition/next-review，可用 `--all-unhealthy` 覆盖已有 triage。
- Triage bulk assignment 根据 live classification/recommended action 自动映射 disposition：timeout -> `retry_with_longer_timeout`，login_required -> `vendor_account_review`，bot_check/forbidden -> `browser_access_review`，empty -> `parser_or_access_review`，TLS/network -> `network_or_tls_review`，HTTP error -> `portal_status_review`，registry/base-url action -> `registry_url_review`。
- `ops:launch-handoff` 的 Live Source Health track 已接入 `source:health:evidence`，并支持 `SOURCE_HEALTH_OPS_EVIDENCE_URL` 或 `SOURCE_HEALTH_OPS_EVIDENCE_FILE`。
- 更新 `docs/operations/source-health-check.md`、`docs/operations/aws-deployment-runbook.md`、`frontend/README.md`、`winbids-next-development-plan.md`。
- 重新跑了 50 州真实 live source-health：`npm run source:health:ops`。

验证：
- `npm test -- scripts/source-health-evidence.test.ts`：1 file / 5 tests passed。
- `npm test -- scripts/source-health-triage.test.ts`：1 file / 5 tests passed。
- `npm test -- scripts/source-health-evidence.test.ts scripts/source-health-check.test.ts src/server/operations/launch-handoff.test.ts`：3 files / 22 tests passed。
- `npm run source:health:ops`：completed，latest snapshot `source_health_e35096d6-4084-4146-87bc-21529faeeed5`，checked at `2026-06-13T08:00:33.652Z`。
- 最新 live result：50 total / 21 healthy / 29 unhealthy / 0 skipped。
- 最新 unhealthy classification counts：11 `login_required`，6 `timeout`，5 `forbidden`，3 `bot_check`，2 `tls_or_network_error`，1 `empty_or_placeholder`，1 `http_error`。
- `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.after.json`：passed，snapshot age under 1 hour，50/50 observed state sources，0 critical unhealthy。
- `npm run source:health:triage -- --owner=source-ops@winbids.local --format=json --output=/tmp/winbids-source-health-triage.dry.json`：dry-run planned 29 updates / 21 skipped。
- `npm run source:health:triage -- --owner=source-ops@winbids.local --apply --format=json --output=/tmp/winbids-source-health-triage.apply.json`：applied 29 updates。
- `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.post-triage.json`：passed with `ok=true`，50/50 observed state sources，0 critical unhealthy，0 unassigned unhealthy，0 missing disposition，0 missing next-review，0 overdue next-review。
- `npm run source:health:report -- --format=markdown --output=/tmp/winbids-source-health-report.after.md`：passed，report 读取最新 SQLite snapshot。
- `npm run source:health:evidence -- --allow-blocked --format=json --output=../ops-evidence/source-health/source-health-evidence.json`：生成本地 Git-ignored evidence file。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json`：live source-health track returned `ready`; launch handoff now reads and validates the local evidence JSON instead of accepting a path-only marker。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json SOURCE_HEALTH_ACCESS_REVIEW_FILE=../ops-evidence/source-health/source-health-access-review.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json`：live source-health track returned `ready`; launch handoff now also requires access-review URL/file and validates local access-review JSON for review coverage, `reviewMode`, and `requiredEvidence`。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json`：生成本地 Git-ignored access review packet；29/50 sources need follow-up, grouped as 8 `browser_access`, 11 `vendor_account`, 6 `long_timeout_retry`, 2 `network_tls`, 1 `portal_status`, and 1 `parser_or_access`。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --format=markdown --output=../ops-evidence/source-health/source-health-access-review.md`：passed。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --mode=browser_access,vendor_account --format=csv --output=../ops-evidence/source-health/source-health-access-review.browser-vendor.csv`：passed。
- `npm test -- scripts/source-health-access-review.test.ts`：1 file / 4 tests passed。
- `npm test -- src/server/operations/launch-handoff.test.ts`：1 file / 7 tests passed。
- `npm test -- src/server/operations/launch-handoff.test.ts scripts/source-health-access-review.test.ts scripts/source-health-evidence.test.ts scripts/source-health-triage.test.ts scripts/source-health-check.test.ts`：5 files / 35 tests passed。
- `npm test -- scripts/source-health-access-review.test.ts scripts/source-health-evidence.test.ts scripts/source-health-triage.test.ts scripts/source-health-check.test.ts src/server/operations/launch-handoff.test.ts`：5 files / 33 tests passed。
- `npm test -- src/server/operations/launch-handoff.test.ts scripts/source-health-evidence.test.ts scripts/source-health-triage.test.ts scripts/source-health-check.test.ts`：4 files / 29 tests passed。
- `npm test`：233 files / 1,183 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `npm run risk:check`：PASS；50/50 required states, 1,146 state bids, 216 state attachments, account-tier separation, source governance, source metadata, and URL validity all passed；`npm audit --omit=dev --audit-level=moderate` found 0 vulnerabilities。
- `git diff --check`：passed。

最新还剩（下一阶段优先级）：
1. Track D continued：从生产类网络或目标 AWS runner 复跑 `source:health:ops`，把本地网络风险与生产网络风险区分开。
2. Track D continued：对 access-review packet 中的 29 个 follow-up source 做浏览器或 vendor-account 验证，必要时升级 beta/fallback/manual-review source 策略。
3. External Track A/B/C：真实 AWS/S3/RDS staging、Stripe Sandbox E2E、Production worker/secrets/backup dry run 仍等待真实外部环境/凭证。

建议下一步：
- 继续 Track D：从生产类网络复跑 source-health evidence/triage 流程，或切到 External Track A/B/C 做 AWS/Stripe/worker 真实环境验证。

## Completed Phase: Source Health Safe URL Evidence

本阶段完成：
- Track D 继续补强运营证据可执行性：`source:health:report`、`source:health:evidence`、`source:health:access-review` 现在都会在相关 source 行中携带安全源站 URL。
- 安全 URL 只允许 HTTP(S)，并会移除 username、password、query string、fragment；保留源站 origin/path，方便 source ops 直接核验 29 个 follow-up source。
- Access-review packet 的 Markdown/JSON/CSV 输出新增 `source URL` / `source_url` 字段，浏览器验证、vendor-account 验证、timeout/network 复核时不再需要回查 registry。
- Evidence bundle 的 high-priority source queue 新增安全 URL，launch handoff 附件更适合外部审查。
- 更新 `docs/operations/source-health-check.md` 和 `frontend/README.md`，明确安全 URL 输出边界与“不存凭证、不输出 raw query/fragment”的规则。

验证：
- `npm test -- scripts/source-health-check.test.ts`：1 file / 14 tests passed。
- `npm test -- scripts/source-health-access-review.test.ts`：1 file / 4 tests passed。
- `npm test -- scripts/source-health-evidence.test.ts`：1 file / 5 tests passed。
- `npm test -- scripts/source-health-check.test.ts scripts/source-health-access-review.test.ts scripts/source-health-evidence.test.ts scripts/source-health-triage.test.ts src/server/source-validity/live-source-health.test.ts src/server/source-validity/health-snapshots.test.ts src/server/operations/launch-handoff.test.ts`：7 files / 43 tests passed。
- `npm test`：233 files / 1,183 tests passed。
- `npm run lint`：passed。
- `npm run build`：passed。
- `git diff --check`：passed。
- Generated `/tmp/winbids-source-health-report.safe-url.json`、`/tmp/winbids-source-health-evidence.safe-url.json`、`/tmp/winbids-source-health-access-review.safe-url.json` and scanned them: report 50 safe URL fields, evidence 25 safe URL fields, access-review 29 safe URL fields, 0 unsafe URL/query or credential assignment matches.
- `npm run source:health:ops`：completed，persisted snapshot `source_health_cf0ede1c-10f1-4863-bb90-fde92c10c3ee` checked at `2026-06-24T01:52:31.691Z`；latest live result 50 total / 21 healthy / 29 unhealthy / 0 skipped。
- Latest unhealthy classification counts：12 `login_required`，5 `timeout`，5 `forbidden`，3 `bot_check`，2 `tls_or_network_error`，1 `empty_or_placeholder`，1 `http_error`。
- `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.2026-06-24.json`：before triage refresh found 29 overdue next-review rows。
- `npm run source:health:triage -- --owner=source-ops@winbids.local --all-unhealthy --apply --format=json --output=/tmp/winbids-source-health-triage.2026-06-24.apply.json`：refreshed all 29 unhealthy-source triage rows。
- `npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.2026-06-24.post-triage.json`：passed with `ok=true`，50/50 observed state sources，0 critical unhealthy，0 unassigned unhealthy，0 missing disposition，0 missing next-review，0 overdue next-review。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --format=json --output=/tmp/winbids-source-health-access-review.2026-06-24.post-triage.json`：29/50 follow-up sources，grouped as 8 `browser_access`，12 `vendor_account`，5 `long_timeout_retry`，2 `network_tls`，1 `portal_status`，1 `parser_or_access`。
- Post-triage generated evidence/access-review JSON/CSV scan：evidence 25 safe URL fields，access-review JSON 29 safe URL fields，access-review CSV 29 safe URL-like entries，0 unsafe URL/query or credential assignment matches。
- `SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json SOURCE_HEALTH_ACCESS_REVIEW_FILE=../ops-evidence/source-health/source-health-access-review.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json`：Live Source Health Operations track returned `status=ready`，handoff scan found 0 unsafe URL/query or credential assignment matches。

最新还剩（下一阶段优先级）：
1. Track D continued：从生产类网络或目标 AWS runner 复跑 `source:health:ops`，把本地网络风险与生产网络风险区分开。
2. Track D continued：用新 access-review 安全 URL 队列逐项处理 29 个 follow-up source，产出 browser/vendor-account/timeout/network 复核证据。
3. Track D continued：根据复核结果升级 source 策略：official verified、beta、fallback、manual-review、vendor-account required 或 hold。

建议下一步：
- 继续 Track D：生成最新 access-review JSON/CSV，按 review mode 分组处理 29 个 follow-up source；如果有 AWS runner 可用，则优先从生产类网络复跑 `source:health:ops`。

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
