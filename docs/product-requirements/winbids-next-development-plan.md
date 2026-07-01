# WinBids Next Development Plan

Updated: 2026-06-30

## Recommendation

For local development excluding production launch preparation, run the next phase as **data warning closure + quote upload UI + award tabulation + deep Enterprise cockpit**. P0.5 and the local non-production backlog slice are complete for service/API foundations and first UI integration: 50-state action/worklists, Admin source ops filters, durable funnel events, local CRM/email seams, safe marketing content resolver, Admin Marketing Content CMS lite, RAG-ready retrieval, grounded QA v2 mock, Product 6 intelligence lite, Dashboard Product 6 panel, procurement workflow read models, Intent read-model summaries, quote upload parser lite, unified locked/upgrade states, and role-aware navigation are now in place. The next highest-value non-production work is closing 50-state P1 warning actions, turning quote parser into a visible upload UI, adding award tabulation/outcome analytics, deepening resources/use-case content, and continuing browser-level UI polish without implying production AWS/Stripe/live-source readiness.

| Dimension | Completion | Next emphasis |
|---|---:|---|
| 本地可用 MVP | 98% | P1 data quality warning closure、quote upload UI、award tabulation、真实页面 UI/UE、source 风险说明。 |
| 生产发布准备 | 73% | Track D 生产类网络复核、真实 AWS staging dry run、真实 S3/CloudFront smoke、Stripe sandbox/live、邮件 provider、备份/恢复演练、生产 worker。 |
| 商业化闭环 | 73% | 套餐/权益运营说明继续完善；真实 Stripe sandbox 属生产准备 track。 |
| 公开营销首页 / 获客漏斗 | 94% | Full CMS editing、deeper use-case resources、external CRM/email credentials handoff、更强 spam/rate limit。 |
| 采购工作流深度 | 93% | Quote upload UI、XLSX parsing、Award tabulation、Outcome analytics。 |
| AI/Enterprise 深度 | 60% | Deep Enterprise cockpit、真实 RAG/LLM/credit 后置。 |
| 完整 PRD/长期平台 | 76% | 长期智能化、生产运营、企业级治理继续推进。 |

The existing `winbids-mysql` container has been verified locally with migration, smoke, worker preflight, risk gate, public/user/admin/paid API checks, and browser smoke. `npm run ops:launch-handoff` now produces a consolidated external launch handoff report for Stripe sandbox, production preflight, AWS staging dry-run evidence, source-health evidence, source access-review evidence, browser evidence, and risk-gate evidence. External Stripe sandbox execution and production-like AWS/worker/source-health dry runs remain production-readiness work rather than proof of production launch readiness.

## 2026-06-30 Local P0 Wave 1 Result

Completed with multi-agent TDD execution:

1. Auth / Anonymous Boundary: anonymous personal workspace side effects removed; personal APIs now return auth-required semantics instead of creating anonymous workspace state.
2. Homepage / Request Demo / Browser Evidence: `/request-demo` exists locally, CTA routes are smoke-tested, and browser-evidence reporting now models desktop/tablet/mobile plus overflow failures.
3. 50-State Data Quality Gate: deterministic gate outputs 50 state rows and separates real archived files from download-note fallbacks.
4. Workflow Governance Lite: response package review/readiness, submission gate, and submission deadline bridge are available in service-layer tests.
5. AI Provider Seam + Credit Dry Run: deterministic/mock provider seam, fallback metadata, and zero-charge credit dry-run quote/ledger are in place.

Verification:

- `npm test`: 238 files / 1,217 tests passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

P0.5 completed after this wave, with a P1 MySQL Admin parity follow-up completed on 2026-06-30:

1. **State source canonical cleanup**: done. `state-data-quality-check --fix-canonical-sources` disables duplicate enabled aliases and keeps canonical crawler sources enabled. The local quality gate now reports 50 states and 0 P0 blocker states.
2. **Admin 50-State Data Quality Matrix**: done. `/api/admin/risk-check` includes `stateDataQuality` in both SQLite and MySQL runtime; Admin shows total states, P0/P1/P2 counts, per-state risk, bid count, enabled source count, attachment real-file ratio, and reason codes.
3. **MySQL parity for state quality gate**: done. `createStateDataQualityReportFromMysql` produces the same report shape and the CLI selects it when the DB runtime is MySQL.
4. **Attachment openability improvement**: done. API/UI copy now separates real archived files, source download notes, and archive missing/failed states.
5. **Browser evidence real run**: done locally on 2026-06-30 against `http://localhost:3020` with SQLite fallback env (`DATABASE_URL='' MYSQL_DATABASE_URL=''`). The run wrote `/tmp/winbids-demo-browser-evidence-real-sqlite.json`, captured 30 entries and 30 screenshots across anonymous/free/admin/business-intent routes, and reported `ok: true`, 0 overflow failures, and 0 CTA failures. The default `.env.local` MySQL URLs still require a running local MySQL service; without it the hardened script now writes an `ok:false` report with clear setup warnings instead of aborting before evidence output.
6. **State quality action queue**: done locally. `StateDataQualityReport.actions[]` turns reason codes into prioritized local remediation actions with owner hints, due hours, recommended actions, and evidence; Admin shows the highest-priority queue beside the 50-state matrix.
7. **Attachment depth worklist**: done locally. `StateDataQualityReport.attachmentWorklist[]` lists attachment rows that need local archive/review, with state/source/bid/attachment context, archive status, recommended action, and evidence.

Next local P1 priority:

1. Reduce 50-state P1 warnings: use the state quality action queue, attachment-depth worklist, and Admin source ops filters to close crawler/source-health/needs_review/fixture fallback/download-note actions.
2. Marketing Ops completion: durable funnel events now cover request-demo submissions, `start_signup`, demo signup/profile events, first matched bid views, local notification outbox, CRM handoff event/outbox, local fake CRM sync adapter, fake email delivery seam, Admin leads CSV export, safe content-config resolver, Admin Marketing Content CMS lite, and Admin metrics; next add full CMS editing, external CRM/email credentials handoff, deeper use-case pages, and stronger spam/rate limits.
3. SEO/resource first slice is done: `/resources`, `/resources/glossary`, `/resources/supplier-workflow`, homepage resource links, bilingual content, safe claims, and route metadata. Next deepen use-case pages, structured SEO data, and content analytics.
4. RAG-ready Knowledge retrieval contract, grounded QA v2 mock, Product 6 intelligence lite, and Dashboard Product 6 panel are done locally; next deepen Enterprise cockpit UI and keep real LLM/RAG/credit behind a later approval gate.
5. Artifact evidence auto-link, quote comparison, Win/Loss learning summary, Intent read-model summaries, and quote upload parser lite are done locally; next add quote upload UI, XLSX parsing, award tabulation, and outcome analytics.
6. Locked/upgrade state audit and role-aware navigation are done locally; next UI work should be browser-level polish and page integration rather than another static boundary pass.

Homepage/Marketing PRD relationship:

- Source document: `WinBids_Homepage_and_Marketing_PRD.docx`, read on 2026-06-29.
- Core thesis: WinBids should be introduced as a supplier pursuit operating system, not only a public bid finder.
- Required public lifecycle: Match -> Understand -> Decide -> Prepare -> Submit -> Learn.
- Primary funnel: Visitor -> Free account -> Supplier profile -> matched bids -> Bid Brief/readiness preview -> paid activation.
- Important boundary: WinBids guides official submission steps but does not submit bids for suppliers in MVP; it must not guarantee compliance, source completeness, or wins.

Primary execution plan:

- `docs/superpowers/plans/2026-06-12-multi-agent-production-readiness-and-depth-plan.md`
- `docs/superpowers/plans/2026-06-12-overall-progress-execution-roadmap.md`
- `docs/superpowers/plans/2026-06-10-unified-progress-multi-agent-execution-plan.md`
- `docs/superpowers/plans/2026-06-05-local-usable-mvp-completion.md`
- Product boundary: `docs/product-requirements/winbids-local-usable-mvp-plan.md`
- `docs/superpowers/plans/2026-06-03-production-signoff-workflow-depth-schedule.md`
- Historical P1-P3 cleanup schedule: `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`

The refreshed Drive Phase II documents introduce foundation requirements that now sit above the feature backlog:

- P0 Foundation Refined: AWS-first operations, environment separation, source/security controls, QA/release gates, and transferability.
- Configurable Before Custom: a general configuration registry and admin configuration matrix.
- Audit Event Logging Matrix: durable product, admin, source, AI, notification, billing, and integration event logging.
- Transferability Requirements: a developer handoff pack covering setup, deployment, environment variables, data model, runbooks, secrets, backups, limitations, and operations.
- Universal UX States: consistent Loading, Empty, Error, Permission Denied, AI Unavailable, Low Confidence, Upload Failed, Source Unavailable, Duplicate Opportunity, Expired Deadline, and Plan Limit handling.

These are not a replacement for workflow modules such as Deadline Notifications, Award Tracking, or Win/Loss Learning. They are the cross-cutting layer that makes those future features easier to build safely.

## Current Priority Order

### Active P0. Track D Live Source Health Operations

Status: current active phase as of 2026-06-15.

Goal: prove the 50-state source story beyond local deterministic checks by rerunning live source health from a production-like network, then resolving the 29-source access-review queue.

Current evidence:

1. Done locally: `npm run risk:check` verifies 50/50 required states, 1,146 state bids, 1,146 detail routes, and 216 state attachment records.
2. Done locally: `npm run source:health:ops` produced the latest local live snapshot with 21/50 healthy, 29 unhealthy, 0 skipped.
3. Done locally: `npm run source:health:evidence` generated a ready evidence bundle after owner/disposition/next-review triage.
4. Done locally: `npm run source:health:access-review` grouped 29 follow-up sources into browser/vendor/timeout/network/portal/parser queues.
5. Done locally: `ops:launch-handoff` validates both source-health evidence JSON and access-review JSON before marking Track D ready.

Next actions:

1. Run `npm run source:health:ops` from an AWS runner or production-like operator network.
2. Regenerate source-health evidence and access-review packets from that environment.
3. Compare local vs production-like classifications for the 29 follow-up sources.
4. Mark each follow-up source as verified, beta, fallback, manual-review, or hold.
5. Update source governance and release notes before promoting additional beta sources.

### P0. Homepage & Marketing PRD Alignment

Status: first local slice completed on 2026-06-29. Anonymous `/` now has the Homepage PRD marketing structure, typed bilingual content, CTA route map, safe claims, pricing preview, resources/FAQ, and local/no-op analytics capture while authenticated users still enter Command Center.

Goal: turn the anonymous public homepage into a self-serve acquisition page while preserving the logged-in Command Center for authenticated users.

Recommended scope:

1. Done locally: split `/` behavior clearly so anonymous visitors see the marketing homepage and authenticated users see the role/tier-aware Command Center.
2. Done locally: marketing nav includes Product, How It Works, Knowledge Station, Pricing, Resources, Sign In, Start Free.
3. Done locally: hero copy uses `Find public bids you can actually pursue.`
4. Done locally: Problem, How It Works, Product Map, Knowledge Station, Pricing Preview, Resources, FAQ/Risk, Final CTA are implemented.
5. Done locally: product cards map to Supplier Profile, Bid Discovery, Pursuit Readiness, Pursuit Pipeline, Knowledge Station.
6. Done locally: safe claims state no direct submission, no compliance guarantee, no win guarantee, and official source remains source of truth.
7. Done locally: CTA route map covers Start Free -> `/register`, Sign In -> `/login`, See How It Works -> anchor, Request Demo -> `/request-demo`, public search -> `/search`.
8. Partial+: homepage view, CTA, pricing, request-demo, and public-search events are locally captured; durable server events now cover request-demo submitted, start signup, demo signup complete, supplier profile started/completed, and first matched bid viewed.
9. Partial+: Resources section now links to real `/resources`; `/resources/glossary` and `/resources/supplier-workflow` exist with bilingual copy, route metadata, safe claims, glossary terms, and practical supplier workflow guidance. Deeper use-case pages, structured SEO data, and CMS-backed editing remain.
10. Done locally for baseline: SQLite fallback browser evidence captured desktop/tablet/mobile routes with 0 page-level overflow failures.

Acceptance:

- A new U.S. supplier visitor can understand WinBids in 5 seconds and see the lifecycle Match -> Understand -> Decide -> Prepare -> Submit -> Learn.
- Supplier Profile appears as a foundation, not hidden under Knowledge Station.
- Pursuit Pipeline groups Response Workspace, Submission Guidance, and Award Tracking.
- Pricing preview uses Free, Pursuit Starter, Response Builder, Growth, and Enterprise language while preserving existing internal tier compatibility.
- Homepage explains Knowledge Station as embedded bid mentor/coaching, without implying full real LLM/RAG.
- Start Free, Sign In, See How It Works, Pricing, Knowledge Station, Resources, and Request Demo routes are usable locally; Request Demo persistence, local notification outbox, CRM handoff event/outbox, Admin leads CSV export, honeypot spam control, resource hub/glossary/workflow pages, and Admin funnel metrics exist; real email/CRM sync depth remains separate.

Immediate worker slices:

1. Done: Marketing content model with English/Chinese copy, section labels, route map, pricing, FAQ, resources, and safe-claims checklist.
2. Done: Anonymous homepage implementation with hero, lifecycle, product map, Knowledge Station, pricing preview, resources, FAQ, and final CTA.
3. Done: CTA route map plus no-op/local analytics event capture tests.
4. Done: Browser evidence slice for desktop/mobile screenshots, CTA click smoke, and overflow scan.
5. Done first slice: Request Demo form persistence, demo signup/profile events, and Admin funnel metrics.
6. Done local Marketing Ops foundation: Request Demo notification outbox, honeypot spam control, and CRM handoff event/outbox.
7. Done local SEO/resource first slice: resource hub, glossary, supplier workflow guide, homepage resource links, metadata, and safe claims.
8. Done local external CRM/export surface: Admin leads CSV export aggregates Request Demo metadata, notification status, and CRM handoff outbox status.
9. Done local external CRM worker seam: fake CRM adapter can deliver/fail `crm.marketing_leads` outbox rows without external credentials.
10. Done local marketing email seam: fake provider can mark Request Demo notifications sent/failed and export delivery attempts/errors.
11. Done local Config/CMS-backed content resolver: safe overrides are accepted and unsafe claims are rejected or defaulted.
12. Done local Admin CMS lite: Config Matrix surfaces Marketing Content CMS / Copy Library scope, safe validation, and unsafe claim guard cues.
13. Next: full CMS editing, external CRM/email credentials sync handoff, deeper use-case resources, stronger spam/rate limits, and content analytics.

### P0. Demo Stabilization And Product Polish

Status: local MVP baseline is usable; continue as Track E product polish after Track D or in parallel when frontend polish is prioritized. Homepage/Marketing PRD Alignment is now the first public-facing Track E slice.

Goal: turn the working local MVP into a cleaner demoable system and keep the public marketing page distinct from the logged-in command center.

Recommended scope:

1. Recheck anonymous, ordinary user, paid user, and admin journeys from the browser and document the exact demo flow.
2. Polish the highest-visibility real pages: `/`, `/search`, `/bids/[id]`, `/intents/[id]`, `/settings`, `/admin`.
3. Keep dashboard distinct from search: dashboard should summarize account/workspace/source/notification status, not duplicate bid search.
4. Make source-health and 50-state risks visible in product/admin copy without making the app look broken.
5. Keep unsupported production depth explicit: versioned packages, richer approval actions, and production artifact storage are not silently implied by local ZIP/PDF/DOCX exports.

Acceptance:

- A new evaluator can register, log in, search, open a bid, create an intent, inspect response workspace modules, and understand locked/upgrade states without guidance.
- Admin and ordinary-user screens are visibly and functionally different.
- No active demo link routes to known placeholder 404 evidence.

Immediate worker slices:

1. Done: fix anonymous bid-to-intent UX/API so public users do not create a personal Intent that immediately lands on an auth-required page.
2. Done: add local demo data preparation/check commands so Admin can show the 50-state source story.
3. Done: add `npm run demo:smoke` coverage for the demo journey.
4. Done: make Admin sections degrade independently instead of failing the whole page when one admin API fails.

### P0. Commercialization Safety

Status: next billing slice, confirmed by the 2026-06-10 Commercialization audit agent.

Goal: remove billing launch blockers before Stripe sandbox/live validation.

Immediate worker slices:

1. Done: harden `/api/billing/webhook` so production Stripe mode requires signed Stripe events.
2. Done: require `BILLING_WEBHOOK_SECRET` for generic billing events in production.
3. Done: fix Settings hosted checkout behavior to navigate to Stripe Checkout rather than replacing browser history with an external URL.
4. Next: re-run Stripe sandbox E2E when real `sk_test...`, `whsec...`, and price ids are available.

### P0. Production Readiness Hardening

Status: next production slice, confirmed by the 2026-06-10 Production Readiness audit agent.

Goal: convert runbook/preflight foundations into production-like acceptance gates.

Immediate worker slices:

1. Done: treat production/staging worker SQLite fallback and local notification providers as blockers in worker/preflight checks.
2. Done: add AWS staging dry-run checklist covering App Runner/RDS/Secrets/CloudWatch, worker execution, rollback, and smoke.
3. Done: add backup/restore evidence requirements instead of only owner/runbook URL validation.
4. Done: continue source-health `--inspect-body` reporting and classify 403/timeout/bot-check/login/empty/network results as operational risk.
5. Done: add a production-like source-health operations alias, `npm run source:health:ops` / `npm run source:health:scheduled`, with fixed `--all --timeout-ms 10000 --inspect-body --write-snapshot --report-only` parameters and a runbook for daily/weekly handoff, release acceptance, and escalation.
6. Done: Admin Data Sources can filter by latest live health classification.
7. Done locally: S3-compatible object-storage provider signs PUT/GET/HEAD/DELETE requests with runtime-injected credentials and fails closed without local writes when credentials are missing.
8. Done locally: deterministic artifact malware-scan seam and retention metadata are available for handoff and tests.
9. Done locally: strict S3 production posture preflight now requires private access, signed URL mode, external malware scanner marker, retention policy, and staging smoke evidence URL.
10. Done locally: add `npm run ops:launch-handoff`, a consolidated external handoff report that summarizes Stripe sandbox, production preflight, AWS dry-run evidence, live source-health evidence, live source access-review evidence, browser evidence, and risk gate evidence without printing secret values.
11. Done locally: Track D handoff now requires `SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE` alongside source-health evidence; local access-review JSON is validated for review coverage, `reviewMode`, and `requiredEvidence`.
12. Next: run scheduled live probes and real S3 smoke from the actual production-like operator network.

### P1. Procurement Workflow Close-Out

Status: next workflow-depth slice, confirmed by the 2026-06-10 Procurement Workflow audit agent.

Goal: close the procurement demo loop after submission.

Immediate worker slices:

1. Plan complete: `docs/superpowers/plans/2026-06-10-award-win-loss-lite.md`.
2. Backend/API complete: `award_outcomes`, award repository/service, `GET/PATCH /api/intents/[id]/award`, feature gate coverage, and client helpers.
3. Done: wire Award / Win-Loss Lite into Intent detail UI: status, notice URL, winner/amount, loss reason taxonomy, next action, locked state, and bilingual labels.
4. Done: add local ZIP response package export from Markdown manifest and linked artifacts.
5. Done: link submission confirmations to response package/artifact evidence and award outcomes at API/read-model level, and surface the evidence summary in the Submission panel.
6. Done: add lightweight PDF/DOCX response package output and per-format Intent UI controls.
7. Done: add approve / request-changes actions for response package exports with review notes and redacted audit events.
8. Done: add adjacent response package snapshot version summaries and change comparisons in service/API/UI.
9. Done: add full version-history totals and expandable all-version list in Intent UI.
10. Done: add side-by-side package comparison for any version pair in Intent UI.
11. Done: add submission confirmation evidence snapshots bound to concrete package/export versions.
12. Done: add deterministic artifact compliance/evidence auto-linking, quote comparison summary, and Win/Loss learning summary read model.
13. Done: expose quote comparison, artifact/submission evidence auto-link summary, and Win/Loss learning summary in Intent UI.
14. Done: add deterministic CSV/JSON quote upload parser lite with normalized rows, totals, warnings, and comparison-ready summary.
15. Next: add quote upload UI, XLSX parsing, award tabulation, and outcome analytics.

### P2. AI / Enterprise Foundation Lite

Status: local AI/Enterprise preparation slice is materially complete for deterministic foundations. Real LLM/RAG/credit remains later.

Goal: prepare real AI/RAG/credit integration without requiring model keys yet.

Immediate worker slices:

1. Plan complete: `docs/superpowers/plans/2026-06-10-ai-enterprise-depth-lite.md`.
2. Done: add deterministic AI run metadata: provider, model/rules version, prompt version, confidence, cost zero, fallback reason.
3. Done: add lexical Knowledge retrieval trace and matched-field metadata.
3a. Done: upgrade retrieval contract to `lexical_mock_rag` chunks with embedding/vector-store unavailable status, source refs, matched reason, and excerpts.
4. Done: add credit ledger dry-run events for premium actions without deducting balance yet.
5. Done: surface AI metadata/retrieval trace in a constrained Enterprise/Knowledge UI without implying real LLM execution.
6. Done: grounded QA v2 mock adds grounding status, evidence coverage, and limitations.
7. Done: Product 6 intelligence lite adds deterministic cockpit metrics, summary bullets, source policy, API route, and API helper.
8. Done: wire Dashboard Product 6 panel to `/api/dashboard/intelligence`, showing cockpit metrics, top signals, limitations, and deterministic source policy.
9. Next: deepen Enterprise cockpit UI; replace deterministic-only paths with a real provider seam only after model keys, evaluation rules, and credit charging policy are approved.

### P0A. Standards Alignment Lite

Status: done locally as a first foundation slice.

Goal: make the project buildable, auditable, configurable, and handoff-ready before more modules create additional state.

Delivered:

1. Local Phase II requirements alignment is in the product docs.
2. Transferability Pack skeleton exists under `docs/transferability/`.
3. Minimal `config_registry` foundation exists for feature, plan, workflow, source, notification, AI, UX-state, and dashboard config domains, and `/admin` now includes a first read-only Config Registry / Config Matrix panel.
4. Durable `event_log` and `event_outbox` foundations exist with metadata redaction and idempotency.
5. Request/correlation id helper exists.
6. Reusable Universal UX state model/component exists and is used by `/admin` auth/error states.
7. `npm run risk:check` includes source ingestion governance, with stricter production approval mode available through the report option/env flag.
8. `npm run risk:check` includes deterministic 50-state source-validity metadata checks and state URL validity checks, including rejection of known demo/placeholder URLs.

Remaining depth:

- Broader Universal UX state rollout to lower-level inline module errors and future Artifact Vault upload flows.
- Editable admin UI for config registry beyond the first read-only matrix.
- More event writes across permissions, plan limits, upload failures, source changes, AI states, duplicates, deadlines, quotes, and awards.
- Production AWS deployment execution, not just docs.
- MySQL runtime cutover is complete locally: route guard coverage, MySQL smoke, risk/workers checks, admin/user browser smoke, dashboard summary, Knowledge Station, subscription reconcile, 50-state details, and attachment download checks passed. Production readiness preflight is now scriptable with `npm run ops:production:check`; remaining production signoff work is running the operator-assisted Stripe sandbox flow with real test credentials against MySQL plus final low-risk live checkout/webhook execution and real production-like worker/secret/backup signoff.

### P0B. Source Legal-Use and Ingestion Governance

Status: done locally as a first foundation slice.

Goal: align 50-state crawler work with the new source ingestion controls.

Delivered:

1. Source approval fields exist on `data_sources`.
2. 50-state registry has approval defaults: verified sources approved, beta sources needs-review.
3. Transferability docs describe source credential/secret handling boundaries.
4. Admin source projection and Admin UI surface source approval state; the Admin Data Sources API also exposes latest persisted live source health details for each source when available.
5. Risk-check fails blocked/restricted enabled sources and can require explicit production approval for all enabled state sources.
6. Source-validity metadata distinguishes official verified portals, beta official portals, and public aggregator fallback sources in the frontend/Admin projection and Python crawler registry/output metadata.

Remaining depth:

- Editable approval workflow.
- APSI Registration Vault implementation.
- Operator-run live portal URL health reporting beyond deterministic local URL-shape checks.
- Production approval operations and ownership workflow.

### P1. Data and Production Readiness

Goal: keep the already completed 50-state coverage usable and production-safe.

Deliverables:

1. Promote beta state adapters in batches of 10-15 states with live validation and source quality notes.
2. Replace public fallback sources when stable official sources are available.
3. Operator-run live source URL health reporting is now available through `npm run source:health:check`; production-like handoff uses `npm run source:health:ops` or `npm run source:health:scheduled` to apply fixed all-source, body-inspection, snapshot-writing, report-only parameters without adding a real cloud scheduler or network-dependent tests. `npm run source:health:evidence` now turns the latest persisted snapshot into a release/operations evidence bundle and blocks signoff when unhealthy sources lack owner, disposition, or next-review date.
4. Add production crawler scheduling, monitoring, and alerting runbook coverage.
5. Connect real production email provider credentials and bounce/complaint handling.
6. Dry-run production billing, notification, and crawler workers with production-like environment separation.
7. Continue UI/UE production polish on real app pages rather than only static demos.

Acceptance criteria:

- 50-state data remains non-empty and accessible through search, bid detail, and attachment download checks.
- Admin and `risk:check` can distinguish official, beta, and public aggregator fallback sources, and can reject demo/placeholder URLs before handoff.
- Operators can run a separate live source health probe for all 50 registry base URLs or a subset of state/source ids.
- Admin can identify unhealthy sources and production worker failures.
- Billing and notification foundations can be operated outside local dev.

### P2. Workflow Depth

Goal: complete the supplier pursuit workflow after the foundation is safer.

Recommended order after the local MVP freeze pass:

1. Response Package / Artifact production depth: package manifests, download audit, safe local object-storage writes, S3-compatible SigV4 object-storage writes/reads, checksum/byte-size download integrity validation, export review-state metadata/display, approve/request-changes review actions, explicit `markdown | zip | pdf | docx` export format modeling, local ZIP package generation, lightweight PDF/DOCX generation, full version-history totals plus expandable all-version list, adjacent snapshot change comparisons, any-version side-by-side comparison, confirmation-level frozen package/export evidence snapshots, artifact soft delete/delete audit events, artifact replace/version flow, strict S3 posture preflight, and a deterministic local/noop artifact malware scan seam now exist locally; next add real AWS/S3 staging validation, external malware scanning, signed URL/CDN posture, configurable retention lifecycle proof, and review governance reporting.
2. Submission Guidance Completion: submission status, confirmation history, guarded transitions, and recovery states now exist locally; next add deeper submission versioning, richer submission package evidence, and production operator handoff.
3. Data operations closure: resolve 50-state P1 warning actions, keep source-health evidence fresh, and speed up heavy report-only checks.
4. Quote / Supply Chain depth: visible quote upload UI for existing CSV/JSON parser, XLSX parsing, richer comparison scoring, partner profile depth, audit events, outbound email, and supplier portal.
5. Award / Tabulation depth: award tabulation capture, portfolio outcome analytics, buyer notice monitoring, and richer competitive analysis input.
6. Enterprise cockpit depth: deepen Product 6 intelligence with deterministic buyer, competitor, pricing, category, and forecast panels before real LLM/RAG/credit charging.

Artifact Vault Lite is now complete locally as a v1 slice: Business-gated upload/list/download/delete/replace, intent/bid association, metadata, derived security-scan/retention policy fields, append-only artifact version history, local/S3-compatible object-storage provider support, deterministic local/noop malware test-signature blocking, empty state, upload failed state, soft delete, delete/replaced audit events, and bilingual Intent UI are implemented. Its future depth remains compliance auto-linking, real AWS/S3 staging validation, external malware scanning, signed URL/CDN posture, and approved retention lifecycle proof.

Quote / Supply Chain Lite is now complete locally as a v1 slice: Business-gated partner records, quote request drafts, status flow, quote amounts, response notes, linked supplier artifacts with soft-delete filtering, API/client helpers, bilingual Intent UI, quote comparison summary, deterministic CSV/JSON quote parser lite, and quote due-date reminders through Deadline Notifications Lite are implemented. Its future depth remains visible upload UI, XLSX parsing, outbound email, supplier portal, response uploads, deeper comparison scoring, partner profile depth, audit events, and richer compliance linkage.

Deadline Notifications Lite is now complete locally as a v1 slice: Business-gated `deadline_reminders`, an idempotent generator for bid deadlines, response task due dates, quote due dates, and artifact expiries, GET/PATCH APIs, acknowledge/snooze actions, client helpers, bilingual Intent UI, Settings reminder center, MySQL runtime adapter, and locked/error/empty states are implemented. Its future depth remains production notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, and richer audit events.

Response Workspace Assignment + Comments Lite and package export handoff are now local depth slices: response workspace items support owner assignment to active workspace members, `response_workspace_comments` stores item-level coordination notes, artifact links and activity history are available, linked artifacts honor artifact soft deletes, package snapshots/Markdown/ZIP/PDF/DOCX exports include package and artifact manifest metadata where applicable, downloads record audit timestamps, export downloads validate byte size plus SHA-256 before serving, exports can be approved or returned for changes with redacted review audit events, snapshots expose full version-history totals, expandable all-version list, adjacent version summaries/change comparisons, and any-version side-by-side comparison, and submission confirmations freeze the concrete package/export versions used at submission time. Future depth remains real AWS/S3 staging validation, external malware scanning, configurable retention, richer review history, richer team member directory, and LLM drafting.

Intent workflow panel decomposition is now complete as a parallel-readiness slice: the Intent detail page renders Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications through dedicated component files while retaining existing state and handler ownership in the page. This lowers merge risk for the next Response Workspace and workflow-depth tasks without changing behavior.

Acceptance criteria:

- A paid user can move from opportunity discovery to pursuit, response preparation, evidence collection, quote support, reminder handling, and outcome capture.
- Admin and ordinary user experiences remain visibly different.
- Free, Pursuit Starter, Response Builder, and Enterprise gates remain enforced by backend and frontend.

### P3. Intelligence and Enterprise Depth

Goal: add advanced value after source, workflow, and audit foundations are stable.

Recommended order:

1. Production AI layer: LLM-backed extraction, citations, confidence, prompt/version logging, cost controls, AI unavailable and low-confidence states.
2. Knowledge Station depth: embeddings, retrieval, admin publishing workflow, artifact uploads, usage metrics, and credit metering.
3. Real credit consumption and paid credit packs.
4. Advanced usage metrics across artifacts, quotes, AI calls, Knowledge Station, and storage.
5. Product 6 intelligence data capture: buyer, competitor, pricing, category, forecasting, and supplier performance datasets before advanced predictions.
6. Custom enterprise permission rules only after real enterprise cases exist.

## Last Completed Phase

**Local Usable MVP Completion Batch 1 + Paid Smoke Closure** is complete locally as the latest workflow hardening slice.

Completed locally:

- Response Package Export Format Contract added explicit `markdown | zip | pdf | docx` modeling across service, repository, schema/migrations, API, client, and Intent UI. Markdown, ZIP, lightweight PDF, and lightweight DOCX are locally downloadable; deeper versioned packages and approval actions remain future depth.
- Submission Completion Lite added `draft`, `ready`, `submitted`, and `needs_recovery` states, confirmation history, guarded transitions, API responses, and Intent UI status/history display.
- Auth/Tier local MVP smoke added static regression coverage for anonymous, signed-in, admin-only, locked/upgrade, and personal-workspace boundary behavior.
- 50-state deterministic validity has continued to pass through `npm run risk:check`; latest refreshed evidence has 50/50 required states active, 1,146 active state bids, 1,146 detail route checks, and 216 safe local attachment routes.
- Live source-health operations probe was rerun and documented: 20/50 live registry probes were healthy, while 30/50 were unhealthy due to live portal access challenges, 403s, timeouts, network/TLS failures, or 503.
- Batch 1 split Intent detail workflow sections into dedicated components for Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications.
- Batch 1 added a first read-only Admin Config Registry / Config Matrix section backed by `/api/admin/config`.
- Batch 1 expanded P3 entitlement/Knowledge/Credit tests for Enterprise defaults, org overrides, expired overrides, Growth planned/disabled state, and static credit metadata.
- Batch 2 added Response Workspace artifact-task linking using the existing Artifact Vault foundation.
- Batch 2 added `response_workspace_item_artifacts` schema/migration coverage, MySQL-compatible repository/service behavior, and MySQL smoke verification for linked artifacts.
- Batch 2 surfaced persisted live source health in Admin Data Sources with live status, checked time, HTTP/status code, latency, error summary, and empty state.
- Response Workspace Activity History Lite added `response_workspace_activity`, activity hydration on workspace items, service-level writes for status/notes/assignee/due date/title/linked artifact/comment changes, MySQL repository coverage, and a compact bilingual activity surface in Intent detail.
- Response Package Snapshot / Readiness Lite added `response_package_snapshots`, SQLite/MySQL repository support, response package readiness summaries from outline/artifact/blocker state, Business-gated package GET/POST APIs, client helpers, Intent UI snapshot creation, recent snapshot display, and bilingual copy.
- Response Package Export / Download Lite added `response_package_exports`, deterministic local Markdown export generation from saved snapshots, SQLite/MySQL repository support, Business-gated export request/download APIs, client helpers, Intent UI export/download controls, and bilingual copy.
- Wave 1 / Tier / Paid Feature Locking is done locally: backend entitlement/API gate coverage and frontend locked/upgrade states align.
- Wave 2 / Anonymous Boundary Cleanup is done locally: public browsing remains anonymous, while saved bids, intents, profile/settings, search alerts, and paid workspace APIs require registered users.
- Wave 3 / 50-State Source Validity Hardening is done locally: `source:health:check -- --all` works, deterministic source/content/detail/download checks pass, crawler source metadata has non-placeholder URL coverage, and OH/WY hard 404 registry URLs were corrected.
- Source Health Operations Lite added `recommendedAction` and `operationalSeverity` to live source health results, CLI reports, Admin Data Sources API/UI, and the source-health runbook.
- Local MySQL default-runtime verification now covers MySQL `.env.local`, migration/import/admin reset, SQLite runtime guard, route-level guard coverage, MySQL smoke, worker preflight, 50-state risk checks, dashboard summary, Knowledge Station, subscription reconcile, admin pages, admin/user browser smoke, ordinary-user locked states, and safe bid detail/attachment checks.
- Build / Dashboard Warning Cleanup removed the homepage Base UI native button semantics warning, constrained response package export storage under the project `data/response-package-exports` directory, and suppresses only the known Turbopack NFT warning for the response package export route.
- Production Readiness E2E / Handoff Preflight added stricter Stripe sandbox placeholder validation, `npm run ops:production:check`, production owner/backup handoff validation, release-grade source health body inspection, response package manifest metadata, and package download audit timestamps.
- Response Package / Artifact Storage Integrity Lite added a safe local object-storage helper, absolute storage paths for new artifact/export writes, manifest-backed byte-size/SHA-256 download validation, and explicit `ARTIFACT_INTEGRITY_FAILED` / `EXPORT_INTEGRITY_FAILED` responses for damaged local files.
- Response Package Export Review State added export review metadata, SQLite/MySQL migration coverage for existing tables, default pending-review export creation, API hydration, and Intent UI review badges.
- Artifact Soft Delete / Delete Audit Events added soft-delete columns, a DELETE artifact API/UI, `artifact.deleted` audit events, active-vault filtering, and deleted-artifact filtering across Response Workspace and Quote Workspace.
- Paid Business / Enterprise smoke closure created admin-invited local paid users, fixed invited-user workspace creation for SQLite/MySQL, verified Business paid workspace APIs and browser logout, and verified Enterprise Knowledge Station API/browser access without auth-required or upgrade-lock behavior.

Remaining depth:

- Final local MVP regression freeze remains: rerun the agreed regression command set after this documentation/code sync.
- Stripe Sandbox E2E with real test keys must run against MySQL before billing production signoff.
- Production worker deployment preflight still needs staging/production-like dry runs for crawler, notifications/dunning, and event outbox.
- Production secret-manager population, webhook rotation, backup/restore drills, and low-risk live checkout/webhook validation remain external-environment tasks.
- Live source health still has external portal availability risk from 403, timeout, fetch failure, empty pages, or access-challenge pages even when deterministic 50-state data/detail/download checks pass.
- Real AWS/S3 staging validation, external malware scanning, richer review governance/reporting, Config Matrix effective-date/rollback UI, real credit consumption, and production AI remain intentionally deferred.

## Current System Position

Already strong enough for the next foundation phase:

- Account registration, login, admin/operator/support separation, settings, team basics, organization tier inheritance, and feature gates.
- Subscription, Stripe sandbox verification, billing portal/cancel foundation, invoice/payment history, and dunning foundation.
- 50-state crawler registry, non-empty guardrails, safe local attachment serving, Admin risk-check visibility, and Bid QA.
- Product 2 deterministic qualification flow: citations, document-grounded Q&A, amendment freshness, no-bid taxonomy, evidence/artifact links, and compliance evidence mapping.
- Knowledge Station Lite and Response Workspace Lite.
- Search Alerts UI, notification outbox, delivery worker, and digest history.

Main risk now:

- Too much future behavior is still hard-coded or module-local.
- Audit/event logging is not yet comprehensive.
- Universal UX states are not yet systematically enforced.
- Production signoff still depends on real credentials, worker deployment, backup/restore ownership, and live webhook/checkout rehearsal.
- Source ingestion approval/legal-use controls are locally visible, but live portal failures still need operator triage before production crawler expansion.

## Out Of Scope For The Next Phase

- Full AWS deployment.
- Full production LLM integration.
- Full Artifact Vault production object storage/external malware scanning implementation.
- Full Quote marketplace or supplier portal.
- Automated login, CAPTCHA bypass, paid/restricted source crawling, or source behavior that violates portal terms.
- Enterprise-specific custom permission language without a real customer case.

## Verification Baseline

Each implementation phase should end with:

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

Crawler-specific phases should also run the relevant Python tests:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

## Recommended Next Implementation Plan

Use the latest Superpowers execution plan at `docs/superpowers/plans/2026-06-05-local-usable-mvp-completion.md` as the completed code-depth baseline.

Immediate local runtime slice: **complete for the current local MVP state**. Re-run the freeze command set after future changes.

MySQL runtime commands already passed locally and should remain in the freeze checklist:

```bash
cd frontend
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run db:mysql:migrate
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run db:mysql:smoke
DATABASE_URL='mysql://winbids:winbids_dev_password@127.0.0.1:3306/winbids' npm run workers:check
npm run risk:check
```

Browser/API smoke slice: **complete locally for paid Response Builder / Enterprise MySQL-backed verification**.

External-blocked slice: **Stripe / Production Signoff**, which still needs real Stripe test keys, a current Stripe CLI `whsec...`, price ids, and production-like owner/backup variables.

The broader alignment plan remains at `docs/superpowers/plans/2026-06-02-auth-tier-source-anonymous-alignment.md`.

Run the next phase as **Production Readiness Parallel Track**. If external credentials are ready, run **Stripe Sandbox E2E on MySQL**; if AWS deployment is the priority, run the production worker dry-run path. Wave 1 / Tier / Paid Feature Locking, Wave 2 / Anonymous Boundary Cleanup, Wave 3 / 50-State Source Validity Hardening, Source Health Operations Lite, Admin Source Governance Lite, Settings Reminder Center Lite, local MySQL default-runtime verification, Build / Dashboard Warning Cleanup, Artifact Soft Delete / Delete Audit Events, Response Package Format Slice, Submission Completion Lite, Auth/Tier static smoke, anonymous/free/admin browser smoke, paid Business/Enterprise smoke, and Production Artifact / Package Storage Lite foundations are complete locally and should be treated as the permission + source-quality + reminder + database + build/browser-noise + artifact-delete + package/submission/storage baseline.

Latest completed local slice:

- Billing Local Hardening is complete locally: Stripe sandbox helper validation covers missing env, invalid tier, placeholder/test/live key boundaries, price id/origin/timeout parsing, tier sync, cancellation readiness, cookie extraction, and secret redaction. Checkout/portal/cancel route tests now cover stale sessions, Business checkout allowed, Free/Enterprise checkout rejected through the billing service boundary, portal provider-customer-id failures, local/provider cancellation scheduling, and no-active-subscription cancellation errors. The broader billing slice passed with 6 files / 36 tests and full `npm test` passed with 229 files / 1,162 tests.
- Response Package Governance Lite is complete locally: `ResponsePackageWorkspace.governanceSummary` now summarizes pending review, approved, needs-changes, longest pending age, latest reviewer, and whether an approved export can be referenced by submission evidence. The Response Package panel shows a concise governance strip without changing existing export creation/download/review flows. Target tests passed with 3 files / 44 tests, plus lint/build/diff-check.
- Browser Demo Evidence Harness is complete locally: `npm run demo:browser-evidence` captures repeatable desktop/mobile evidence for anonymous, Free user, admin, and generated Business intent routes. The default collector uses local Chrome DevTools for page title/headings, auth/admin/tier signals, screenshot paths, and page-level horizontal overflow checks, with a static HTML fallback when Chrome is unavailable. The latest local run on `http://localhost:3020` produced 18 entries, 18 screenshots, 0 overflow failures, a real `/intents/<id>` route, and no `session=`, password, token, or Bearer leaks in the generated report.
- Source Health Report / Evidence Export is complete locally: `npm run source:health:report` reads latest persisted source-health snapshots without live probes and exports sanitized Markdown/JSON/CSV reports with summary, classification counts, triage owner/disposition/next-review, trend/current streak, healthy percentage, recommended action, and severity. `npm run source:health:evidence` now generates a release/operations evidence bundle with 50-state coverage, stale-snapshot detection, untriaged unhealthy counts, blocker list, and high-priority source queue. `ops:launch-handoff` validates local `SOURCE_HEALTH_OPS_EVIDENCE_FILE` JSON contents before marking the source-health track ready. `npm run source:health:access-review` now generates a browser/vendor/production-network review packet for unhealthy sources without calling portals or storing credentials.
- Source Health Triage Queue Batch 1 is complete locally: SQLite/MySQL `data_sources` now stores live source triage owner/disposition/next-review/notes/reviewed-at, Admin/operator PATCH can save those operations fields with lightweight notes redaction, Admin Data Sources displays unassigned/overdue/scheduled/reviewed triage states, and quick actions can assign review, accept fallback, mark manual path, mark vendor account, or clear triage.
- Live Source Health Operations + Demo Smoke Continuation is complete locally for the current pass: `ms_state_procurement` stale 404 URL was replaced with the current Mississippi contract bid search page, MS live health now passes, `source-health-check --persist` writes to the current runtime, the latest all-state report-only snapshot from June 13, 2026 persists with 21/50 healthy and 29 operational-risk states, and the evidence bundle is current after bulk triage with owner/disposition/next-review assigned for the 29 operational-risk states.
- UI/UE Browser-Level Demo Polish has a current Browser-assisted pass: anonymous desktop/mobile pages show login/register entry points without page-level overflow; ordinary Free user registration/settings/admin-denial works; local admin login shows Admin Operations, risk checklist, Data Sources, crawler controls, and source-health filters; `Login required` classification filtering shows 14/56 Admin data-source rows with evidence snippets.
- Production Artifact / Package Storage Lite is complete locally: strict S3 production posture preflight, artifact version table/repository/service path, replace API/client, Intent UI replace controls, version display, malware scan before replacement writes, and `artifact.replaced` audit metadata.
- Response Package Review History + UI Polish Wave 1 is complete locally: export review events, repeated review timelines, Intent UI timeline display, `/search` operational feedback, anonymous save login/register prompts, and mobile bid-detail overflow fixes.
- Latest focused verification on June 13, 2026: `npm run source:health:ops` completed a live all-state body-inspection run with 21/50 healthy, 29 unhealthy, 0 skipped; `npm run source:health:evidence -- --allow-blocked --format=json` generated a current 50-state evidence bundle; source-health triage applied owner/disposition/next-review for 29 operational-risk states; `source:health:access-review` grouped 29 operator follow-up sources into browser/vendor/timeout/network/portal/parser queues; `ops:launch-handoff` accepted the local source-health track only after validating both evidence JSON and access-review JSON. Latest focused Track D suite passed with 5 files / 35 tests; full `npm test` passed with 233 files / 1,183 tests; `npm run lint`, `npm run build`, `npm run risk:check`, and `git diff --check` passed.

Recommended order:

1. **Local Worker Batch A / Source Health Triage Queue**：Done for data/API/Admin quick actions and report export.
2. **Local Worker Batch B / Browser Demo Evidence + Workflow Governance**：Done locally.
3. **External Track A / Production Artifact + AWS/S3/RDS Signoff**：Run real AWS/S3 staging validation, CloudFront/signed URL decision, external malware scanner proof, IAM review, RDS migration/smoke, and retention lifecycle proof when AWS access is ready.
4. **External Track B / Stripe Sandbox E2E**：Use real test mode `sk_test...`, current Stripe CLI `whsec...`, and Pro/Business price ids against MySQL.
5. **Local Worker Batch C / Billing Local Hardening**：Done locally. Real Stripe sandbox/live signoff still requires external credentials.
6. **External Track C / Production Worker + Secrets + Backup Dry Run**：Use the AWS deployment runbook and production preflight script with real owner/backup/secrets context.
7. **P3 Deferred / Real AI-RAG-Credit**：Wait for real LLM keys, embedding store, evaluation policy, and credit charging policy before replacing deterministic AI/credit paths.

Subagent allocation:

- Worker 1：Source-health triage data layer. Done.
- Worker 2：Admin source-health triage UI/save actions. Done.
- Worker 3：Source-health report export. Done.
- Worker 4：Billing local hardening. Done.
- Worker 5：Browser demo evidence harness. Done.
- Worker 6：Response Package governance lite. Done.
- External Agent A：AWS/S3/RDS staging signoff.
- External Agent B：Stripe Sandbox E2E.
- External Agent C：Production worker/secrets/backup dry run.

After the local MVP is frozen, resume post-MVP workflow depth in this order: production object storage and external malware scanning, Config Matrix rollback/effective-date UI, Award / Tabulation Tracking Lite, Win/Loss Learning Lite, review governance/reporting, and production AI.
