# WinBids Current Gap Analysis

Updated: 2026-06-01

## Current Implementation Note

This file is now being used as a staged implementation backlog. Some original gaps have been closed since this analysis was first written:

- Submission Guidance Lite is implemented.
- Compliance Manifest Lite is implemented.
- Pursue / No-Bid Decision Lite is implemented.
- Account, role, tier, feature gate, organization, billing foundation, dunning foundation, and operator/support admin roles are substantially implemented.
- State crawler coverage now has a 50-state registry/runner foundation: CA/TX/NY/FL/IL keep verified dedicated adapters; the other 45 state sources now have beta dedicated adapters with source-specific parser entry points and admin runner metadata.
- 50-state crawler quality has moved from foundation to complete beta coverage: PA/SC/OR, MA/NJ/OH/VA/WA, IA/GA/ME/MO/NV, UT/KS/MT/NM/CO/IN/MS/CT, OK/AR/SD/WV/WY, AL/AK/HI/KY/MN/WI/NH, DE/RI/TN, AZ/ID/LA/MD/NE/NC/ND/VT, and MI now have fixture-backed dedicated parser adapters; local live validation confirms non-empty results for the full beta set. MI/SC/OH currently use public BidNet fallback pages because the official/default routes are 404, timeout, or browser-check blocked from the local environment.
- Crawler ingestion now treats empty result sets as failures for CLI imports/live fetches and rejects state opportunities without a source id or title, so empty content is no longer silently recorded as a successful run.
- Local crawler attachment files can be served through a private bid attachment API when attachment rows point to a local file path inside an allowed attachment directory.
- Local handoff risk verification now has a single command, `npm run risk:check`, covering 50-state active data coverage, non-empty state bid content, bid detail route ID round-trips, safe attachment download routes, account/tier entitlement separation, and moderate-or-higher production dependency audit findings.
- The refreshed Drive requirements add a commercial packaging and credits track: product-facing plans are now Free, Pursuit Starter, Response Builder, Growth, and Enterprise, while the current database still uses `free`, `pro`, `business`, and `enterprise` compatibility values.
- Product 2 Amendment/Addenda Awareness v1 is implemented: intent qualification freshness detects amendment/addenda signals, exposes freshness/refresh APIs, and lets Intent detail refresh match/brief/checklist/risk/citation snapshots without overwriting user-edited workflow records.
- Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 is implemented: pursuit recommendations now include structured reason details with category, severity, explanation, evidence label, and suggested action while preserving saved decision history.
- Knowledge Station has moved earlier as a Product 0.9 / workflow coaching layer, while deeper procurement intelligence remains post-MVP.
- Response Workspace Lite is implemented with durable response workspace items, Business-gated APIs, editable status/notes, grouped tasks/checkpoints/artifact placeholders/package outline sections, and bilingual UI.
- The refreshed Drive Phase II requirements add cross-cutting P0 standards: Foundation Refined, Configurable Before Custom, Audit Event Logging Matrix, Transferability Requirements, Universal UX States, and source ingestion governance.
- P0 Standards Alignment Lite is implemented locally as a first foundation slice: transferability docs, config registry, event log/outbox, request context, universal UX state component with `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` primary state usage, source governance metadata, Admin source approval display, and local/production-mode risk-check source governance coverage.
- MySQL cutover has advanced: the project now has `mysql2`, MySQL migration/smoke scripts, MySQL URL validation, a MySQL 8 smoke-verified compatibility schema path, a cutover runbook, and MySQL runtime coverage for auth/session, account profile/password/delete, workspace read/update, admin auth gate, billing subscription/checkout/portal/cancel/webhook/invoices, supplier profile, bid search/detail/saved-bids, intent create/list/detail/status, crawler health, and admin crawler logs. Remaining gaps are concentrated in password reset, account export/preferences/usage, workspace member/invite operations, attachment metadata lookup, search alerts, deeper intent panels, admin/config/QA writes, notification/event workers, crawler write/import paths, and data import.

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest remaining gaps are now:

1. Artifact Vault Lite: supplier-managed uploads, intent/bid association, upload failed state, permissions, audit events, and evidence status.
2. P1 data/production readiness after 50-state beta coverage: source approval workflow depth, source health monitoring, production crawler scheduling, production worker runbooks, and official-source upgrades where fallback sources are being used.
3. Product 3-5 lightweight MVP workflows: Quote/Supply Chain, Deadline Notifications, Response Workspace depth, Submission completion, Award/Tabulation, and Win/Loss Learning.
4. Production-grade AI and citation layer with confidence, AI unavailable state, prompt/model/cost logging, and human review controls.
5. Enterprise and intelligence depth: Knowledge Station retrieval, credit consumption, usage metrics, Product 6 data capture, and custom permission rules only after real cases exist.

## Implementation Coverage by Product Area

| Area | Status | Evidence in local code | Gap |
|---|---|---|---|
| P0 Platform shell | Partial/Improving | Layout, nav, auth APIs, settings, bilingual shell, plan labels, credits foundation, transferability pack, request/correlation ids | Production execution, page-wide UniversalState rollout, and real account-specific handoff values |
| P0 Data model | Partial | Users, sessions, organizations, bids, attachments, saved bids, profiles, intents, alerts, crawlers, notification outbox, data sources, billing/subscription tables, source governance fields, MySQL migration preparation | Active MySQL runtime cutover, credit ledger, raw archive, quality flags depth, workspace artifacts, quote/award objects |
| P0 Configuration | Foundation implemented | Central feature map, organization feature overrides, `config_registry`, seed defaults, admin config APIs, effective dates, change reason, transactional config-change audit linkage, denied audit events | Full Admin config UI, broader config migration, and production governance operations |
| P0 Audit/Event | Foundation implemented | Access/deletion/override audits, crawler logs, billing events, notification outbox, QA correction history, `event_log`, `event_outbox`, request/correlation ids, metadata redaction, idempotency conflict fallback | Broader event coverage across all modules |
| P0 Universal UX states | Foundation implemented | Several pages include loading/empty/error/locked states; reusable UniversalState component/model exists; `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` use it for primary page states | Lower-level inline module errors and structured API state-code standardization |
| P0 Transferability | Foundation implemented | `docs/transferability/` includes setup/deployment/env/data/runbook/known-limitations/AWS-service-map/secrets/access docs | Production-specific account IDs, live environment values, and real backup/restore execution |
| P1 Bid source discovery | Partial/Improving | Data source admin, crawler logs, SAM.gov/state runner, 50-state state crawler registry/runner foundation, admin crawler maturity/capability display | Full Source Registry metadata model, non-federal/non-state coverage, continued per-state connector maturity |
| P1 Bid ingestion | Partial/Improving | Normalization, dedupe, crawler logs, seeded data, runner APIs, non-empty crawler result guardrails, local attachment download serving for crawler-managed files, 50-state state source registry, CA/TX/NY/FL/IL verified dedicated adapters, and the remaining 45 state sources live-validated through beta dedicated parser adapters | Connector Engine boundaries, document parsing, data quality scoring, raw/detail/attachment archival by source, official-source upgrades for states currently using public fallback sources |
| P1 Bid display/search | Partial/Good | `/search`, bid cards, filters, detail page | Closed bids, richer filter taxonomy, saved search UX polish |
| P1 Saved bids/alerts | Partial/Good | Saved bids, search alerts, notifications foundation | Real email delivery settings, alert digest UI, monitoring |
| P1 Supplier profile | Partial/Good | `/profile`, API, validation, completion score | Upload-to-fill profile, richer certifications, past performance, warehouse, insurance/bonding |
| P1 Match scoring | Partial/Good | Deterministic score and explanation | AI-assisted scoring, weighting config, source citations, category/code matching |
| P2 Intent to Bid | Partial/Good | Intent creation/list/detail/status | More statuses, owner notes, timeline, decision history, no-bid reasons |
| P2 Bid Understanding | Partial/Improving | Rule-generated brief/checklist/risk flags, persisted evidence citations, deterministic document-grounded Q&A, and amendment/addenda freshness/refresh controls | Real AI extraction, document-level requirements, confidence, open questions, richer risk explanations |
| P2 Compliance manifest | Lite implemented | Compliance manifest model/API/UI exists | Required forms, registrations, addenda, certifications, deadlines, evidence mapping need richer extraction |
| P2 Pursue/no-bid | Lite implemented | Structured recommendation reason taxonomy, risk explanations, decision capture, and history exist | Timeline and richer evidence links can be expanded |
| P3 Response workspace | Missing | No task/doc/quote workspace | Task board, artifact vault, reusable docs, internal checkpoints |
| P3 Sourcing/quotes | Missing | No supplier/freight/quote objects | Partner DB, quote inquiry, quote entry, comparison, attachments |
| P4 Submission guidance | Lite implemented | Submission path, complexity score, readiness checklist, confirmation API/UI exist | Direct submission, calendar/email integration, assignments remain out of scope |
| P5 Award tracking | Missing | No award/tabulation objects | Official status, tabulation, award notice, win/loss analysis |
| P6 Procurement intelligence | Missing | No intelligence models | Buyer, competitor, pricing, category, forecasting, performance intelligence |
| Knowledge Station | Missing but moved earlier | No knowledge model | Product 0.9 workflow coaching, reusable knowledge capture, retrieval-backed guidance |

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

The best next development target is now **Artifact Vault Lite** because the P0 Standards Alignment Lite foundation is in place and Response Workspace has artifact placeholders but no supplier-managed artifact workflow.

Why:

- It turns Response Workspace artifact placeholders into usable supplier evidence.
- It exercises the new P0 standards immediately: config-aware limits, upload failed state, permission denied state, audit events, and transferability/storage documentation.
- It becomes the dependency for Quote/Supply Chain, Compliance evidence history, Knowledge Station uploads, and response package generation.
- It is a thin MVP slice that improves real user workflow without jumping prematurely to full production AI.

## Recommended Next Feature Slice

### Artifact Vault Lite

Scope:

- Add supplier-managed artifact uploads with local storage.
- Associate artifacts with intent and bid records.
- Classify artifacts by response/evidence/business purpose.
- Enforce organization, tier, feature, and permission rules.
- Use `UniversalState` for upload failed, permission denied, plan limit, empty, and error states.
- Write audit events for upload/create/delete/status changes.
- Update risk-check/status docs for artifact routes and non-404 local file access.

Out of scope:

- Full document generation.
- Production S3 storage.
- Malware scanning beyond validation placeholders.
- Full Knowledge Station upload workflow.
- Quote marketplace.
- LLM drafting or extraction.

## Secondary Next Feature Slice

### Quote / Supply Chain Lite

Scope:

- Add partner database.
- Add quote request draft flow.
- Add quote comparison.
- Link quote evidence to artifacts where available.
- Enforce Response Builder/Business feature access.

This should run after Artifact Vault Lite because quotes naturally need supplier attachments and evidence records.

## Data Model Gaps

Already implemented near-term tables:

- `submission_paths`
- `submission_confirmations`
- `compliance_manifest_items`
- `pursuit_decisions`

Recommended near-term tables still pending:

- `credit_usage_events`
- `credit_balances` or an equivalent derived usage view
- `crawler_source_capabilities`
- `crawler_source_registry_metadata`
- `crawler_document_archives`
- `bid_quality_reviews`
- `sourcing_partners`
- `freight_partners`
- `quote_requests`
- `quotes`
- `response_tasks`
- `artifacts`

Recommended later tables:

- `sourcing_partners`
- `freight_partners`
- `quote_requests`
- `quotes`
- `artifacts`
- `award_records`
- `tabulation_records`
- `win_loss_reviews`
- `knowledge_items`

## API Gaps

Already implemented near-term APIs:

- `GET /api/intents/:id/submission`
- `PATCH /api/intents/:id/submission`
- `POST /api/intents/:id/submission/confirm`
- `GET /api/intents/:id/compliance`
- `PATCH /api/intents/:id/compliance`
- `POST /api/intents/:id/decision`
- `GET /api/bids/:id/attachments/:attachmentId` for local crawler-managed files

Recommended near-term APIs still pending:

- Plan/catalog API copy updates for product-facing plan labels and credit language.
- Credit usage summary API if the current usage API cannot carry all needed display fields.
- Source capability/admin notes APIs.
- Attachment/archive status APIs.
- Sourcing partner and quote request APIs.
- Response task/artifact APIs.

## UI Gaps

Already implemented near-term UI additions:

- Intent detail Submission section.
- Intent detail Compliance section.
- Pursue/no-bid decision panel.

Recommended near-term UI additions still pending:

- Settings Billing and Usage plan-label reconciliation.
- Contextual paywall and locked-state copy updates for the latest plan names.
- Source capability/coverage status in Admin.
- Attachment/archive/data-quality status in Admin.
- Response Workspace task/artifact sections.
- Quote inquiry and comparison UI.

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

1. Artifact Vault Lite.
2. P1 Data/Production Readiness: 50-state adapter verification batches, source quality monitoring, production crawler scheduling, production worker dry runs, production email provider, and UI/UE polish on real pages.
3. Supply Chain and Quote Lite.
4. Deadline Notifications and production Search Alerts provider monitoring.
5. Response Workspace depth: assignment, comments, version history, document generation, and reminders.
6. Submission Guidance Completion.
7. Award / Tabulation Tracking Lite.
8. Win/Loss Learning Lite.
9. Production AI layer with confidence, citations, prompt/model/version/cost logs, and AI unavailable handling.
10. Knowledge Station depth, credit consumption, advanced usage metrics, Product 6 data capture, and custom enterprise rules.

This order follows the user journey after Intent and avoids overbuilding advanced intelligence before the workflow is usable.
