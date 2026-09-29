# Data Source Compliance Ledger

## Purpose

APSi's crawler ingests bid data from ~50 state procurement portals plus SAM.gov. Before any source is used in production, it needs a recorded legal/compliance review: has someone checked the portal's Terms of Service (ToS) and robots.txt, and is there a documented basis for crawling it?

This document defines the compliance ledger: what fields exist, what "approved" requires, who signs off, and how the ledger is tracked. It also defines the automated robots.txt pre-check tool that feeds triage signal into the ledger.

**This tooling supports the legal review process. It does not replace it.** No script in this repository can determine whether crawling a given state portal is legally permissible. That determination requires a human (ideally with legal input) to read the portal's Terms of Service and robots.txt and record a decision. Everything described below exists to make that human review trackable, auditable, and repeatable — not to automate it away.

## Where the ledger lives

The ledger is the `data_sources` table (Drizzle schema: `frontend/src/server/db/schema.ts`, export `dataSources`), extended in this pass with compliance-specific columns:

| Column | Type | Meaning |
|---|---|---|
| `robots_txt_status` | text | Latest automated robots.txt scan result: `clear`, `disallow_all`, `disallow_crawled_paths`, `not_found`, `unreachable`, `unknown`. Set only by the automated scan tool, never by a human. |
| `robots_txt_checked_at` | text (ISO datetime) | When the automated scan last ran for this source. |
| `robots_txt_hash` | text | SHA-256 hash of the fetched robots.txt body, for change detection between scans. |
| `robots_txt_disallows_crawled_paths` | integer (boolean) | Whether the scan found a Disallow rule overlapping APSI's crawled paths. |
| `robots_txt_flag_reason` | text | Human-readable reason the scan flagged this source, if any. |
| `tos_reviewed` | integer (boolean) | **Human-entered.** Whether a person has read this source's Terms of Service (or confirmed none exists / none applies) and recorded a decision. |
| `tos_reviewed_at` | text (ISO datetime) | When the ToS review was last recorded. Auto-stamped when any compliance ledger field changes, unless explicitly provided. |
| `tos_url` | text | **Human-entered.** URL of the ToS document that was reviewed, if one exists. |
| `compliance_reviewer` | text | **Human-entered.** Name or identifier of the person who performed the review. |
| `legal_opinion_reference` | text | **Human-entered.** Reference/link to a legal opinion, ticket, or memo backing the decision, if one was produced. Not required for every source (see "Approval tiers" below), but required for any source flagged by the robots.txt scan or otherwise ambiguous. |
| `compliance_review_due_at` | text (ISO datetime) | **Human-entered.** Next scheduled re-review date (ToS terms and robots.txt can change). |
| `compliance_notes` | text | **Human-entered.** Free-text notes: caveats, rate-limit agreements, contact info for the portal owner, etc. |

These sit alongside the pre-existing governance columns on the same table (`approval_status`, `legal_review_status`, `approved_for_ingestion`, `source_owner`, `approval_notes`, `access_pattern`) and the audit trail table `source_approval_events`. The compliance ledger fields are a more specific, legally-focused layer on top of that existing governance layer — they do not replace it. `legal_review_status` (`approved_public` / `not_reviewed` / `restricted`) remains the coarse-grained gate used elsewhere in the product (e.g. default governance metadata in `frontend/src/lib/state-crawler-sources.ts`); the new fields make the *evidence* behind that status auditable.

Every write to a compliance ledger field through the Admin API goes through the same code path as the existing governance fields (`updateAdminDataSource` / `updateAdminDataSourceFromMysql` in `frontend/src/server/admin/data-sources-repository.ts`), gated behind `admin`-role access, and stamps `last_approval_reviewed_at`. There is currently no separate structured audit-event row per compliance-field change (unlike `source_approval_events` for approval status changes) — `compliance_notes` and `tos_reviewed_at` are the change record. If per-field audit history becomes necessary, extend `source_approval_events` or add a sibling `source_compliance_events` table following the same pattern, rather than inventing a new mechanism.

### 平台审查（`platform_reviews`）

上面的逐源台账记录"这个源的证据"。整批接入同一个平台的几百个源时，服务条款与 robots.txt 其实是**平台一级**的事实——同一份条款、同一个主机——所以阶段 3（设计稿 `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` §7.1）在 `data_sources` 之上加了第二层：`platform_reviews` 表（Drizzle 导出 `platformReviews`，`frontend/src/server/db/schema.ts`；表定义在 `migrate.ts` 的第一个 `sqlite.exec` 块里，MySQL 的 DDL 由它派生），一行 = "某平台在某天被审查过一次"。带台账的批量批准把这一行**复制**进每个被批准源自己的台账列，所以 `data_sources` 仍是台账唯一的读取面：管理端徽标与 `source:compliance:report` 都不用改。操作步骤见[县/市级数据源的治理拦截、前置检查与批准](./local-source-approval.md#8-批量接入阶段-3)第 8 节。

**列。**

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `id` | text，主键 | `prv_<uuid>` |
| `provider_family` | text | 平台，对应 `data_sources.provider_family`（小写 slug，如 `bidnet`） |
| `tos_url`、`tos_reviewed_at` | text | 被审查的服务条款地址；通读日期 |
| `robots_url`、`robots_checked_at`、`robots_summary` | text | robots.txt 地址、取得时间、一行摘要（经 crawler 的 `fetch-robots` 取得） |
| `access_boundary` | text | 访问边界；省略即写入固定句：`只读公开列表与详情页；不登录、不取会员内容、不绕 WAF` |
| `reviewer` | text | 复核人 |
| `legal_opinion_reference` | text，可空 | 法务意见/工单号 |
| `reviewed_at`、`next_review_at` | text | 审查日期；下次复核日期（创建时必须晚于 `reviewed_at`） |
| `notes` | text，可空 | 备注 |
| `created_by`、`created_at` | text | 建立者的用户 id（本地 bypass 下为空）；写入时刻 |

除 `legal_opinion_reference`、`notes`、`created_by` 外都非空。索引 `idx_platform_reviews_family_reviewed`（`provider_family, reviewed_at`）。

**有效审查规则。** 一个平台的有效审查是它 `reviewed_at` 最新的那一行：`next_review_at` 在当前时刻之后为 `valid`，否则为 `expired`（最新一行到期了，更早的未到期行不会顶上）；没有任何一行为 `missing`。**续期 = 再建一行**，旧行留作历史，没有 PATCH 与删除。只有 `admin` 角色能建（`POST /api/admin/platform-reviews`）；`admin` / `operator` / `support` 都能读（同一路径的 `GET`，返回审查列表和每个平台的有效审查）。`expired` 或 `missing` 时，该平台的本地源不能再被批量批准；已批准的源照常运行（爬虫门禁读的是每个源自己的治理列，不读平台审查）。

**批量批准怎么复制台账。** `POST /api/admin/data-sources/batch`（`action: "approve"`）对每个通过三项检查的本地源，把平台审查的字段写进该源的台账。它与手工批准表单走同一条 `updateAdminDataSource` 路径，值**覆盖**行里原有的值：

| 被批准源的列（`data_sources`） | 取自 |
| --- | --- |
| `compliance_reviewer` | 平台审查的 `reviewer` |
| `tos_url` | `tos_url` |
| `tos_reviewed`、`tos_reviewed_at` | 固定为 `1`；`tos_reviewed_at`（平台条款的通读日期，不是批准时刻） |
| `legal_opinion_reference` | `legal_opinion_reference`（可为空） |
| `compliance_review_due_at` | `next_review_at` |
| `approval_status`、`legal_review_status`、`approved_for_ingestion`、`is_enabled` | 固定：`approved`、`approved_public`、`1`、`1` |
| `approval_notes` | `依据平台审查 #<平台审查 id>；预检 <ready 或 empty> @<预检时间>` |
| `last_approval_reviewed_at`；`source_approval_events` 一行 | 写入时自动生成（`action = 'approved'`，`reason` 即 `approval_notes`） |
| `compliance_notes`、`robots_txt_*` | 不复制：前者保持原值，后者由各源自己的预检写入 |

三项检查（该平台有 `valid` 的平台审查；`live_health_disposition` 为 `ready` / `empty` 且 `live_health_reviewed_at` 不超过 14 天；预检记录的 `precheck.baseUrl` 等于当前 `base_url`）任一不满足，该源被跳过并给出原因，什么都不写。被人暂缓、已停用、需登录而审查缺法务参考、已排队重新预检，或预检之后发生过失败或治理变更的源同样跳过（[本地源批准](./local-source-approval.md) 8.7）。

**与上面 "What 'approved' requires" 四条的关系。**

1. 第 1 条（`tos_reviewed = true` 且有具名复核人）：由上表复制满足，复核人与 ToS 日期来自平台审查。
2. 第 2 条（robots.txt 结果不是 `disallow_*`）：批量批准的三项检查**不读逐源的 `robots_txt_status`**；平台审查的 `robots_summary` 是同一主机的平台级陈述，每个源的预检仍把自己的 robots 结果写进 `robots_txt_*`。
3. 第 3 条（复核到期日是真实的未来日期）：`compliance_review_due_at` = `next_review_at`；创建时要求它晚于 `reviewed_at`，批准时要求该审查仍是 `valid`。
4. 第 4 条（robots 被标记或无法访问过的源必须有法务参考）：`legal_opinion_reference` 原样复制，审查没有就为空。硬性要求只对 `requires_login = 1` 的源生效（单源表单 / PATCH 与联邦、州级的通用批准缺复核人、法务参考或 ToS 复核 → 400 `APPROVAL_REQUIREMENTS_UNMET`；带台账的批量批准遇到平台审查缺法务参考的这类本地源，不报错，跳过并记 `login_requirements_unmet`）；"逐源 robots 被标记过"这种情形批量路径不拦——批准前用下面的查询看一眼分布，有异常的源改走单源批准表单。

```sql
SELECT robots_txt_status, COUNT(*) FROM data_sources
 WHERE provider_family = 'bidnet' AND jurisdiction_level IN ('county','city','township')
   AND (approval_status IS NULL OR approval_status = 'needs_review')
 GROUP BY 1;
```

**审计。** 每次创建平台审查写一条审计事件 `platform_review.created`（`event_log`，`source = 'audit'`，`retention_class = 'audit'`，`target_type = 'platform_review'`，`target_id` 是审查 id，`before_after_json` 里的 `after` 是整行）。批量批准写的是每个源自己的 `source_approval_events`，`approval_notes` 与它的 `reason` 里都带着平台审查 id，所以一个批量批准的源可以追溯到产生它的那一行审查。这让批量批准的台账有了出处，但不是逐字段历史：下面 "Known gaps" 第 4 条对手工 PATCH 的编辑仍然成立。

**续期与到期。** 到期前建新的一行即可；到期后批量批准停止，已批准的源照常运行。但它们各自的 `compliance_review_due_at` 是批准时复制的旧日期，续期平台审查**不回写**它们，而批量批准对已批准的源只会答 `already_approved`——目前没有批量续期入口，需要逐个 `PATCH /api/admin/data-sources/<id>` 更新 `complianceReviewDueAt`。

## What "approved" requires

A source is considered **ledger-approved** for production crawling only when **all** of the following are true:

1. `tos_reviewed = true`, recorded by a named human reviewer (`compliance_reviewer` is set).
2. The most recent robots.txt scan (`robots_txt_status`) is not `disallow_all` or `disallow_crawled_paths` — or, if it is, there is an explicit `legal_opinion_reference` documenting why crawling proceeds anyway (e.g. a negotiated agreement, a public-records-law basis, or a determination that the disallowed path isn't actually crawled).
3. `compliance_review_due_at` is set to a real future re-review date (recommended: 12 months out, or sooner if the portal's ToS changes frequently or the source is high-risk).
4. For any source where `robots_txt_status` was ever `disallow_all`, `disallow_crawled_paths`, or `unreachable` at time of review, `legal_opinion_reference` is required, not optional.

A "clear" automated robots.txt scan result is a favorable signal, not a substitute for step 1. **Every source requires a recorded ToS review before first production crawl, regardless of what the robots.txt scan says.** robots.txt governs crawler behavior; it says nothing about the legal terms under which the site's data may be used, stored, or redistributed — that's what the ToS review is for.

## Who signs off

- **Data Ops / Source Ops** (see `docs/operations/source-health-check.md` for the parallel operational-health ownership model) is responsible for running the automated robots.txt pre-check and keeping `robots_txt_*` fields current.
- **A named human reviewer** (recorded in `compliance_reviewer`) is responsible for reading the ToS and recording the `tos_reviewed` decision. This does not need to be a lawyer for straightforward public-portal cases, but:
- **Legal / outside counsel** review and a `legal_opinion_reference` are required whenever: the robots.txt scan flagged the source, the ToS contains an anti-scraping/anti-automated-access clause, the portal requires a login or vendor account, or the source is otherwise ambiguous.
- **Product/Engineering leadership** signs off on the overall go/no-go to enable a source for production ingestion, referencing the ledger state at the time of the decision (this can be a launch checklist entry, not a new tool).

None of these roles are filled by this tooling. The tooling's job ends at "here is the current signal and the current recorded human decision, side by side, for every source."

## Automated robots.txt pre-check

`frontend/scripts/source-compliance-scan.ts` fetches `robots.txt` for each active state source's base URL, computes a SHA-256 hash of the body, and flags sources whose robots.txt:

- Disallows all paths (`Disallow: /` under an applicable user-agent block), or
- Disallows a path that overlaps with paths APSI is known to crawl (bid listings, search, procurement, opportunity, API paths — see `DEFAULT_CRAWLED_PATH_HINTS` in `frontend/src/server/source-validity/robots-compliance-scan.ts`).

This is a **triage signal, not a legal determination**:

- It does not parse or evaluate Terms of Service text at all.
- Its robots.txt parser is intentionally minimal (no `Allow` precedence resolution, simple substring path matching) — good enough to flag likely-restrictive sources for human attention, not good enough to be treated as a compliance engine.
- A "clear" result only means the scanner didn't find an obvious blanket or path-specific disallow rule. It does not mean the source is approved, and it does not stand in for the required ToS review.

### Running it

```bash
cd frontend
npm run source:compliance:scan -- --all --timeout-ms 10000 --report-only
npm run source:compliance:scan -- --source CA --report-only
npm run source:compliance:scan -- --all --persist
npm run source:compliance:ops   # persist + report-only alias for scheduled/operator runs
```

Options mirror `source:health:check` (see `docs/operations/source-health-check.md` for the parallel tool): `--source` (repeatable), `--timeout-ms`, `--persist`/`--write-snapshot`, `--report-only`, `--json`, `--help`.

`--persist` writes a snapshot row to `source_compliance_snapshots` (SQLite or MySQL, following the same runtime-detection pattern as `source_health_snapshots`). It does **not** write to the per-source `data_sources.robots_txt_*` columns automatically — that sync step is intentionally left as an explicit follow-up (see "Known gap" below) so that a robots.txt scan alone can never silently change a source's ledger state.

### Reading the ledger report

```bash
cd frontend
npm run source:compliance:report -- --format=markdown
npm run source:compliance:report -- --format=json --output reports/source-compliance.json
npm run source:compliance:report -- --format=csv --output reports/source-compliance.csv
```

`source-compliance-report.ts` reads the latest persisted `source_compliance_snapshots` row plus the current `data_sources` ledger fields and produces a combined per-source view: robots.txt status/flag reason from the last scan, alongside the human-entered ToS review fields. It does not call any public portal.

## Admin UI

The source detail page (`/admin/sources/[id]`, "Precheck & approval" tab, opened from the source list at `/admin/sources`) shows a "Compliance ledger" card per source (`frontend/src/components/admin/sources/SourceComplianceCard.tsx`) next to the approval readiness and the approval pre-check: robots.txt status badge, ToS-reviewed badge, flag reason (if any), reviewer, legal opinion reference, next review due date, and the latest approval events. The source list itself shows only the coarse approval state (approved / awaiting / blocked). Updates to these fields go through `PATCH /api/admin/data-sources/[id]`, gated to `admin`-role users (the same gate as the existing approval-status fields, since compliance sign-off is at least as sensitive).

## Cadence

- **Before enabling any new source for production crawling**: run the robots.txt scan for that source, then require a human ToS review and `compliance_reviewer` entry before setting `approved_for_ingestion = true`.
- **Quarterly**: re-run `npm run source:compliance:ops` across all active sources to catch robots.txt changes (hash comparison via `robots_txt_hash` makes silent changes visible).
- **On `compliance_review_due_at` expiry**: re-review the ToS for that source; portals do change their terms.
- **Whenever a source is escalated from beta to production-critical, or a state portal switches to a login-required or vendor-account access pattern**: treat as a new source for compliance purposes and re-run the full review.

## Known gaps / explicit human follow-ups

1. **Actual legal review and ToS sign-off for each of the ~50 state sources (plus SAM.gov) is a real legal task outside the scope of what this code can determine.** As of this writing, none of the `tos_reviewed`, `compliance_reviewer`, or `legal_opinion_reference` fields have been populated for any source — the schema and tooling exist, but the review itself has not been performed. This is the single largest follow-up from this workstream and should be tracked as its own project, likely involving outside counsel, before the affected sources are relied upon commercially at scale.
2. **The robots.txt scan does not automatically write back to `data_sources.robots_txt_*`.** Today it only persists to `source_compliance_snapshots`. A follow-up (either a small script or an extension of `source-compliance-scan.ts`) should sync the latest per-source scan result onto the `data_sources` row so the Admin UI badge reflects the most recent scan without a human manually copying values. This was left as a deliberate gap rather than auto-writing during this pass, to avoid the scan tool silently mutating ledger state that a human should be reviewing.
3. **The robots.txt parser is intentionally minimal** and should not be extended into a general-purpose robots.txt compliance engine; if more precision is needed later (e.g. full `Allow`/`Disallow` precedence, wildcard/`$` support, crawl-delay handling), treat that as a separate scoped change, not a silent expansion of what this tool is trusted to decide.
4. **No per-field audit trail exists yet for compliance ledger changes** (unlike `source_approval_events` for approval-status changes). If regulatory or audit requirements demand a full history of who changed what and when on the compliance fields, add a `source_compliance_events` table mirroring `source_approval_events` rather than relying on `compliance_notes` free text.
5. **SAM.gov and other non-state-portal sources** (see `crawler/apsi_crawler/sources/registry.py` and the federal adapter) are in scope for the same ledger but were not specifically audited in this pass; confirm they're represented in `data_sources` with the same compliance fields before assuming full coverage.
