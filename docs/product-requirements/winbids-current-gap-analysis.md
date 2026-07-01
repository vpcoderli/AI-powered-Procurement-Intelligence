# WinBids Current Gap Analysis

Updated: 2026-06-30

## Current Implementation Note

This file is now being used as a staged implementation backlog. Some original gaps have been closed since this analysis was first written:

### 2026-06-30 Progress Refresh

Current top-line completion:

- Local usable MVP: about **98%** complete.
- Production launch readiness: about **73%** complete.
- Commercialization loop: about **73%** complete.
- Homepage / marketing acquisition: about **94%** complete.
- Procurement workflow depth: about **93%** complete.
- AI / Enterprise depth: about **60%** complete.
- Full PRD/platform scope: about **76%** complete.

Latest verified local gate:

- `npm test`: **255 files / 1,299 tests passed**.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run db:mysql:migrate`: passed.
- `npm run db:mysql:smoke`: **53 tables verified**.
- `npm run demo:check`: **50/50 states**, **1,146 active state bids**, **216 safe local attachment routes**, **0 placeholder URLs**.
- `npm run risk:check`: passed with account-tier separation, source governance, URL validity, and npm audit **0 vulnerabilities**.

- Submission Guidance Lite is implemented.
- Compliance Manifest Lite is implemented.
- Pursue / No-Bid Decision Lite is implemented.
- Account, role, tier, feature gate, organization, billing foundation, dunning foundation, and operator/support admin roles are substantially implemented.
- State crawler coverage now has a 50-state registry/runner foundation: CA/TX/NY/FL/IL keep verified dedicated adapters; the other 45 state sources now have beta dedicated adapters with source-specific parser entry points and admin runner metadata.
- 50-state crawler quality has moved from foundation to complete beta coverage: PA/SC/OR, MA/NJ/OH/VA/WA, IA/GA/ME/MO/NV, UT/KS/MT/NM/CO/IN/MS/CT, OK/AR/SD/WV/WY, AL/AK/HI/KY/MN/WI/NH, DE/RI/TN, AZ/ID/LA/MD/NE/NC/ND/VT, and MI now have fixture-backed dedicated parser adapters; local live validation confirms non-empty results for the full beta set. MI/SC/OH currently use public BidNet fallback pages because the official/default routes are 404, timeout, or browser-check blocked from the local environment.
- 50-state source validity is now explicit in the frontend registry and Admin source projection: each state source is labeled as official, verified/beta, or public aggregator fallback with evidence-mode notes; `risk:check` now fails known demo/placeholder URLs such as `sam.gov/opp/12345` and raw unsafe external state attachment links.
- Python crawler source metadata is aligned with the frontend registry contract: state `Source` objects now carry source authority, trust status, evidence mode, and validity notes, and `fetch-state --output-json` includes `source_validity` metadata for downstream MySQL/crawler logs.
- Operators can run `npm run source:health:check` for live base-URL probing across all 50 state sources or selected state/source ids; release checks can add `--inspect-body` to detect 200 empty pages, login pages, CAPTCHA, or bot-check responses while remaining separate from deterministic local `risk:check`.
- Crawler ingestion now treats empty result sets as failures for CLI imports/live fetches and rejects state opportunities without a source id or title, so empty content is no longer silently recorded as a successful run.
- Local crawler attachment files can be served through a private bid attachment API when attachment rows point to a local file path inside an allowed attachment directory.
- Local handoff risk verification now has a single command, `npm run risk:check`, covering 50-state active data coverage, non-empty state bid content, bid detail route ID round-trips, safe attachment download routes, account/tier entitlement separation, source ingestion governance, source-validity metadata, state URL validity, and moderate-or-higher production dependency audit findings.
- The refreshed Drive requirements add a commercial packaging and credits track: product-facing plans are now Free, Pursuit Starter, Response Builder, Growth, and Enterprise, while the current database still uses `free`, `pro`, `business`, and `enterprise` compatibility values.
- Product 2 Amendment/Addenda Awareness v1 is implemented: intent qualification freshness detects amendment/addenda signals, exposes freshness/refresh APIs, and lets Intent detail refresh match/brief/checklist/risk/citation snapshots without overwriting user-edited workflow records.
- Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 is implemented: pursuit recommendations now include structured reason details with category, severity, explanation, evidence label, and suggested action while preserving saved decision history.
- Knowledge Station has moved earlier as a Product 0.9 / workflow coaching layer, while deeper procurement intelligence remains post-MVP.
- Response Workspace Lite is implemented with durable response workspace items, Business-gated APIs, editable status/notes, grouped tasks/checkpoints/artifact placeholders/package outline sections, owner assignment, comments, linked artifacts, soft-delete-aware artifact filtering, activity history, package snapshots, full version-history totals, expandable all-version list, adjacent snapshot version summaries/change comparisons, any-version side-by-side package comparison, Markdown/ZIP/PDF/DOCX export/download, package manifest metadata, artifact manifest metadata, download audit timestamps, checksum/byte-size validated export downloads, export review-state metadata/display, approve/request-changes actions, append-only export review history events, redacted audit events, versioned submission confirmation evidence snapshots, and bilingual UI.
- The refreshed Drive Phase II requirements add cross-cutting P0 standards: Foundation Refined, Configurable Before Custom, Audit Event Logging Matrix, Transferability Requirements, Universal UX States, and source ingestion governance.
- P0 Standards Alignment Lite is implemented locally as a first foundation slice: transferability docs, config registry, event log/outbox, request context, universal UX state component with `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` primary state usage, source governance metadata, Admin source approval display, and local/production-mode risk-check source governance coverage.
- Admin Config Matrix governance has moved beyond read-only: operators can edit config JSON/status from `/admin`, must provide a change reason, and saves reuse audit-linked PATCH `/api/admin/config/[id]` across SQLite/MySQL runtime paths.
- Admin Source Approval Workflow Lite is implemented: Admin data source rows now combine source validity metadata, latest live health, crawler run/re-run, per-source live health recheck, and approve/hold governance writes.
- MySQL cutover has advanced: the project now has `mysql2`, MySQL migration/smoke scripts, MySQL URL validation, a MySQL 8 smoke-verified compatibility schema path, a cutover runbook, repeatable SQLite-to-MySQL data import, and MySQL runtime coverage for auth/session/password reset, account profile/password/delete/export/preferences/usage, workspace read/update/member/invite/ownership operations, admin auth gate, admin users/feature overrides/audit logs, admin config registry list/upsert/patch with audit events, event outbox delivery, admin data source list/update, admin bid QA list/review/display/correction/batch writes, billing subscription/checkout/portal/cancel/webhook/invoices/dunning scheduling, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler health/admin crawler logs, crawler locks/source enablement orchestration, direct JSON crawler result import/upsert into MySQL, crawler search-alert matching/digest notification, a MySQL-ready Stripe sandbox verifier, aggregate worker preflight via `npm run workers:check`, production billing credential preflight via `npm run billing:production:check`, and production owner/backup handoff preflight via `npm run ops:production:check`. Remaining gaps are concentrated in running the operator-assisted Stripe sandbox flow with real test credentials against MySQL and final low-risk live checkout/webhook execution.
- Artifact Vault Lite is implemented with Business-gated supplier-managed upload/list/download/delete, intent/bid association, metadata, safe local object-storage writes, checksum/byte-size validated downloads, soft delete, delete audit events, active-vault filtering, empty/error states, and bilingual Intent UI.
- Quote / Supply Chain Lite is implemented with Business-gated partner records, quote request drafts, linked artifacts, status flow, quote amount/response notes, GET/POST/PATCH APIs, bilingual Intent UI, quote comparison summary, and deterministic CSV/JSON quote upload parser lite.
- Deadline Notifications Lite is implemented with a Business-gated deadline registry, idempotent reminders for bid deadlines, response task due dates, quote due dates, and artifact expiries, acknowledge/snooze actions, and a bilingual Intent reminder panel.
- Award / Win-Loss Lite is implemented with outcome API/client/UI, status/winner/amount/loss reason/next action fields, and deterministic learning summary read model.
- Product 6 Intelligence Lite is implemented with deterministic cockpit metrics, top signals, source policy, limitations, `/api/dashboard/intelligence`, client helper, and a Dashboard Product 6 panel that explicitly states `llm: not_used`.
- Admin Marketing Content CMS Lite is implemented in Config Matrix with Copy Library scope, safe validation, and unsafe claim guard cues.

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest remaining gaps are now:

1. 50-state data operations depth: close P1 action/worklist items, optimize the heavier state-data-quality report path, improve attachment archival depth, and keep live source access-review distinct from deterministic local gates.
2. Quote / award workflow depth: turn the quote parser into a visible upload UI, add XLSX parsing, add award tabulation, and build outcome analytics.
3. Enterprise cockpit depth: Product 6 lite is visible, but deeper Enterprise cockpit views, real provider policy, and future LLM/RAG/credit charging remain post-local-MVP depth.
4. Marketing/content depth: Admin CMS lite exists, but full CMS editing, deeper resource/use-case pages, content analytics, and external CRM/email credential handoff remain.
5. Production readiness: AWS/S3/RDS staging, Stripe sandbox/live, production email, backup/restore drills, production source-health runner, external malware scanning, and real owner signoff remain external launch work.

## Implementation Coverage by Product Area

| Area | Status | Evidence in local code | Gap |
|---|---|---|---|
| P0 Platform shell | Partial/Improving | Layout, nav, auth APIs, settings, bilingual shell, plan labels, credits foundation, transferability pack, request/correlation ids | Production execution, page-wide UniversalState rollout, and real account-specific handoff values |
| P0 Data model | Partial | Users, sessions, organizations, bids, attachments, saved bids, profiles, intents, alerts, crawlers, notification outbox, data sources, billing/subscription tables, source governance fields, `supplier_artifacts`, `quote_requests`, `deadline_reminders`, and MySQL migration preparation | Active MySQL runtime cutover, credit ledger, raw archive, quality flags depth, award/tabulation objects, and richer version/event tables |
| P0 Configuration | Foundation implemented | Central feature map, organization feature overrides, `config_registry`, seed defaults, admin config APIs, editable Admin Config Matrix, effective dates, change reason, transactional config-change audit linkage, denied audit events | Effective-date/rollback UI, broader config migration, and production governance operations |
| P0 Audit/Event | Foundation implemented | Access/deletion/override audits, crawler logs, billing events, notification outbox, QA correction history, `event_log`, `event_outbox`, request/correlation ids, metadata redaction, idempotency conflict fallback | Broader event coverage across all modules |
| P0 Universal UX states | Foundation implemented | Several pages include loading/empty/error/locked states; reusable UniversalState component/model exists; `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` use it for primary page states | Lower-level inline module errors and structured API state-code standardization |
| P0 Transferability | Foundation implemented | `docs/transferability/` includes setup/deployment/env/data/runbook/known-limitations/AWS-service-map/secrets/access docs | Production-specific account IDs, live environment values, and real backup/restore execution |
| P1 Bid source discovery | Partial/Improving | Data source admin, crawler logs, SAM.gov/state runner, 50-state state crawler registry/runner foundation, admin crawler maturity/capability/source-validity display, per-source approve/hold, and per-source live health recheck | Full Source Registry metadata model, approval history/batch queues, non-federal/non-state coverage, continued per-state connector maturity |
| P1 Bid ingestion | Partial/Improving | Normalization, dedupe, crawler logs, seeded data, runner APIs, non-empty crawler result guardrails, local attachment download serving for crawler-managed files, 50-state state source registry, CA/TX/NY/FL/IL verified dedicated adapters, remaining 45 beta dedicated parser adapters, frontend/Python source-validity metadata parity, deterministic placeholder URL rejection, and operator-run live base-URL health probe | Connector Engine boundaries, document parsing, data quality scoring, raw/detail/attachment archival by source, source health trend/history actions, official-source upgrades for states currently using public fallback sources |
| P1 Bid display/search | Partial/Good | `/search`, bid cards, filters, detail page | Closed bids, richer filter taxonomy, saved search UX polish |
| P1 Saved bids/alerts | Partial/Good | Saved bids, search alerts, notifications foundation, Settings deadline reminder center | Real email delivery settings, production reminder delivery, alert digest monitoring |
| P1 Supplier profile | Partial/Good | `/profile`, API, validation, completion score | Upload-to-fill profile, richer certifications, past performance, warehouse, insurance/bonding |
| P1 Match scoring | Partial/Good | Deterministic score and explanation | AI-assisted scoring, weighting config, source citations, category/code matching |
| P2 Intent to Bid | Partial/Good | Intent creation/list/detail/status | More statuses, owner notes, timeline, decision history, no-bid reasons |
| P2 Bid Understanding | Partial/Improving | Rule-generated brief/checklist/risk flags, persisted evidence citations, deterministic document-grounded Q&A, and amendment/addenda freshness/refresh controls | Real AI extraction, document-level requirements, confidence, open questions, richer risk explanations |
| P2 Compliance manifest | Lite implemented | Compliance manifest model/API/UI exists | Required forms, registrations, addenda, certifications, deadlines, evidence mapping need richer extraction |
| P2 Pursue/no-bid | Lite implemented | Structured recommendation reason taxonomy, risk explanations, decision capture, and history exist | Timeline and richer evidence links can be expanded |
| P3 Response workspace | Strong Lite implemented | Durable response workspace items, task/checkpoint/artifact/outline sections, API/UI, status/notes editing, owner assignment, comments, activity, artifact linking with soft-delete filtering, package snapshots, full version-history totals, expandable all-version list, adjacent snapshot version summaries/change comparisons, any-version side-by-side package comparison, Markdown/ZIP/PDF/DOCX package exports, approve/request-changes review actions, append-only export review history events, redacted review audit events, download audit timestamps, checksum/byte-size validated export downloads, export review-state metadata/display, confirmation-level frozen evidence snapshots, S3-compatible object-storage provider support, deterministic local/noop artifact malware test-signature blocking, retention metadata, task due dates feeding Deadline Notifications Lite, and Intent read-model summaries | Real AWS/S3 staging validation, external malware scanning, deeper approver policy/reporting, reusable docs, and production retention proof |
| P3 Sourcing/quotes | Strong Lite implemented | Partner DB, quote requests, status/amount/notes, linked supplier artifacts, quote due-date reminders, quote comparison summary, and deterministic CSV/JSON quote upload parser lite exist | Quote upload UI, XLSX parsing, outbound email, supplier portal, partner profile depth, and audit/event depth |
| P3 Deadline reminders | Lite implemented | `deadline_reminders` registry, Intent API/UI, bid/task/quote/artifact reminder generator, account-level Settings reminder center, acknowledge, and snooze exist | Notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, and MySQL runtime adapter |
| P4 Submission guidance | Lite implemented | Submission path, complexity score, readiness checklist, confirmation API/UI exist | Direct submission, calendar/email integration, assignments remain out of scope |
| P5 Award tracking | Lite implemented | Award outcome API/client/UI, status/winner/amount/loss reason/next action, and Win/Loss learning summary exist | Award tabulation, outcome analytics, official award feeds, and deeper learning loop |
| P6 Procurement intelligence | Lite implemented | Deterministic Product 6 cockpit metrics, top signals, source policy, limitations, dashboard API/helper, and Dashboard panel exist | Deep Enterprise cockpit, real buyer/competitor/pricing/category datasets, forecasting, real LLM/RAG, and credit charging |
| Knowledge Station | Foundation implemented | Knowledge Station UI/API and RAG-ready lexical mock retrieval contract exist | Real retrieval backend, document ingestion depth, reusable knowledge capture, and production AI governance |

## Phase 1A Completion Assessment

Completed locally:

- Supplier profile v1.
- Match score v1.
- Bid detail pursuit panel.
- Intent creation and idempotency.
- Intent list and detail pages.
- Deterministic AI brief/checklist/risk flags.
- Operation guide for Phase 1A flow.
- `/search` aligned with Search Bids navigation.

Remaining Phase 1 items:

- Account/subscription product polish beyond current auth basics.
- Full source registry and broader source coverage.
- Admin QA workflow depth.
- Production data ingestion quality.
- AI system layer and prompt/citation guardrails.
- Profile upload-to-fill.
- Closed bid handling.

## Highest-Value Next Gap

The best next local development target is now **Data Operations Closure + Quote/Award Workflow Depth + Enterprise Cockpit Depth**. Response Package / Artifact Production Depth is strong locally; the next value comes from turning the newest backend/read-model depth into visible operator workflows and closing the remaining data-quality warning loop.

Why:

- The local workflow now includes Response Workspace, Artifact Vault, Quote Workspace, Deadline Reminders, Submission Guidance, compliance evidence, package exports, package governance, artifact replacement/versioning, quote comparison, quote parser lite, Award / Win-Loss learning, and Intent read-model summaries.
- Deterministic 50-state release checks pass, but live-source operations still have P1 warning closure and report-performance work before this can feel production-operator ready.
- Quote parser lite exists in service/tests; the next user-facing step is a visible upload/import UI, XLSX support, and richer comparison/tabulation surfaces.
- Product 6 intelligence lite exists in Dashboard; the next Enterprise slice should deepen the cockpit without implying real LLM/RAG/credit charging before those external decisions are approved.

## Recommended Next Feature Slice

### Data Operations + Quote/Award + Enterprise Cockpit Depth

Scope:

- Close 50-state P1 data-quality warnings with operator action states, source-evidence links, and faster report-only checks.
- Add visible quote upload UI on Intent detail, wire it to the existing CSV/JSON parser, then extend parsing to XLSX.
- Add award tabulation and outcome analytics around the existing Award / Win-Loss learning model.
- Deepen the Enterprise cockpit from Product 6 lite into richer category, buyer, competitor, pricing, and forecast panels using deterministic/local sources first.
- Expand Admin Marketing Content CMS lite into editable resources/use-case content and content analytics, while keeping unsafe claim validation.

Artifact Vault future production depth remains real AWS/S3 staging validation, external malware scanning, signed URL/CDN posture, and lifecycle proof.
Quote / Supply Chain future depth remains supplier portal, outbound email, richer supplier profiles, XLSX/PDF extraction, comparison scoring, and audit/reporting.
Deadline Notifications future depth remains production email/calendar delivery, digest preferences, bounce/complaint handling, and operations dashboards.

Out of scope:

- LLM drafting or automated document authoring.
- Full supplier portal or quote marketplace.
- Production AWS/S3/RDS, Stripe sandbox/live, production email/CRM credentials, and backup/restore execution.
- Real LLM/RAG/vector embeddings or paid credit charging.

## Secondary Next Feature Slice

### Production Signoff Tracks

Scope:

- Stripe sandbox E2E with real `sk_test...`, `whsec...`, and Pro/Business price ids.
- AWS/S3/RDS staging validation, object storage, backup/restore, and production worker dry-runs.
- Production source-health runner with alerting and ownership.
- Production email/CRM provider credentials, bounce/complaint handling, and unsubscribe operations.

These tracks should stay separate from local feature development until credentials, owners, and staging infrastructure are available.

## Data Model Gaps

Already implemented near-term tables:

- `submission_paths`
- `submission_confirmations`
- `compliance_manifest_items`
- `pursuit_decisions`
- `credit_usage_events`
- `credit_balances` or an equivalent derived usage view
- `response_workspace_comments`
- `quote_requests`
- `deadline_reminders`
- `award_outcomes`
- `knowledge_items`

Recommended later tables:

- richer `crawler_source_capabilities` / source registry metadata tables if config JSON becomes too limiting
- dedicated `crawler_document_archives` if local attachment metadata is no longer sufficient
- richer `bid_quality_reviews` if Admin QA needs review queues beyond current bid-QA records
- `freight_partners` / supplier profiles beyond current quote-request partner fields
- `quote_responses`
- `tabulation_records`
- `win_loss_reviews`
- advanced credit balance snapshots if derived credit usage is not enough

## API Gaps

Already implemented near-term APIs:

- `GET /api/intents/:id/submission`
- `PATCH /api/intents/:id/submission`
- `POST /api/intents/:id/submission/confirm`
- `GET /api/intents/:id/compliance`
- `PATCH /api/intents/:id/compliance`
- `POST /api/intents/:id/decision`
- `GET /api/bids/:id/attachments/:attachmentId` for local crawler-managed files
- Quote Workspace, quote comparison, and quote parser service endpoints/helpers
- Response Workspace assignment/comment/version/history/export review APIs
- Deadline reminder center APIs and reminder acknowledge/snooze flows
- Award / Win-Loss APIs
- Dashboard Product 6 intelligence API

## UI Gaps

Already implemented near-term UI additions:

- Intent detail Submission section.
- Intent detail Compliance section.
- Pursue/no-bid decision panel.
- Response Workspace assignment/comment/version/export review UI.
- Settings deadline reminder center.
- Quote comparison summary and Award / Win-Loss summaries on Intent detail.
- Dashboard Product 6 intelligence panel.
- Admin Marketing Content CMS lite in Config Matrix.

Recommended near-term UI additions still pending:

- Quote upload/import UI for CSV/JSON, followed by XLSX parsing.
- Award tabulation and outcome analytics views beyond the current single-intent learning summary.
- Deeper Enterprise cockpit screens for Product 6 intelligence.
- Full CMS editing/resources/content analytics beyond Config Matrix lite.
- Continued browser-level polish for mobile, empty/error states, and 50-state data operations.

## AI Gaps

Current AI-like behavior is deterministic. This is acceptable for local MVP work, but future AI must add:

- Source-grounded output.
- Citation to bid fields or attachments.
- Confidence score.
- Explicit uncertainty.
- No legal/compliance guarantee wording.
- Human confirmation before submission-related decisions.

## Operational Gaps

- Crawler data quality needs continued expansion after 50-state beta coverage, especially attachment archival and official-source maturity.
- Notification outbox and Search Alert delivery history exist, but production email provider credentials, bounce/complaint webhooks, and operations dashboards still need configuration.
- Admin data QA should track correction status and publish confidence.
- Local extracted Drive docs are temporary; this summary should be the source for local work unless docs are refreshed.

## Recommended Development Order

1. 50-state data operations closure: resolve remaining P1 warning actions, speed up report-only checks, and keep evidence routes downloadable/openable.
2. Quote upload UI: expose CSV/JSON parser in Intent detail, add user-visible warnings/totals, then add XLSX support.
3. Award tabulation and outcome analytics: deepen current Award / Win-Loss learning into tabulation capture and portfolio-level outcomes.
4. Enterprise cockpit depth: expand Product 6 lite into buyer, competitor, pricing, category, and forecast panels using deterministic/local data first.
5. Marketing/content depth: move from Config Matrix CMS lite to editable resources/use-case content, content analytics, and external CRM/email handoff.
6. Browser and role polish: keep anonymous/free/paid/admin UI differences visible, reduce empty states, and continue mobile/overflow checks.
7. Production signoff tracks: AWS/S3/RDS, Stripe sandbox/live, production email/CRM, backup/restore, source-health runner, and real LLM/RAG/credit.

This order keeps local product depth moving while isolating external-production work that depends on credentials, cloud resources, or provider decisions.
