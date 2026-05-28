# WinBids Current Gap Analysis

Updated: 2026-05-28

## Summary

The local system has completed a useful Phase 1A pursuit loop:

`Search bid -> view match score -> add to Intent -> review deterministic brief/checklist/risks -> open Intent workspace`

The remaining MVP work is not another search page. The largest gaps are:

1. Submission guidance and readiness.
2. Compliance manifest.
3. Pursue/no-bid decisioning.
4. Supplier/sourcing partner and quote workflow.
5. Award/status tracking and learning.
6. Production-grade AI and citation layer.

## Implementation Coverage by Product Area

| Area | Status | Evidence in local code | Gap |
|---|---|---|---|
| P0 Platform shell | Partial | Layout, nav, auth APIs, settings, bilingual shell | Subscription tiers, real organization/workspace model, role UI, security hardening |
| P0 Data model | Partial | Users, sessions, bids, attachments, saved bids, profiles, intents, alerts, crawlers, notification outbox, data sources | Full ERD objects for submission, compliance, sourcing, quotes, awards, knowledge |
| P1 Bid source discovery | Partial | Data source admin, crawler logs, SAM.gov/state runner | Wider source registry, source classification, non-federal/non-state coverage |
| P1 Bid ingestion | Partial | Normalization, dedupe, crawler logs, seeded data, runner APIs | Production connectors, document parsing, data quality scoring, attachment extraction |
| P1 Bid display/search | Partial/Good | `/search`, bid cards, filters, detail page | Closed bids, richer filter taxonomy, saved search UX polish |
| P1 Saved bids/alerts | Partial/Good | Saved bids, search alerts, notifications foundation | Real email delivery settings, alert digest UI, monitoring |
| P1 Supplier profile | Partial/Good | `/profile`, API, validation, completion score | Upload-to-fill profile, richer certifications, past performance, warehouse, insurance/bonding |
| P1 Match scoring | Partial/Good | Deterministic score and explanation | AI-assisted scoring, weighting config, source citations, category/code matching |
| P2 Intent to Bid | Partial/Good | Intent creation/list/detail/status | More statuses, owner notes, timeline, decision history, no-bid reasons |
| P2 Bid Understanding | Partial | Rule-generated brief/checklist/risk flags | Real AI extraction, citations, document-level requirements, confidence, open questions |
| P2 Compliance manifest | Missing | No dedicated data model/API/page | Required forms, registrations, addenda, certifications, deadlines, evidence mapping |
| P2 Pursue/no-bid | Missing | No decision assistant | Structured recommendation, decision capture, no-bid taxonomy |
| P3 Response workspace | Missing | No task/doc/quote workspace | Task board, artifact vault, reusable docs, internal checkpoints |
| P3 Sourcing/quotes | Missing | No supplier/freight/quote objects | Partner DB, quote inquiry, quote entry, comparison, attachments |
| P4 Submission guidance | Missing | No submission path object | Portal guidance, complexity score, readiness checklist, confirmation |
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

The best next development target is **Submission Guidance Lite** because it directly follows the current Intent workspace and appears in the MVP success definition before quotes and awards.

Why:

- It uses the bid and intent records that now exist.
- It creates the next visible user value after the AI brief.
- It does not require full quote management or award tracking.
- It prepares the data model for Phase 2.
- It reduces a real SMB pain point: external portal and submission complexity.

## Recommended Next Feature Slice

### Submission Guidance Lite

Scope:

- Add a `submission_paths` table keyed to bid/intent.
- Generate deterministic submission guidance from bid source URL, issuer type, source, attachments, contact fields, and deadline.
- Add submission complexity score.
- Add readiness checklist.
- Add confirmation record fields.
- Show this on the intent detail page.

Out of scope:

- Direct submission.
- Portal login automation.
- Calendar/email integration.
- Multi-user assignment.
- Full compliance matrix.

## Secondary Next Feature Slice

### Compliance Manifest Lite

Scope:

- Extract and store checklist items as structured compliance requirements.
- Categorize requirements: eligibility, registration, forms, attachments, addenda, pricing, delivery, deadline.
- Allow manual check/uncheck and notes.
- Link checklist state to intent workspace.

This should come after Submission Guidance Lite unless the user wants bid preparation depth before external submission guidance.

## Data Model Gaps

Recommended near-term tables:

- `submission_paths`
- `submission_confirmations`
- `compliance_requirements`
- `pursuit_decisions`

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

Recommended near-term APIs:

- `GET /api/intents/:id/submission`
- `PATCH /api/intents/:id/submission`
- `POST /api/intents/:id/submission/confirm`
- `GET /api/intents/:id/compliance`
- `PATCH /api/intents/:id/compliance/:requirementId`
- `POST /api/intents/:id/decision`

## UI Gaps

Recommended near-term UI additions:

- Intent detail tab or section: `Submission`.
- Intent detail tab or section: `Compliance`.
- Pursue/no-bid decision panel.
- Progress indicator across: brief, compliance, submission, decision.

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

1. Submission Guidance Lite.
2. Compliance Manifest Lite.
3. Pursue/No-Bid Decision Lite.
4. Sourcing Partner + Quote Inquiry Lite.
5. Award/Tabulation Tracking Lite.
6. Knowledge Station Lite.

This order follows the user journey after Intent and avoids overbuilding advanced intelligence before the workflow is usable.
