# WinBids Current Gap Analysis

Updated: 2026-05-31

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
- The refreshed Drive requirements add a commercial packaging and credits track: product-facing plans are now Free, Pursuit Starter, Response Builder, Growth, and Enterprise, while the current database still uses `free`, `pro`, `business`, and `enterprise` compatibility values.
- Product 2 Amendment/Addenda Awareness v1 is implemented: intent qualification freshness detects amendment/addenda signals, exposes freshness/refresh APIs, and lets Intent detail refresh match/brief/checklist/risk/citation snapshots without overwriting user-edited workflow records.
- Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1 is implemented: pursuit recommendations now include structured reason details with category, severity, explanation, evidence label, and suggested action while preserving saved decision history.
- Knowledge Station has moved earlier as a Product 0.9 / workflow coaching layer, while deeper procurement intelligence remains post-MVP.

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest remaining gaps are:

1. P1 data pipeline hardening after 50-state beta coverage: Source Registry metadata, connector capability tracking, attachment/detail-page archival, checksum/content-type recording, data quality flags, and official-source upgrades where fallback sources are being used.
2. Product 2 upgrade continuation: richer evidence/artifact links, compliance evidence mapping, and decision history.
3. Product 0.9 Knowledge Station Lite: embedded workflow coaching and reusable knowledge capture.
4. Product 3-5 lightweight MVP workflows: response workspace, artifacts, sourcing/quotes, submission completion, award/status learning.
5. Production-grade AI and citation layer.

## Implementation Coverage by Product Area

| Area | Status | Evidence in local code | Gap |
|---|---|---|---|
| P0 Platform shell | Partial | Layout, nav, auth APIs, settings, bilingual shell | Product-facing plan labels, credit model, billing/dashboard copy, richer role UI, security hardening |
| P0 Data model | Partial | Users, sessions, organizations, bids, attachments, saved bids, profiles, intents, alerts, crawlers, notification outbox, data sources, billing/subscription tables | Credit ledger, source registry metadata, raw archive, quality flags, workspace artifacts, quote/award/knowledge objects |
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

The best next development target is now **P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata** because commercial packaging and credits foundation now exists locally.

Why:

- It turns 50-state beta coverage into more durable evidence, not just search cards.
- It supports future citation, compliance, and response workflows with archived source material.
- It directly addresses the remaining crawler risk where some states still rely on fallback sources.
- It gives Admin/Data QA a stronger foundation for correction and confidence tracking.

## Recommended Next Feature Slice

### P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata

Scope:

- Keep the 50-state registry as the scheduler/admin source of truth.
- Download attachments and detail-page documents for already live-validated dedicated adapters.
- Record checksum, byte size, content type, original URL, local storage path, download status, source capability notes, and quality flags.
- Separate Source Registry, Connector Engine, Normalization/Data Quality, and Bid Admin/Data QA responsibilities in code and docs.
- Keep official-source upgrades for MI/SC/OH as follow-on source-maturity work unless a stable official feed appears during implementation.

Out of scope:

- Login-only portals and CAPTCHA bypass.
- Full document parsing/OCR.
- Browser automation for every state in the same batch.
- Replacing every public fallback source with an official source in the same slice.

## Secondary Next Feature Slice

### Product 2 Qualification Upgrade

Scope:

- Extend existing source-grounded citations, document-grounded Q&A, and amendment freshness with richer evidence/artifact links.
- Expand compliance evidence mapping and link structured reasons to source artifacts.
- Preserve deterministic fallback behavior while preparing for production AI.

This can run after data hardening or in parallel if implementation slices do not touch crawler/archive code.

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

1. P1 Data Pipeline Hardening: Attachment Archival + Source Registry Metadata.
2. Bid Admin/Data QA Console Expansion.
3. Product 2 Qualification Upgrade continuation: richer evidence/artifact links and compliance evidence mapping.
4. Knowledge Station Lite: embedded workflow coaching and reusable knowledge capture.
5. Response Workspace Lite + Artifact Vault Lite.
6. Supply Chain and Quote Lite.
7. Deadline Notifications and production Search Alerts provider monitoring.
8. Submission Guidance Completion.
9. Award Tracking and Learning Lite.
10. Product 6 procurement intelligence data capture only.

This order follows the user journey after Intent and avoids overbuilding advanced intelligence before the workflow is usable.
