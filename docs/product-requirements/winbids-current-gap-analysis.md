# WinBids Current Gap Analysis

Updated: 2026-05-29

## Current Implementation Note

This file is now being used as a staged implementation backlog. Some original gaps have been closed since this analysis was first written:

- Submission Guidance Lite is implemented.
- Compliance Manifest Lite is implemented.
- Pursue / No-Bid Decision Lite is implemented.
- Account, role, tier, feature gate, organization, billing foundation, dunning foundation, and operator/support admin roles are substantially implemented.
- State crawler coverage now has a 50-state registry/runner foundation: CA/TX/NY/FL/IL keep verified dedicated adapters; PA/SC/OR/MA/NJ/OH/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY now have beta dedicated adapters; remaining states stay registered with a generic public procurement HTML/JSON fetcher so they can be scheduled, logged, and replaced over time.
- 50-state crawler quality has started moving from foundation to batches: PA/SC/OR, MA/NJ/OH/VA/WA, IA/GA/ME/MO/NV, UT/KS/MT/NM/CO/IN/MS/CT, and OK/AR/SD/WV/WY now have beta dedicated parser adapters with fixture-backed extraction; live validation currently confirms non-empty PA/OR/MA/NJ/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY results, while SC is blocked by site timeouts from the local environment and OH is blocked by the current OhioBuys browser-check flow.
- Crawler ingestion now treats empty result sets as failures for CLI imports/live fetches and rejects state opportunities without a source id or title, so empty content is no longer silently recorded as a successful run.
- Local crawler attachment files can be served through a private bid attachment API when attachment rows point to a local file path inside an allowed attachment directory.

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest remaining gaps are:

1. 50-state crawler adapter quality: continue replacing generic state adapters with reliable source-specific adapters in batches, plus attachment/detail-page extraction and live validation.
2. Full Search Alerts UI and production email delivery.
3. Supplier/sourcing partner and quote workflow.
4. Award/status tracking and learning.
5. Response workspace tasks/artifacts/checkpoints.
6. Production-grade AI and citation layer.
7. Knowledge Station Lite.

## Implementation Coverage by Product Area

| Area | Status | Evidence in local code | Gap |
|---|---|---|---|
| P0 Platform shell | Partial | Layout, nav, auth APIs, settings, bilingual shell | Subscription tiers, real organization/workspace model, role UI, security hardening |
| P0 Data model | Partial | Users, sessions, bids, attachments, saved bids, profiles, intents, alerts, crawlers, notification outbox, data sources | Full ERD objects for submission, compliance, sourcing, quotes, awards, knowledge |
| P1 Bid source discovery | Partial/Improving | Data source admin, crawler logs, SAM.gov/state runner, 50-state state crawler registry/runner foundation, admin crawler maturity/capability display | Non-federal/non-state coverage, continued per-state connector maturity |
| P1 Bid ingestion | Partial/Improving | Normalization, dedupe, crawler logs, seeded data, runner APIs, non-empty crawler result guardrails, local attachment download serving for crawler-managed files, PA/OR/MA/NJ/VA/WA/IA/GA/ME/MO/NV/UT/KS/MT/NM/CO/IN/MS/CT/OK/AR/SD/WV/WY live-validated dedicated parser adapters, SC/OH beta adapters with current access blockers | Production connectors, document parsing, data quality scoring, attachment download/archival by source, more dedicated state adapters, browser/session handling for blocked state portals |
| P1 Bid display/search | Partial/Good | `/search`, bid cards, filters, detail page | Closed bids, richer filter taxonomy, saved search UX polish |
| P1 Saved bids/alerts | Partial/Good | Saved bids, search alerts, notifications foundation | Real email delivery settings, alert digest UI, monitoring |
| P1 Supplier profile | Partial/Good | `/profile`, API, validation, completion score | Upload-to-fill profile, richer certifications, past performance, warehouse, insurance/bonding |
| P1 Match scoring | Partial/Good | Deterministic score and explanation | AI-assisted scoring, weighting config, source citations, category/code matching |
| P2 Intent to Bid | Partial/Good | Intent creation/list/detail/status | More statuses, owner notes, timeline, decision history, no-bid reasons |
| P2 Bid Understanding | Partial | Rule-generated brief/checklist/risk flags | Real AI extraction, citations, document-level requirements, confidence, open questions |
| P2 Compliance manifest | Lite implemented | Compliance manifest model/API/UI exists | Required forms, registrations, addenda, certifications, deadlines, evidence mapping need richer extraction |
| P2 Pursue/no-bid | Lite implemented | Structured recommendation, decision capture, and history exist | No-bid taxonomy and timeline can be expanded |
| P3 Response workspace | Missing | No task/doc/quote workspace | Task board, artifact vault, reusable docs, internal checkpoints |
| P3 Sourcing/quotes | Missing | No supplier/freight/quote objects | Partner DB, quote inquiry, quote entry, comparison, attachments |
| P4 Submission guidance | Lite implemented | Submission path, complexity score, readiness checklist, confirmation API/UI exist | Direct submission, calendar/email integration, assignments remain out of scope |
| P5 Award tracking | Missing | No award/tabulation objects | Official status, tabulation, award notice, win/loss analysis |
| P6 Procurement intelligence | Missing | No intelligence models | Buyer, competitor, pricing, category, forecasting, performance intelligence |
| Knowledge Station | Missing/Deferred | No knowledge model | Reusable knowledge capture and retrieval |

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

The best next development target is now **state crawler quality + source maturity** if the priority is data coverage, or **Full Search Alerts UI** if the priority is user workflow. Submission Guidance Lite, Compliance Manifest Lite, and Pursue / No-Bid Decision Lite are no longer the next gaps because they already exist locally.

Why:

- It uses the bid and intent records that now exist.
- It creates the next visible user value after the AI brief.
- It does not require full quote management or award tracking.
- It prepares the data model for Phase 2.
- It reduces a real SMB pain point: external portal and submission complexity.

## Recommended Next Feature Slice

### 50-State Crawler Quality Batch 6

Scope:

- Keep the 50-state registry as the scheduler/admin source of truth.
- Choose the next 5 to 8 generic states and replace their generic adapters with source-specific fetchers.
- Add per-state fixtures for live-like responses.
- Add detail-page/attachment metadata extraction where the source exposes public attachment links.
- Continue recording source capability notes: supports query, supports pagination, supports attachment metadata, requires browser, or requires manual/login handling.
- Keep generic adapters for remaining states, but mark them as foundation coverage rather than mature connectors.

Out of scope:

- Login-only portals and CAPTCHA bypass.
- Full document parsing/OCR.
- Browser automation for every state in the same batch.
- Claiming all 50 states have production-grade live data quality before dedicated adapters exist.

## Secondary Next Feature Slice

### Full Search Alerts UI

Scope:

- Add a user-facing search alerts management view.
- List saved alerts, enable/disable them, edit keywords/states/categories, and set digest frequency per alert.
- Connect existing notification preferences and quota enforcement to the UI.
- Keep production email provider hardening separate from the local UI slice.

This can run in parallel with crawler adapter batches because it mostly touches account/settings/search-alert UI and API surfaces.

## Data Model Gaps

Already implemented near-term tables:

- `submission_paths`
- `submission_confirmations`
- `compliance_manifest_items`
- `pursuit_decisions`

Recommended near-term tables still pending:

- `crawler_source_capabilities`
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

- Search alert management UI-backed update endpoints if current API shape is insufficient.
- Source capability/admin notes APIs.
- Sourcing partner and quote request APIs.
- Response task/artifact APIs.

## UI Gaps

Already implemented near-term UI additions:

- Intent detail Submission section.
- Intent detail Compliance section.
- Pursue/no-bid decision panel.

Recommended near-term UI additions still pending:

- Full Search Alerts management UI.
- Source capability/coverage status in Admin.
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

- Source coverage and crawler quality need continued expansion.
- Notification outbox exists, but production delivery behavior needs configuration.
- Admin data QA should track correction status and publish confidence.
- Local extracted Drive docs are temporary; this summary should be the source for local work unless docs are refreshed.

## Recommended Development Order

1. 50-State Crawler Quality Batch 6: dedicated adapters for the next 5 to 8 generic states, plus live validation and richer capability notes.
2. Full Search Alerts UI.
3. Sourcing Partner + Quote Inquiry Lite.
4. Response Workspace Lite: tasks, artifacts, internal checkpoints.
5. Award/Tabulation Tracking Lite.
6. Knowledge Station Lite.
7. Production AI and citation layer.

This order follows the user journey after Intent and avoids overbuilding advanced intelligence before the workflow is usable.
