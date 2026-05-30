# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Search Alerts Notification History + Digest Delivery Verification** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, publish/suppress controls, batch QA actions, rich QA filters, correction history, Search Alerts management UI, notification provider hardening, 50-state crawler guardrails, production billing/worker runbooks, Qualification Evidence Citations v1, and Document-Grounded Q&A v1 are now in place. The next risk is alert trust: users can configure alerts, but need visible delivery history and digest verification before alerts are credible for daily use.

## Last Completed Phase

**Document-Grounded Q&A v1** made qualification interaction evidence-bound:

Completed locally:

- `/api/intents/[id]/qa` accepts a question and returns a deterministic answer grounded only in existing qualification citations.
- The Q&A route is gated by the current Pro-level `bid.brief.full.generate` entitlement and reuses the existing principal/session pattern.
- The Q&A service ranks citation excerpts against the question and falls back to closest available evidence instead of inventing unsupported claims.
- The Intent detail page shows a compact Ask the Evidence panel with answer text and supporting citation links.
- Existing Submission Guidance, Compliance Manifest, Pursue/No-Bid, and citations wire shapes remain unchanged.

## Previous Completed Phase

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

Make Search Alerts auditable and verifiable:

`Alert Config -> Matching Run -> Digest Candidate -> Notification Outbox -> Delivery History`

This phase should let users and operators see whether alerts produced matches, whether digest notifications were queued/sent/failed, and why a delivery did not happen.

## In Scope

- Add per-alert delivery history derived from existing notification outbox/search alert matching data.
- Add digest run summary fields or a lightweight read model for match count, queued count, sent count, failed count, and skipped preference state.
- Show alert history in Settings under each alert.
- Add admin/operator visibility for failed alert digest delivery where useful.
- Keep existing alert CRUD wire shapes stable unless a versioned additive response field is safer.

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Real production email provider credentials.
- Bounce/complaint webhook handling.
- New alert matching algorithms.
- SMS/push notifications.
- Broad redesign of Settings or Admin.

## Acceptance Criteria

- Existing 50-state crawler, Admin QA, Search Alerts, notification, and billing tests remain green.
- Users can see recent delivery attempts and digest status for each alert.
- Disabled notification preferences and paused alerts are visible as skipped, not silent.
- Failed deliveries expose a safe reason and retry state.
- Submission Guidance, Compliance Manifest, and Pursue/No-Bid continue to work with current gates.
- Search/bid detail still works for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade continuation: amendment refresh, richer evidence/artifact links, no-bid taxonomy, qualification risk explanations.
2. 50-state crawler hardening continuation: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
3. Production deployment dry run for billing, notification, and crawler workers.
4. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
5. Knowledge Station Lite as Product 0.9 workflow coaching.
6. Response Workspace Lite and Artifact Vault Lite.
7. Supply Chain and Quote Lite.
8. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
9. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
