# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Product 2 No-Bid Taxonomy + Qualification Risk Explanations v1** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, publish/suppress controls, batch QA actions, rich QA filters, correction history, Search Alerts management UI and delivery history, notification provider hardening, 50-state crawler guardrails, production billing/worker runbooks, Qualification Evidence Citations v1, Document-Grounded Q&A v1, and Amendment/Addenda Awareness v1 are now in place. The next risk is decision clarity: users can refresh stale evidence, but no-bid reasons and qualification risk explanations are still too generic for repeatable pursuit review.

## Last Completed Phase

**Product 2 Amendment/Addenda Awareness v1** made qualification evidence freshness visible and refreshable:

Completed locally:

- Amendment/addenda signal detection covers bid title, description, archived detail text, and attachments.
- `GET /api/intents/[id]/qualification/freshness` reports current/stale/not-refreshed state, latest signal, signal count, and last refreshed timestamp.
- `POST /api/intents/[id]/qualification/freshness` regenerates match snapshot, deterministic brief/checklist/risk flags, and evidence citations without overwriting user-edited submission, compliance, or decision records.
- Intent detail shows qualification freshness beside citations and provides a refresh action that clears old Q&A answers so future questions use the refreshed snapshot.
- Existing citations, Q&A, Submission Guidance, Compliance Manifest, and Pursue/No-Bid APIs remain additive-compatible.

## Previous Completed Phase

**Search Alerts Notification History + Digest Delivery Verification** made alerting auditable:

Completed locally:

- `search_alert_digest_runs` records sent, failed, duplicate, missing-recipient, unsupported-channel, and notification-preference skipped digest outcomes.
- Search alert list responses hydrate recent digest history without changing existing CRUD request shapes.
- The notification service records delivery history while sending/skipping matched alert notifications, including provider failures and worker retry outcomes.
- Settings shows each alert's latest digest status, match count, failure/skipped reason, and recent history.
- Existing quota gates, alert preferences, notification outbox, and API shapes remain compatible.

## Earlier Completed Phase

**Document-Grounded Q&A v1** made qualification interaction evidence-bound:

Completed locally:

- `/api/intents/[id]/qa` accepts a question and returns a deterministic answer grounded only in existing qualification citations.
- The Q&A route is gated by the current Pro-level `bid.brief.full.generate` entitlement and reuses the existing principal/session pattern.
- The Q&A service ranks citation excerpts against the question and falls back to closest available evidence instead of inventing unsupported claims.
- The Intent detail page shows a compact Ask the Evidence panel with answer text and supporting citation links.
- Existing Submission Guidance, Compliance Manifest, Pursue/No-Bid, and citations wire shapes remain unchanged.

## Earlier Completed Phase

**Qualification Evidence Citations v1** made generated qualification outputs evidence-backed:

Completed locally:

- `intent_to_bid` now stores an `evidence_citations_json` snapshot.
- Qualification citations are generated from bid fields, source URLs, archived detail metadata, attachments, and deterministic generated output.
- `/api/intents/[id]/citations` exposes read-only citations through the existing principal/session pattern.
- The Intent detail page shows a compact evidence panel near the generated brief.
- Existing Submission Guidance, Compliance Manifest, and Pursue/No-Bid wire shapes remain unchanged.

## Earlier Completed Phase

**Admin Bid QA Console Thin Slice** made quality issues actionable from `/admin`:

Completed locally:

- `bids` stores review note, reviewed timestamp, and reviewer id.
- Admin QA repository computes quality score and summary counts from deadline, source confidence, quality flags, attachment archive status, and detail archive status.
- `/api/admin/bids/qa` lists QA records with filters for query, state, review status, and archive status.
- `/api/admin/bids/qa/[id]` lets admin/operator update review status; support remains read-only.
- `/admin` displays the Bid Data QA queue with quality score, archive issue count, review status, and quick Reviewed / Needs review actions.

## Earlier Completed Data Phase

**Attachment Download Archival Downloader** turned state/SAM crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

Completed locally:

- Public HTTP(S) attachments and optional detail pages are downloaded into the configured local attachment archive.
- Archive metadata records local path, byte size, content type, SHA-256 checksum, fetched timestamp, status, and failure reason.
- Non-public, login-like, CAPTCHA/browser-required, and non-HTTP URLs are marked unavailable instead of being force-fetched.
- Fetch failures mark individual attachments failed without dropping otherwise non-empty crawler runs.
- Frontend SAM.gov/state runners default to archive downloads and bid detail surfaces archive status/failure notes.

## Phase Goal

Make Product 2 pursuit decisions more explainable and repeatable:

`Qualification Evidence -> Risk Reasons -> No-Bid Taxonomy -> User Decision`

This phase should turn generic deterministic risks into structured pursuit reasons, clearer no-bid categories, and evidence-linked explanations users can review before deciding.

## In Scope

- Add a no-bid reason taxonomy for fit, compliance, deadline, pricing, geography, documentation, registration, and risk categories.
- Expand deterministic risk explanations with evidence references where available.
- Show structured reasons in the Intent detail decision area.
- Preserve existing decision history and user-entered notes.
- Keep existing freshness, citations, Q&A, Submission Guidance, and Compliance Manifest APIs additive-compatible.

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Real production email provider credentials.
- Full legal/compliance interpretation.
- LLM-based document extraction.
- New document downloader logic beyond using already archived bid evidence.
- Broad redesign of Intent detail.

## Acceptance Criteria

- Existing 50-state crawler, Admin QA, Search Alerts, notification, billing, freshness, citations, and Q&A tests remain green.
- Users can see structured no-bid / pursue rationale instead of only free-form notes.
- Decision reasons are mapped to a stable taxonomy and can be rendered in English/Chinese UI.
- Existing Submission Guidance, Compliance Manifest, Amendment Awareness, Q&A, Search Alerts, and Search/bid detail still work for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade continuation: richer evidence/artifact links after no-bid taxonomy and qualification risk explanations.
2. 50-state crawler hardening continuation: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
3. Production deployment dry run for billing, notification, and crawler workers.
4. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
5. Knowledge Station Lite as Product 0.9 workflow coaching.
6. Response Workspace Lite and Artifact Vault Lite.
7. Supply Chain and Quote Lite.
8. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
9. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
