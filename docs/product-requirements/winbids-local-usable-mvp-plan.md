# WinBids Local Usable MVP Plan

Updated: 2026-06-30

## Purpose

This document defines the boundary for a **local usable MVP**. It is the planning baseline for finishing the current local product before moving into AWS production execution.

A local usable MVP means:

- The product can be demonstrated end-to-end on a local MySQL-backed environment.
- Anonymous visitors, ordinary registered users, paid users, and admin/operator users see different pages and API capabilities.
- Public bid discovery, 50-state source data, bid detail pages, and safe attachment downloads do not show placeholder or known-bad 404 evidence.
- A paid user can move from bid discovery into an Intent workspace, response workspace, artifacts, quote requests, deadline reminders, and a downloadable response package.
- Admin users can inspect users, tiers, data sources, crawler/source health, risk checks, billing foundations, notifications, and QA controls.

It does **not** mean full production launch. AWS provisioning, live Stripe checkout, real email delivery, production object storage, malware scanning, real LLM extraction, and customer-specific enterprise rules remain production or post-MVP work.

## Current Completion Snapshot

This snapshot uses a product/demo readiness view. Engineering smoke checks have passed for major local flows, but the local MVP is assessed below the engineering-smoke view because UI polish, production-like data/source operations, external service validation, and deeper workflow output still affect whether the product is ready to show broadly.

| Dimension | Completion | Status |
|---|---:|---|
| 本地可用 MVP | 98% | 搜索、50 州数据、账号、权限、意向工作台、响应工作区、材料库、报价、提醒、Dashboard intelligence、Intent read-model summaries 都能跑。 |
| 生产发布准备 | 73% | MySQL、AWS 部署文档、worker/runbook、risk check、production preflight、source-health/access-review handoff 已有；真实 AWS/Stripe/邮件/备份演练未执行。 |
| 商业化闭环 | 73% | 注册登录、admin/普通用户分离、套餐权限、Stripe foundation、locked/upgrade 状态、paid smoke 已有；真实 Stripe sandbox/live 验证未完成。 |
| 采购工作流深度 | 93% | Submission/Compliance/Pursue-NoBid/Response/Artifact/Quote/Deadline/Award-WinLoss 均有 Lite；Intent read-model UI、quote parser lite 已完成。 |
| AI/Enterprise 深度 | 60% | deterministic provider seam、RAG-ready retrieval contract、grounded QA v2、Product 6 intelligence lite、Dashboard panel 已完成；真实 LLM/RAG/credit 仍后置。 |
| 完整 PRD/长期平台 | 76% | 基础平台、主工作流、本地演示、营销漏斗、数据质量、lite intelligence 已铺开；生产运营、企业治理、真实 AI 仍是后续主线。 |

| Area | Local MVP status | Completion estimate | Notes |
|---|---:|---:|---|
| Platform/auth/admin foundation | Strong local | 92% | Registration, login/logout, admin/user separation, roles, account settings, org/tier basics, Admin console, role-aware navigation, Admin source/config/marketing controls are implemented locally. |
| Tier and paid feature gating | Strong local, external billing pending | 88% | Free / Pro / Business / Enterprise compatibility gates are enforced on backend and surfaced as locked/upgrade states; MySQL-backed paid smoke and account-tier separation risk checks pass. Real Stripe sandbox/live verification remains open. |
| 50-state discovery and safe attachments | Strong local beta | 95% | All 50 states have registry coverage and deterministic local checks. Latest risk check passed for 50/50 states, 1,146 state bid detail routes, and 216 attachment records. Live source availability still needs ongoing operation because public portals can return 403, timeout, empty page, or bot-check pages. |
| Bid search/detail/Intent core loop | Strong local | 94% | Public search/detail and registered-user Intent flow are usable; Intent page now surfaces procurement read-model summaries. Remaining work is polish and edge-case hardening. |
| Response workspace/artifact/quote/reminders | Strong Lite | 91% | Workspace, artifact vault, quote requests, reminders, snapshots, Markdown/ZIP/PDF/DOCX exports, review state, checksums, soft delete, quote comparison, and quote parser lite exist. Production storage/scanning and quote upload UI remain. |
| Submission guidance | Strong Lite | 88% | Guidance, confirmation, status, confirmation history, recovery handling, package/export evidence snapshots, and evidence auto-link summaries exist. Portal-specific handoff remains post-MVP depth. |
| Dashboard and UI/UE | Usable local | 83% | Main app has improved shell, role-aware sidebar, differentiated dashboard, Product 6 intelligence panel, and browser evidence gates. Deeper mobile polish and final visual migration remain. |
| MySQL local runtime | Verified local | 93% | MySQL migration, smoke, worker preflight, risk check, public/user/admin API smoke, paid Business/Enterprise API smoke, browser smoke, and demo readiness pass. Production-like backup/restore and cloud execution remain pending. |
| Production readiness | Partial | 73% | AWS/Stripe/runbooks/preflights/source-health handoff exist, but real credentials, live webhooks, backup/restore drills, and production owners are external tasks. |

Overall assessment:

- **Local usable MVP:** about **98% complete**.
- **Production launch readiness:** about **73% complete**.
- **Commercialization loop:** about **73% complete**.
- **Procurement workflow depth:** about **93% complete**.
- **AI / Enterprise depth:** about **60% complete**.
- **Full PRD/platform scope:** about **76% complete**.

## Latest Local MVP Completion Batch

Completed on 2026-06-30:

- Local MVP verification now passes in MySQL mode: `npm test` 255 files / 1,299 tests, `npm run lint`, `npm run build`, `db:mysql:migrate`, `db:mysql:smoke`, `demo:check`, `risk:check`, and `git diff --check`.
- `demo:check` reports 50/50 states, 1,146 active state bids, 216 safe local attachment routes, and 0 known placeholder URLs.
- `risk:check` reports 50/50 required states, 1,146 bid detail route checks, 216 attachment checks, account-tier separation, source governance, source-validity metadata, state/global URL validity, and npm audit 0 vulnerabilities.
- Intent detail now shows procurement read-model summaries for quote comparison, artifact/submission evidence auto-linking, and Award / Win-Loss learning.
- Dashboard now shows Product 6 intelligence lite with deterministic cockpit metrics, top signals, limitations, and explicit `llm: not_used` policy.
- Admin Config Matrix now surfaces Marketing Content CMS / Copy Library scope with safe validation and unsafe claim guard cues.
- Quote upload parser lite now supports deterministic CSV/JSON parsing into normalized rows, totals, warnings, and comparison-ready summaries.

Current local MVP follow-up:

- Continue local work with 50-state P1 warning closure, quote upload UI, XLSX parsing, award tabulation, outcome analytics, deeper Enterprise cockpit, full CMS editing, and browser-level UI polish.
- Keep production work separate: real AWS/S3/RDS, Stripe sandbox/live, production email/CRM credentials, backup/restore drills, production source-health runner, and real LLM/RAG/credit charging.

Completed on 2026-06-05:

- Response Package Format Slice is implemented and later deepened: package export records and requests model `markdown | zip | pdf | docx`; Markdown remains the default working format, ZIP packages include manifest/README/readable linked artifacts, and lightweight PDF/DOCX exports are locally downloadable.
- Submission Completion Lite is implemented: submission paths now expose `draft`, `ready`, `submitted`, and `needs_recovery` states, confirmation history, and guarded transitions.
- Auth/Tier local MVP smoke coverage is implemented as static regression tests for anonymous, signed-in, admin, and locked/upgrade boundaries.
- 50-state deterministic validity has continued to pass through `npm run risk:check`; latest refreshed evidence has 50/50 required states active, 1,146 active state bids, 1,146 local detail routes, and 216 safe local attachment routes with no placeholder URLs.
- Live source-health reporting was rerun separately and documented as operations risk: 20/50 live registry probes were healthy, while 30/50 were affected by access challenges, 403s, timeouts, TLS/network failures, or 503.
- Browser smoke opened anonymous home, login, search, auth-required Intent pages, bid detail, ordinary-user dashboard/settings/admin-denied states, and admin dashboard/admin-console states.
- MySQL-backed runtime smoke completed after starting the existing `winbids-mysql` container: `db:mysql:migrate`, `db:mysql:smoke`, `workers:check`, `risk:check`, public bid/detail/attachment API checks, ordinary-user registration/login/admin-denial, and admin login/admin API checks passed.
- Paid-user MySQL smoke completed: admin-created Business and Enterprise local accounts logged in successfully; Business exercised Intent, Submission, Compliance, Response Workspace, Artifacts, Quotes, Deadlines, Markdown/ZIP/PDF/DOCX response package export/download, and Enterprise opened `/knowledge` without auth-required or upgrade-lock state.
- Admin invited-user workspace creation was fixed: admin-created invited users now get an owned organization/workspace at invite creation, aligned to the selected account tier.

Current local MVP follow-up:

- Keep Docker/MySQL running when demonstrating the local MVP. If the machine restarts, run `docker start winbids-mysql` before `npm run dev`.
- The final regression freeze pass has now run successfully after documentation/code sync. Re-run it after future changes, then keep remaining work in production or post-MVP queues.

## Local MVP Must-Have Scope

### 1. Public Discovery

Required local behavior:

- Anonymous visitors can browse public search and bid detail pages.
- Bid detail routes resolve from actual stored bid IDs, not demo placeholders.
- Bid attachments use safe local API download routes or are explicitly unavailable; they must not link to known-bad external placeholder URLs.
- `npm run risk:check` rejects `sam.gov/opp/12345`, unsafe raw state attachment URLs, empty state bids, and broken detail/download paths.

Current status: mostly complete. Keep running source validity and risk checks after each data or crawler change.

### 2. Account, Role, and Workspace Boundary

Required local behavior:

- Anonymous visitors see a public home and public discovery only.
- Ordinary users must register/login before using personal workspace features.
- Free users see paid modules as locked with upgrade copy.
- Paid users can use pursuit/response workspace modules according to tier.
- Admin/operator/support users see Admin console access and admin-only dashboard actions.
- Ordinary users cannot access admin APIs or admin-only dashboard actions.

Current status: mostly complete. The next local MVP freeze should add browser/API smoke checks to keep this from regressing.

### 3. Paid Workflow Loop

Required local behavior:

`Search -> Bid detail -> Intent -> Qualification/evidence -> Submission guidance -> Response workspace -> Artifact vault -> Quote requests -> Deadline reminders -> Response package export`

Current status: strong local v1. Remaining local non-production depth is concentrated in 50-state warning closure, quote upload UI/XLSX parsing, award tabulation/outcome analytics, deeper Enterprise cockpit, and content/CMS depth.

### 4. Admin Operations

Required local behavior:

- Admin can inspect source health, crawler runs, bid QA, users, tiers, feature overrides, notifications, billing foundations, and config registry.
- Admin can distinguish official, beta, and public fallback sources.
- Admin/source reports make live source risks visible without blocking deterministic local checks.

Current status: mostly complete. The remaining work is production scheduling/alerting, not local MVP blocking.

### 5. Handoff and Verification

Required local behavior:

- MySQL-backed local run is documented.
- Full regression commands are repeatable.
- AWS deployment docs exist, but real cloud execution can remain outside local MVP.
- The implementation status, gap analysis, runbooks, and this MVP plan stay synchronized after every stage.

Current status: strong documentation baseline. Keep docs updated after every phase.

## Remaining Local MVP Work

### P0. Local MVP Regression Freeze

Goal: prove the existing system is stable before adding more depth.

Acceptance:

- Full regression passes.
- Browser/API smoke verifies anonymous, free user, paid user, and admin differences.
- Known-bad 404 evidence links are absent from active local data.

Recommended checks:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run db:mysql:migrate
npm run db:mysql:smoke
npm run workers:check
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

### P1. Response Package Format Slice

Status: complete locally.

Goal: make package export format explicit and locally downloadable before production object-storage validation.

Local MVP implementation:

- Add `format: markdown | zip | pdf | docx` to response package export requests and rows.
- Keep Markdown as the default working format.
- Generate local ZIP packages with manifest/README/readable linked artifacts.
- Generate lightweight PDF/DOCX exports for local workflow review.
- Show format metadata in the Intent response package panel.
- Keep checksum, byte-size, review state, manifest integrity, and download audit behavior.

Acceptance:

- Markdown, ZIP, PDF, and DOCX exports download locally.
- Tests cover route parsing, service validation, SQLite/MySQL migration columns, and UI display.

### P1. Submission Completion Lite

Status: complete locally.

Goal: move submission guidance from editable notes into a clearer workflow state.

Local MVP implementation:

- Add submission status such as `draft`, `ready`, `submitted`, and `needs_recovery`.
- Store status history or confirmation history in API responses.
- Make confirmation records visible enough for a user to prove what was submitted and when.
- Add recovery state when confirmation is missing required receipt/reference details.

Acceptance:

- User can see current submission status.
- User can save guidance, confirm submission, and see latest/history.
- API rejects invalid status transitions.
- Paid feature gate still protects submission guidance.

### P1. Auth/Tier/User Experience Smoke

Status: static smoke coverage plus MySQL-backed anonymous/free/admin/paid browser smoke complete locally.

Goal: prevent regressions in the most visible local MVP flows.

Acceptance:

- Anonymous home differs from signed-in dashboard.
- Home top-right exposes login/register when signed out.
- Ordinary user sees no Admin entry or admin source links.
- Admin user sees Admin entry and admin actions.
- Free user sees locked paid modules.
- Response Builder or Enterprise user can open paid modules; Business keeps Enterprise-only features locked, while Enterprise opens Knowledge Station.

### P2. 50-State Source Validity Operations

Status: deterministic release gate passed locally; live portal health remains an operations risk report.

Goal: keep local data trustworthy without overclaiming live portal reliability.

Local MVP implementation:

- Continue deterministic `risk:check` as the release gate.
- Run live source health separately and persist/report the snapshot.
- Keep a public list of fallback states and why they are fallback.
- Do not treat 403/timeout/bot-check live source failures as local data failure if deterministic data/detail/download checks pass, but do mark them as production operational risks.

Acceptance:

- All 50 states remain represented.
- Active state bid data is non-empty.
- Detail pages open.
- Local attachments download or show explicit unavailable state.
- Live source health risks are documented in operations handoff.

### P3. Local MVP Handoff Pack

Goal: make the local MVP runnable by another developer/operator.

Acceptance:

- This MVP plan, next development plan, implementation status, AWS runbook, MySQL cutover guide, source-health runbook, and transferability pack are aligned.
- Demo accounts and local credentials are documented only as local/test values.
- External production credentials are not committed.

## Deferred Beyond Local MVP

These are important, but should not block the local usable MVP:

- Real Stripe sandbox/live acceptance with real `sk_test...`, `whsec...`, and price IDs.
- AWS production provisioning and deployment execution.
- Production Secrets Manager values, backup/restore drills, and webhook rotation ownership.
- Real email provider delivery, bounce, complaint, and unsubscribe operations.
- Production object-storage adapter, malware scanning, artifact retention policies, and artifact version/replace history.
- Real AWS/S3 staging validation, signed URL/CDN posture, malware scanning, and retention lifecycle proof for package/artifact storage.
- Award tabulation depth and portfolio-level outcome analytics beyond current single-intent Award / Win-Loss learning.
- Real LLM extraction, citation confidence, prompt/model/cost logging, and AI fallback operations.
- Knowledge Station embeddings/retrieval/admin publishing and credit metering.
- Enterprise-specific custom permission language.

## Recommended Local MVP Completion Sequence

1. **Seed or upgrade a paid local test user**  
   Complete locally. Admin-created Business and Enterprise test users were used for MySQL-backed API/browser smoke.

2. **Run paid-user browser/API smoke**  
   Complete locally. Business verified Response Workspace, Artifact Vault, Quote Workflow, Deadline Notifications, submission confirmation, and Markdown package export/download; Enterprise verified Knowledge Station availability.

3. **Freeze local MVP**  
   Complete for the current local state. Future code/data changes should rerun the same regression command set.

4. **Continue production readiness in parallel**  
   Stripe sandbox, AWS deployment, production secrets, backup/restore, email delivery, and object-storage/malware scanning remain external-environment tracks.

## Suggested Subagent Allocation

| Agent | Scope | Primary files |
|---|---|---|
| Agent A | Response package format contract | `frontend/src/server/response-workspace/*`, response package API routes, schema/migrations, Intent panel copy |
| Agent B | Submission completion lite | `frontend/src/server/submission/*`, submission API routes, Intent submission UI, dictionaries |
| Agent C | Auth/tier smoke and UI boundary | `frontend/src/app/page.tsx`, `frontend/src/app/layout.test.ts`, auth/tier route tests |
| Agent D | 50-state validity operations | `frontend/src/server/risk/*`, `frontend/scripts/source-health-check.ts`, source-health docs |
| Agent E | Docs and status synchronization | Product requirement docs, transferability docs, operations runbooks |

## MVP Completion Definition

The local usable MVP is considered complete when:

- Full local regression and MySQL smoke pass.
- Local browser/API smoke proves anonymous, free, paid, and admin flows differ correctly.
- 50-state data/detail/download checks pass without placeholder 404 evidence.
- Paid workflow can export Markdown/ZIP/PDF/DOCX response packages locally with integrity checks.
- Submission guidance has a visible completion state and confirmation history.
- Status docs list remaining work as local product-depth items or production/post-MVP items rather than outdated local MVP blockers.
