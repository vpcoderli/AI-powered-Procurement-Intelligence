# WinBids Next Development Plan

Updated: 2026-05-30

## Recommendation

Continue with **Product 2 Document-Grounded Q&A v1** as the next implementation phase.

Commercial packaging and credits foundation is now in place:

- Internal tiers stay compatible as `free`, `pro`, `business`, and `enterprise`.
- Product-facing plan labels now support Free, Pursuit Starter, Response Builder, planned Growth, and Enterprise.
- Credits have a foundation for included monthly credits, purchased credits, premium action costs, refunds, and future ledger events.
- Settings Billing/Usage can surface plan names, Growth as planned, and credit summaries.

The source registry, capability metadata, archive metadata columns, quality flag foundation, public attachment/detail downloader, Admin Bid QA queue, correction audit persistence, publish/suppress controls, batch QA actions, rich QA filters, correction history, Search Alerts management UI, notification provider hardening, 50-state crawler guardrails, production billing/worker runbooks, and Qualification Evidence Citations v1 are now in place. The next risk is useful qualification interaction: users need constrained Q&A over known evidence before the Product 2 workflow can deepen.

## Last Completed Phase

**Qualification Evidence Citations v1** made generated qualification outputs evidence-backed:

Completed locally:

- `intent_to_bid` now stores an `evidence_citations_json` snapshot.
- Qualification citations are generated from bid fields, source URLs, archived detail metadata, attachments, and deterministic generated output.
- `/api/intents/[id]/citations` exposes read-only citations through the existing principal/session pattern.
- The Intent detail page shows a compact evidence panel near the generated brief.
- Existing Submission Guidance, Compliance Manifest, and Pursue/No-Bid wire shapes remain unchanged.

## Previous Completed Phase

**Admin Bid QA Console Thin Slice** made quality issues actionable from `/admin`:

Completed locally:

- `bids` stores review note, reviewed timestamp, and reviewer id.
- Admin QA repository computes quality score and summary counts from deadline, source confidence, quality flags, attachment archive status, and detail archive status.
- `/api/admin/bids/qa` lists QA records with filters for query, state, review status, and archive status.
- `/api/admin/bids/qa/[id]` lets admin/operator update review status; support remains read-only.
- `/admin` displays the Bid Data QA queue with quality score, archive issue count, review status, and quick Reviewed / Needs review actions.

## Earlier Completed Phase

**Attachment Download Archival Downloader** turned state/SAM crawler output into evidence-ready bid records:

`Source Registry -> Connector Run -> Detail/Attachment Downloader -> Quality Flags -> Admin QA -> Search/Bid Detail Evidence`

Completed locally:

- Public HTTP(S) attachments and optional detail pages are downloaded into the configured local attachment archive.
- Archive metadata records local path, byte size, content type, SHA-256 checksum, fetched timestamp, status, and failure reason.
- Non-public, login-like, CAPTCHA/browser-required, and non-HTTP URLs are marked unavailable instead of being force-fetched.
- Fetch failures mark individual attachments failed without dropping otherwise non-empty crawler runs.
- Frontend SAM.gov/state runners default to archive downloads and bid detail surfaces archive status/failure notes.

## Phase Goal

Make Product 2 qualification interaction grounded in known evidence:

`Intent Workspace -> Evidence Citations -> Fixed Question Set -> Grounded Answer -> Source Link`

This phase should use existing citations and bid metadata to answer a constrained set of common questions. It should not introduce open-ended chat or unsupported claims.

## In Scope

- Add a small deterministic Q&A service for common questions: deadline, submission method, required documents, buyer/contact, risks, and attachments.
- Each answer must include citation ids from existing evidence citations.
- Expose a read-only Q&A API/client helper.
- Show Q&A in Intent detail as a fixed list, not free-form chat.
- Keep feature gates and existing output wire shapes stable.

## Out Of Scope

- Login-only portal automation or CAPTCHA bypass.
- Full OCR/document parsing.
- Free-form LLM Q&A.
- Amendment/addenda monitoring automation.
- Production object storage migration.
- Broad redesign of public search/bid detail pages.

## Acceptance Criteria

- Existing 50-state crawler, Admin QA, Search Alerts, notification, and billing tests remain green.
- Q&A answers reference existing citation ids and do not fabricate source claims.
- Intent detail can display Q&A without requiring a paid external AI provider.
- Submission Guidance, Compliance Manifest, and Pursue/No-Bid continue to work with current gates.
- Search/bid detail still works for existing records.
- `npm test`, `PYTHONPATH=crawler python3 -m pytest crawler/tests`, `npm run lint`, `npm run build`, `npm run db:migrate`, and `git diff --check` pass.

## Remaining Work After This Phase

1. Product 2 Qualification Upgrade continuation: amendment refresh, richer evidence/artifact links, no-bid taxonomy, qualification risk explanations.
2. Search Alerts notification history and digest delivery verification.
3. 50-state crawler hardening continuation: promote beta adapters, add source quality monitoring, and document Source Registry / Connector Engine / Normalization QA responsibilities.
4. Production deployment dry run for billing, notification, and crawler workers.
5. UI/UE production polish: migrate the demo visual direction into real `/search`, `/bids/[id]`, `/admin`, and settings workflows.
6. Knowledge Station Lite as Product 0.9 workflow coaching.
7. Response Workspace Lite and Artifact Vault Lite.
8. Supply Chain and Quote Lite.
9. Deadline Notifications, Award Tracking, and Win/Loss Learning Lite.
10. Real credit consumption, advanced usage metrics, enterprise custom rules, and production AI layer.
