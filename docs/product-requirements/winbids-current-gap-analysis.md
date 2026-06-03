# WinBids Current Gap Analysis

Updated: 2026-06-02

## Current Implementation Note

This file is now being used as a staged implementation backlog. Some original gaps have been closed since this analysis was first written:

- Submission Guidance Lite is implemented.
- Compliance Manifest Lite is implemented.
- Pursue / No-Bid Decision Lite is implemented.
- Account, role, tier, feature gate, organization, billing foundation, dunning foundation, and operator/support admin roles are substantially implemented.
- State crawler coverage now has a 50-state registry/runner foundation: CA/TX/NY/FL/IL keep verified dedicated adapters; the other 45 state sources now have beta dedicated adapters with source-specific parser entry points and admin runner metadata.
- 50-state crawler quality has moved from foundation to complete beta coverage: PA/SC/OR, MA/NJ/OH/VA/WA, IA/GA/ME/MO/NV, UT/KS/MT/NM/CO/IN/MS/CT, OK/AR/SD/WV/WY, AL/AK/HI/KY/MN/WI/NH, DE/RI/TN, AZ/ID/LA/MD/NE/NC/ND/VT, and MI now have fixture-backed dedicated parser adapters; local live validation confirms non-empty results for the full beta set. MI/SC/OH currently use public BidNet fallback pages because the official/default routes are 404, timeout, or browser-check blocked from the local environment.
- 50-state source validity is now explicit in the frontend registry and Admin source projection: each state source is labeled as official, verified/beta, or public aggregator fallback with evidence-mode notes; `risk:check` now fails known demo/placeholder URLs such as `sam.gov/opp/12345` and raw unsafe external state attachment links.
- Python crawler source metadata is aligned with the frontend registry contract: state `Source` objects now carry source authority, trust status, evidence mode, and validity notes, and `fetch-state --output-json` includes `source_validity` metadata for downstream MySQL/crawler logs.
- Operators can run `npm run source:health:check` for live base-URL probing across all 50 state sources or selected state/source ids; this remains separate from deterministic local `risk:check` because valid public portals can still return 403, timeout, or bot-check responses from local environments.
- Crawler ingestion now treats empty result sets as failures for CLI imports/live fetches and rejects state opportunities without a source id or title, so empty content is no longer silently recorded as a successful run.
- Local crawler attachment files can be served through a private bid attachment API when attachment rows point to a local file path inside an allowed attachment directory.
- Local handoff risk verification now has a single command, `npm run risk:check`, covering 50-state active data coverage, non-empty state bid content, bid detail route ID round-trips, safe attachment download routes, account/tier entitlement separation, source ingestion governance, source-validity metadata, state URL validity, and moderate-or-higher production dependency audit findings.
- The refreshed Drive requirements add a commercial packaging and credits track: product-facing plans are now Free, Pursuit Starter, Response Builder, Growth, and Enterprise, while the current database still uses `free`, `pro`, `business`, and `enterprise` compatibility values.
- Product 2 Amendment/Addenda Awareness v1 is implemented: intent qualification freshness detects amendment/addenda signals, exposes freshness/refresh APIs, and lets Intent detail refresh match/brief/checklist/risk/citation snapshots without overwriting user-edited workflow records.
- Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 is implemented: pursuit recommendations now include structured reason details with category, severity, explanation, evidence label, and suggested action while preserving saved decision history.
- Knowledge Station has moved earlier as a Product 0.9 / workflow coaching layer, while deeper procurement intelligence remains post-MVP.
- Response Workspace Lite is implemented with durable response workspace items, Business-gated APIs, editable status/notes, grouped tasks/checkpoints/artifact placeholders/package outline sections, and bilingual UI.
- The refreshed Drive Phase II requirements add cross-cutting P0 standards: Foundation Refined, Configurable Before Custom, Audit Event Logging Matrix, Transferability Requirements, Universal UX States, and source ingestion governance.
- P0 Standards Alignment Lite is implemented locally as a first foundation slice: transferability docs, config registry, event log/outbox, request context, universal UX state component with `/admin`, `/search`, `/bids/[id]`, `/intents/[id]`, and `/settings` primary state usage, source governance metadata, Admin source approval display, and local/production-mode risk-check source governance coverage.
- Admin Config Matrix governance has moved beyond read-only: operators can edit config JSON/status from `/admin`, must provide a change reason, and saves reuse audit-linked PATCH `/api/admin/config/[id]` across SQLite/MySQL runtime paths.
- Admin Source Approval Workflow Lite is implemented: Admin data source rows now combine source validity metadata, latest live health, crawler run/re-run, per-source live health recheck, and approve/hold governance writes.
- MySQL cutover has advanced: the project now has `mysql2`, MySQL migration/smoke scripts, MySQL URL validation, a MySQL 8 smoke-verified compatibility schema path, a cutover runbook, repeatable SQLite-to-MySQL data import, and MySQL runtime coverage for auth/session/password reset, account profile/password/delete/export/preferences/usage, workspace read/update/member/invite/ownership operations, admin auth gate, admin users/feature overrides/audit logs, admin config registry list/upsert/patch with audit events, event outbox delivery, admin data source list/update, admin bid QA list/review/display/correction/batch writes, billing subscription/checkout/portal/cancel/webhook/invoices/dunning scheduling, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler health/admin crawler logs, crawler locks/source enablement orchestration, direct JSON crawler result import/upsert into MySQL, crawler search-alert matching/digest notification, a MySQL-ready Stripe sandbox verifier, aggregate worker preflight via `npm run workers:check`, and production billing credential preflight via `npm run billing:production:check`. Remaining gaps are concentrated in running the operator-assisted Stripe sandbox flow with real test credentials against MySQL and final low-risk live checkout/webhook execution.
- Artifact Vault Lite is implemented with Business-gated supplier-managed upload/list/download, intent/bid association, metadata, local storage, empty/error states, and bilingual Intent UI.
- Quote / Supply Chain Lite is implemented with Business-gated partner records, quote request drafts, linked artifacts, status flow, quote amount/response notes, GET/POST/PATCH APIs, and bilingual Intent UI.
- Deadline Notifications Lite is implemented with a Business-gated deadline registry, idempotent reminders for bid deadlines, response task due dates, quote due dates, and artifact expiries, acknowledge/snooze actions, and a bilingual Intent reminder panel.

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest remaining gaps are now:

1. Response Workspace depth: assignment, comments/activity, version history, artifact-task linking, package outline history, and later document generation prep.
2. P1 data/production readiness after 50-state beta coverage: source approval history/batch queues, production crawler scheduling, production worker runbooks, and official-source upgrades where fallback sources are being used.
3. Product 3-5 lightweight MVP workflows: Response Workspace depth, Submission completion, Award/Tabulation, Win/Loss Learning, and Quote/Supply Chain depth beyond the current v1.
4. Production-grade AI and citation layer with confidence, AI unavailable state, prompt/model/cost logging, and human review controls.
5. Enterprise and intelligence depth: Knowledge Station retrieval, credit consumption, usage metrics, Product 6 data capture, and custom permission rules only after real cases exist.

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
| P3 Response workspace | Lite implemented | Durable response workspace items, task/checkpoint/artifact/outline sections, API/UI, status/notes editing, and task due dates feeding Deadline Notifications Lite | Team assignment, artifact-task linking, comments/activity, version history, reusable docs |
| P3 Sourcing/quotes | Lite implemented | Partner DB, quote requests, status/amount/notes, linked supplier artifacts, and quote due-date reminders exist | Outbound email, supplier portal, response uploads, comparison scoring, audit events, and partner profile depth |
| P3 Deadline reminders | Lite implemented | `deadline_reminders` registry, Intent API/UI, bid/task/quote/artifact reminder generator, account-level Settings reminder center, acknowledge, and snooze exist | Notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, and MySQL runtime adapter |
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

The best next development target is now **Response Workspace depth** because the Intent workspace already has tasks, artifacts, quotes, and reminder visibility, but still lacks the collaboration layer needed for a real team response process.

Why:

- Deadline Notifications Lite has closed the first reminder registry gap for bid deadlines, response task due dates, quote due dates, and artifact expiries.
- Team assignment, comments/activity, version history, and artifact-task linking are now the missing connective tissue between reminders and actual response execution.
- This is the next thin MVP slice before submission completion, award tracking, and win/loss learning.

## Recommended Next Feature Slice

### Response Workspace Depth

Scope:

- Add assignment/owner fields to response workspace items.
- Add comments/activity history for tasks, checkpoints, artifacts, and package sections.
- Link uploaded artifacts to specific response tasks instead of only intent-level association.
- Add lightweight version history for response notes and package outline sections.
- Keep due-date changes feeding Deadline Notifications Lite.

Artifact Vault Lite future depth remains audit events, delete/replace/versioning, compliance auto-linking, production object storage, malware scanning, and retention policy.
Quote / Supply Chain Lite future depth remains outbound email, supplier portal, quote response uploads, comparison scoring, partner profile depth, audit events, and richer compliance linkage.
Deadline Notifications Lite future depth remains notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, Settings reminder center, and MySQL runtime adapter.

Out of scope:

- Full document generation.
- Production S3 storage and malware scanning.
- Full Knowledge Station upload workflow.
- Quote marketplace or supplier portal.
- LLM drafting or extraction.

## Secondary Next Feature Slice

### Submission Guidance Completion

Scope:

- Add stronger submission path state machine and readiness completion.
- Add submission version/history and recovery states.
- Feed confirmation checkpoints into Deadline Notifications depth when scheduling/outbox delivery is implemented.

This should run after Response Workspace depth because assignments/comments should clarify who owns each submission step.

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
- `freight_partners`
- `quotes`
- `deadline_events`
- `response_workspace_comments`
- `response_workspace_versions`

Recommended later tables:

- `freight_partners`
- `quotes`
- `quote_responses`
- `artifact_versions`
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
- Response task assignment/comment/version APIs.
- Deadline registry/reminder APIs now cover Intent GET/PATCH, acknowledge, and snooze; future API work should add delivery scheduling, Settings reminder center, and submission checkpoint sources.

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
- Response Workspace assignment/comment/version UI.
- Settings deadline reminder center.
- Quote comparison and supplier portal UI.

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

1. Response Workspace depth: assignment, comments/activity, artifact-task linking, version history, and package-outline history.
2. P1 Data/Production Readiness: 50-state adapter verification batches, source quality monitoring, production crawler scheduling, production worker dry runs, production email provider, and UI/UE polish on real pages.
3. Submission Guidance Completion.
4. Deadline Notifications depth: notification outbox scheduling, email/calendar delivery, submission checkpoints, and audit events.
5. Quote / Supply Chain depth.
6. Award / Tabulation Tracking Lite.
7. Win/Loss Learning Lite.
8. Production AI layer with confidence, citations, prompt/model/version/cost logs, and AI unavailable handling.
9. Knowledge Station depth, credit consumption, advanced usage metrics, Product 6 data capture, and custom enterprise rules.

This order follows the user journey after Intent and avoids overbuilding advanced intelligence before the workflow is usable.
