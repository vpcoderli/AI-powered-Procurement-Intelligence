# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Product 2 Amendment/Addenda Awareness v1** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, publish/suppress controls, batch QA actions, rich QA filters, correction history, Search Alerts management UI and delivery history, notification provider hardening, 50-state crawler guardrails, production billing/worker runbooks, Qualification Evidence Citations v1, and Document-Grounded Q&A v1 are now in place. The next risk is qualification freshness: users can inspect evidence and ask questions, but addenda/amendments can change deadlines, requirements, and pursuit decisions after an intent has already been created.

## Last Completed Phase

**Search Alerts Notification History + Digest Delivery Verification** made alerting auditable:

Completed locally:

- `search_alert_digest_runs` records sent, failed, duplicate, missing-recipient, unsupported-channel, and notification-preference skipped digest outcomes.
- Search alert list responses hydrate recent digest history without changing existing CRUD request shapes.
- The notification service records delivery history while sending/skipping matched alert notifications, including provider failures and worker retry outcomes.
- Settings shows each alert's latest digest status, match count, failure/skipped reason, and recent history.
- Existing quota gates, alert preferences, notification outbox, and API shapes remain compatible.

## Previous Completed Phase

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

Make Product 2 qualification safer when bid documents change:

`Bid Update/Addendum -> Intent Evidence Refresh -> Qualification Snapshot -> User Review`

This phase should let an intent detect amendment/addenda signals, surface whether qualification artifacts may be stale, and give the user a deterministic refresh path for the bid brief, evidence citations, Q&A context, guidance, compliance, and pursue/no-bid decision.

## In Scope

- Add bid/intent metadata to identify amendment or addenda related evidence from title, description, attachments, or source detail text.
- Add an intent-level qualification freshness flag and last refreshed timestamp.
- Add a deterministic refresh service that regenerates qualification citations and existing Product 2 derived artifacts from current bid evidence.
- Show stale/current amendment awareness state in Intent detail.
- Keep existing Submission Guidance, Compliance Manifest, Pursue/No-Bid, citations, and Q&A APIs additive-compatible.

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Real production email provider credentials.
- Full legal/compliance interpretation of amendment text.
- LLM-based document extraction.
- New document downloader logic beyond using already archived bid evidence.
- Broad redesign of Intent detail.

## Acceptance Criteria

- Existing 50-state crawler, Admin QA, Search Alerts, notification, and billing tests remain green.
- Users can see whether an intent's qualification evidence is current or may be stale because amendment/addenda signals exist.
- Refreshing qualification evidence updates the citation snapshot and downstream deterministic Product 2 artifacts without losing user notes/history.
- Q&A uses the refreshed citation snapshot.
- Existing Submission Guidance, Compliance Manifest, Pursue/No-Bid, Search Alerts, and Search/bid detail still work for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade continuation: richer evidence/artifact links, no-bid taxonomy, and qualification risk explanations.
2. 50-state crawler hardening continuation: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
3. Production deployment dry run for billing, notification, and crawler workers.
4. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
5. Knowledge Station Lite as Product 0.9 workflow coaching.
6. Response Workspace Lite and Artifact Vault Lite.
7. Supply Chain and Quote Lite.
8. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
9. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
