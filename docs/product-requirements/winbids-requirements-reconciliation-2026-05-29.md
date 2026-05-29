# WinBids Requirements Reconciliation

Updated: 2026-05-29

Source folder: https://drive.google.com/drive/folders/1k41va8s9BV1Bk6PKnPqiAMm6SSa_Gbxc

## Read Scope

This pass read the updated Drive folder recursively and extracted 57 readable files from 86 Drive entries:

- Agile Light Version User Story
- Architecture Map
- PRD_Long Heavy
- Product Road Map & PRD Writing Management Plan
- Prototype
- P0 Platform Foundation PRDs
- P1 Bid Discovery PRDs
- P2 Qualification & Pursuit Decisioning PRDs
- P3 Bid Response Workspace PRD and prototypes
- P4 Submission Guidance & Confirmation PRD and prototype
- P5 Award Tracking & Learning PRD and prototype
- Knowledge Station complete and MVP PRDs

## Executive Delta

The updated requirements change the local backlog in six important ways:

1. Commercial packaging changed from a simple Free / Pro / Business / Enterprise model to Free / Pursuit Starter / Response Builder / Growth / Enterprise, with credits as a first-class metering layer.
2. Product 1 data work is more formal than the current crawler implementation: Source Registry, Connector Engine, Normalization/Data Quality, and Bid Admin now have separate ownership boundaries.
3. Attachment archival is still the right next data-quality slice, but it should be framed as part of Connector Engine + Normalization + Admin QA, not just crawler convenience.
4. Product 2 "Lite" exists locally, but the updated PRDs expect deeper source-bound AI brief, Q&A, amendment refresh, requirement citations, evidence/artifact linkage, decision scorecards, and no-bid taxonomy analytics.
5. Knowledge Station is no longer only a far-future module. It is Product 0.9 / workflow coaching and should have an MVP Lite layer in the R2 qualification slice.
6. Product 3-5 are explicitly lightweight MVP support flows: Response Workspace Lite, Artifact Vault Lite, deadline reminders, submission confirmation, award/status tracking, tabulation capture, and win/loss notes. Full quote automation, deep supply-chain management, ERP/PO/invoice, and Product 6 intelligence remain post-MVP.

## Current Local Status Compared To Updated Requirements

| Area | Updated requirement | Current local status | Gap |
|---|---|---|---|
| P0 Account and subscription | Free, Pursuit Starter, Response Builder, Growth, Enterprise; included credits; purchased credits; paywall events; seat limits; billing admin; credit ledger | Free, Pro, Business, Enterprise; org tier, Stripe sandbox, invoices, quotas, team seats partially exist | Rename/re-map tiers, add credits, add credit ledger, add feature slug gates, update paywall copy and usage UX |
| P0 Security / roles | Owner, Admin, Member, Viewer plus internal support/admin; org isolation; audit for sensitive actions | user/admin/operator/support plus organization owner/member foundation; audit partially exists | Add product-facing org roles or map current owner/member to updated roles; add Viewer; tighten sensitive document access rules |
| P0 AI system | Local-first AI orchestrator, model router, prompt registry, structured validators, citations, confidence, cost ledger, admin kill switch | Deterministic generators; no orchestrator; no citation model; no AI cost ledger | Build AI foundation before premium AI outputs |
| P0 Dashboard | Command center for matched bids, active pursuits, deadlines, blockers, saved bids, status overview | Basic app shell and pages; dashboard depth limited | Add MVP dashboard after P3/P5 objects exist or as a lightweight aggregator |
| P0 Homepage / prototype | Public marketing and product positioning pages with pricing readiness | `/winbids-demo` and static prototypes exist; main marketing flow not fully converted | Decide whether current app needs public homepage refresh before launch |
| P1 Source Registry | 50 states + D.C., SAM.gov, local/SLED discovery, provider families, access modes, allowed use, source activation gate | 50-state runner registry and crawler metadata exist; access/allowed-use model is shallow | Add source registry fields: provider_family, access_mode, allowed_use, validation confidence, activation readiness, compliance notes |
| P1 Connector Engine | Approved-source-only connector jobs, raw object archive, attachment downloads, job retries, parser versions, source health | Crawler CLI/API, logs, non-empty guardrails, beta state adapters; raw archive/attachment archival incomplete | Build connector handoff/raw archive/download status layer |
| P1 Normalization/Data Quality | Canonical solicitation model, staging, raw value preservation, lineage, validation flags, dedupe signals, quality signals, reprocessing | Basic normalized bid records, dedupe key, crawler logs; limited lineage/quality | Add staging/lineage, quality score inputs, validation flags, versioned normalizer/parser metadata |
| P1 Bid Admin | Source ops, ingestion jobs, QA workbench, record admin detail, specialist queues, audit/export/settings | Admin source status, crawler run/logs, user management exist | Add QA cases, raw/staged/normalized comparison, publication state, attachment failure review, duplicate/category/source-access queues |
| P1 Search/display | Search/filter/detail/saved bids/saved alerts, closed bids, richer filters | Search, filters, sort, bid cards, detail, saved bids, alerts API foundation | Add full alert UI, closed-bid handling, richer taxonomy filters |
| P1 Supplier Profile | Guided profile, categories, product catalog, docs, certifications, coverage, completion scoring | Profile API/UI and completion score exist | Add product catalog, document/artifact handoff, richer category/certification fields |
| P1 Match Scoring | Explained score with supplier fit, category, geography, deadline, risk, admin diagnostics | Deterministic match score and explanation exist | Add configurable weighting, diagnostics, feedback loop, source citations |
| P2 Intent to Bid | Intent state, list, evaluation, withdrawal, decision linkage | Intent create/list/detail/status exists | Add richer statuses, notes, timeline, withdraw/no-bid reason linkage |
| P2 Bid Understanding | Source-bound bid brief, document status, risk flags, Q&A, amendment refresh, manifest candidate creation | Deterministic brief/checklist/risk flags exist | Add document-level extraction, citations, confidence, Q&A, amendment delta |
| P2 Compliance Manifest | Requirements, citations, evidence, artifact links, owner/due date/status, blocker rollup | Lite compliance model/API/UI exists | Add requirement evidence, artifact links, owner/due date/risk, filters, merge duplicates |
| P2 Pursue / No-Bid | Decision recommendation, scorecard, criteria weights, final decision, Watch / Partner Needed | Lite recommendation and history exist | Add scorecard criteria, human overrides, Partner Needed/Watch flow |
| P2 No-Bid Taxonomy | Standard taxonomy, assignment, analytics, admin management later | Not explicit beyond decision reasons | Add no-bid reason taxonomy and analytics foundation |
| P0.9 Knowledge Station | Embedded workflow coaching, glossary, snippets, playbooks, admin content workflow, plan-based visibility | Missing/deferred | Build Knowledge Station Lite as R2 support layer, not full knowledge product |
| P3 Response Workspace | Workspace overview, response plan, tasks, blockers, readiness gate, activity log | Missing | Build Response Workspace Lite after P2 upgrade or in parallel with Artifact Vault Lite |
| P3 Artifact Vault | Upload, metadata, expiration, versioning, requirement matching, private access | Attachment serving exists only for crawler-managed files | Build supplier artifact vault and connect to compliance/workspace |
| P3 Supply Chain | Supplier directory, dependencies, documents, follow-ups, risk, quote handoff | Missing | Build light partner/supplier directory before quote workflow |
| P3 Quote Management | RFQ builder, recipients, quote response capture, comparison, accepted quote, readiness sync | Missing | Build manual-first quote workflow; email/supplier portal integrations later |
| P3 Deadline Notifications | Deadline registry, in-app notifications, email-ready reminders, snooze/ack/escalation, digest | Notification outbox/worker exists; deadline objects not unified | Add deadline registry and link to workspace/tasks/artifacts/quotes/submission |
| P4 Submission Guidance | Submission plan, route, portal/account readiness, owner, backup, checklist, no direct submission | Lite submission path/checklist/confirmation exists | Expand to submission plan, owner/backup, account readiness, package version handoff |
| P5 Award Tracking | Status tracking, award/tabulation, win/loss notes, fulfillment reminder, award/status alerts | Missing | Build submitted-bids queue, manual status/outcome capture, award/tab upload, win/loss lite |
| P6 Procurement Intelligence | Buyer, competitor, pricing, category, forecasting, supplier performance intelligence | Missing | Post-MVP only; capture data now but do not build full intelligence UI |

## Revised Requirement List

### R0: Documentation And Roadmap Reconciliation

- Update `winbids-unified-prd.md` to reflect the latest Drive taxonomy: R0/R1/R2/R3/R4 release slices, Product 0.9 Knowledge Station, Product 1 data-layer boundaries, and Products 3-5 lightweight MVP shape.
- Replace or retire `winbids-next-development-plan.md`; it still recommends Submission Guidance Lite, which is already implemented.
- Update `winbids-current-gap-analysis.md` and `winbids-implementation-status.md` with the new commercial plan names and credit-led roadmap.
- Keep a Drive source inventory with 57 extracted files and the folder hierarchy so future updates can be diffed instead of rediscovered manually.

### R1: Commercial Packaging And Credits

- Introduce plan catalog aliases or migration from current `free/pro/business/enterprise` to `free/starter/builder/growth/enterprise`.
- Add credit concepts: included monthly credits, purchased credits, credit ledger, consumption order, low-balance alerts, failed-generation refund/no-consume rule.
- Add feature slugs from the PRD: `bid.brief.full.generate`, `compliance.manifest.generate`, `readiness.review.run`, `response.workspace.create`, `artifact.vault.upload`, `response.section.draft`, `package.review.run`, `amendment.delta.run`, `award.tabulation.analyze`, `price.to.win.run`, `team.member.invite`.
- Add contextual paywalls for Starter, Builder, Growth, credit top-up, seat limit, and Enterprise contact-sales.
- Preserve data on downgrade/cancel; lock advanced actions rather than deleting work.

### R2: P1 Data Pipeline Hardening

- Extend data sources with provider family, access mode, allowed use, source priority, validation confidence, registration status, activation readiness, terms/robots notes, and connector candidate.
- Add connector handoff envelope from Source Registry to Connector Engine.
- Add raw object archive for HTML/API JSON/XML/CSV/PDF/DOCX/XLSX/screenshots/attachments where approved.
- Add attachment download archival: original URL, local path/object reference, checksum, byte size, content type, status, fetched_at, parser version, extraction availability.
- Add normalization staging and lineage: source raw values, parser confidence, parser_version, normalizer_version, raw_object_refs, source_payload_hash.
- Add validation flags: missing due date, invalid URL, unknown status, ambiguous dates, deadline conflicts, stale open records, source access violation, sensitive-data detection, low extraction confidence.
- Add data quality signals and QA routing into Admin.

### R3: Bid Admin/Data QA Console Expansion

- Add Admin Dashboard health summary for source freshness, connector failures, QA volume, compliance warnings, and quality trend.
- Add Source Operations view using Source Registry fields and allowed-use/compliance notes.
- Add Ingestion Jobs view with parser/connector versions, logs, retry/cancel/re-run requests.
- Add Bid QA Workbench with generated QA cases and saved filters.
- Add Bid Record Admin Detail showing raw references, staged fields, normalized fields, flags, duplicate signals, attachments, and audit history.
- Add specialist queues for duplicate, category, agency/vendor, attachment, award linkage, and source-access review.
- Add publication/display states: draft, publishable, published, admin_only, quarantined, rejected, archived; displayable, pending_qa, hidden, published_with_warning.

### R4: P2 Qualification Upgrade

- Upgrade Bid Understanding from deterministic summary to source-bound brief with citations, confidence, document status, risks, Q&A, and amendment refresh.
- Upgrade Compliance Manifest with requirement evidence, source spans, artifact links, owner, due date, risk, comments, filters, blocker rollup, and manual requirement creation.
- Upgrade Pursue / No-Bid with scorecard criteria, weights, human score override, recommendation memo, final decision, Watch, Partner Needed, and decision audit.
- Add No-Bid Reason Taxonomy: default categories, primary/secondary reason assignment, correction history, and organization-level analytics.

### R5: Knowledge Station Lite

- Add embedded workflow coaching panels on key pages such as search, bid detail, intent, compliance, decision, workspace, submission, and award.
- Add glossary terms, coaching snippets, and mini playbooks with admin-managed status.
- Add plan-based visibility: Free basic literacy, Starter decision guidance, Builder operational guidance, Growth strategic learning.
- Keep this as embedded support content first; do not build a full standalone course or enterprise knowledge-management product in MVP.

### R6: Product 3 Response Workspace Lite

- Add Bid Pursuit Workspace object created from pursue decision or saved bid.
- Add workspace overview: bid header, owner, due date, readiness score, blockers, risks, next actions.
- Add response plan sections with owner, due date, status, notes, and linked tasks.
- Add task board/list with owner, due date, priority, status, comments, activity log.
- Add readiness gate: Not Ready, At Risk, Mostly Ready, Ready for Submission Guidance, User Override.
- Add Activity Log and readiness snapshots.

### R7: Artifact Vault Lite

- Add reusable supplier artifact records for W-9, insurance, business license, capability statement, certifications, signed addenda, forms, past performance, quote docs, and response assets.
- Track metadata: artifact type, expiration date, version, access, linked requirement/workspace/task/quote, status, and review state.
- Connect missing/expired artifact blockers back to Compliance Manifest and Response Workspace.

### R8: Supply Chain And Quote Lite

- Add supplier/partner directory with contacts, capability tags, categories, lead time, regions, notes, risk, and status.
- Add workspace supplier dependencies for distributor quote, subcontractor confirmation, OEM authorization, warranty support, or partner capability.
- Add manual-first quote request workflow: RFQ line items, selected recipients, sent status, response upload, structured quote fields, comparison, accepted quote, readiness sync.
- Defer supplier portal integrations and automated email sending.

### R9: Deadline Notifications

- Add Deadline Registry with type, linked object, owner, due date/time/timezone, source, priority, verification status.
- Link deadlines to workspace tasks, artifacts, suppliers, quotes, submission checklist, and award/status follow-ups.
- Support in-app notification center, acknowledge, snooze, overdue, escalated, daily digest, and email-ready outbox.
- Reuse existing notification worker where possible.

### R10: Product 4 Submission Guidance Completion

- Expand current Submission Guidance Lite into a Submission Plan.
- Add submission route classification: portal, email, physical delivery, in-person drop-off, mixed method.
- Add portal/account readiness, final package checklist, owner, backup owner, confirmation target, and package version.
- Keep direct submission out of scope.

### R11: Product 5 Award Tracking And Learning Lite

- Add Award Tracking record after submission confirmation.
- Add submitted-bids queue with official status, user pursuit status, follow-up tasks, and status history.
- Add manual award/tabulation capture and file upload.
- Add win/loss note capture with structured reason taxonomy and learning notes.
- Add fulfillment preparation reminder only; do not build PO, invoice, inventory, shipping, or contract execution.

### R12: Product 6 Data Capture Only

- Do not build full Product 6 intelligence in MVP.
- Capture data now so future buyer, competitor, pricing, category, forecasting, and supplier performance intelligence can be built from real history.

## Recommended Development Order From Here

1. R0 Documentation And Roadmap Reconciliation.
2. R1 Commercial Packaging And Credits, because the updated tier model affects every gated feature.
3. R2 P1 Data Pipeline Hardening, starting with attachment archival/raw archive and source registry metadata.
4. R3 Bid Admin/Data QA Console Expansion.
5. R4 P2 Qualification Upgrade.
6. R5 Knowledge Station Lite.
7. R6/R7 Response Workspace Lite + Artifact Vault Lite.
8. R8 Supply Chain And Quote Lite.
9. R9 Deadline Notifications.
10. R10 Submission Guidance Completion.
11. R11 Award Tracking And Learning Lite.
12. R12 Product 6 data capture only.

## Immediate Next Slice Recommendation

Recommended next implementation slice: **Commercial Packaging And Credits Reconciliation**.

Reason:

- The current system already has billing, feature gates, organization tier, quotas, Stripe sandbox verification, and paywall-like locked states.
- The updated Drive requirements change the commercial model at the foundation: Starter/Builder/Growth and credits should become the vocabulary before building more gated workflows.
- If Product 3/Knowledge/AI are built on the old Pro/Business gates, they will need rework.

Alternative if data quality remains the priority: **P1 Data Pipeline Hardening - Attachment Archival + Source Registry Metadata**.

Reason:

- This directly continues the 50-state crawler work.
- It aligns the existing crawler implementation with the new 1.1/1.2/1.3 module boundaries.
- It also addresses the prior problem where crawler files existed but pages could open as 404 or empty.

## Open Product Decisions

1. Should the existing `pro` tier map to `starter`, and existing `business` map to `builder`, or should the database enum be migrated to new tier names?
2. Should Growth be introduced now as a disabled/future plan in the plan catalog, or only added when Product 5/P6 work begins?
3. Should credits be implemented as real metering immediately, or first as a zero-cost ledger with no payment for credit packs?
4. Should Knowledge Station Lite be implemented before Response Workspace Lite because it is now Product 0.9/R2 support, or after Product 3 because some coaching surfaces need workspace objects?
5. Should Attachment Archival be implemented before commercial reconciliation if the main risk remains data quality?
