# WinBids Next Development Plan

Updated: 2026-06-01

## Recommendation

Run the next phase as **Artifact Vault Lite**, using the P0 Standards Alignment Lite foundations now in place.

The refreshed Drive Phase II documents introduce foundation requirements that now sit above the feature backlog:

- P0 Foundation Refined: AWS-first operations, environment separation, source/security controls, QA/release gates, and transferability.
- Configurable Before Custom: a general configuration registry and admin configuration matrix.
- Audit Event Logging Matrix: durable product, admin, source, AI, notification, billing, and integration event logging.
- Transferability Requirements: a developer handoff pack covering setup, deployment, environment variables, data model, runbooks, secrets, backups, limitations, and operations.
- Universal UX States: consistent Loading, Empty, Error, Permission Denied, AI Unavailable, Low Confidence, Upload Failed, Source Unavailable, Duplicate Opportunity, Expired Deadline, and Plan Limit handling.

These are not a replacement for Artifact Vault, Quote/Supply Chain, or Award Tracking. They are the cross-cutting layer that makes those future features easier to build safely.

## Current Priority Order

### P0A. Standards Alignment Lite

Status: done locally as a first foundation slice.

Goal: make the project buildable, auditable, configurable, and handoff-ready before more modules create additional state.

Delivered:

1. Local Phase II requirements alignment is in the product docs.
2. Transferability Pack skeleton exists under `docs/transferability/`.
3. Minimal `config_registry` foundation exists for feature, plan, workflow, source, notification, AI, UX-state, and dashboard config domains.
4. Durable `event_log` and `event_outbox` foundations exist with metadata redaction and idempotency.
5. Request/correlation id helper exists.
6. Reusable Universal UX state model/component exists and is used by `/admin` auth/error states.
7. `npm run risk:check` includes source ingestion governance, with stricter production approval mode available through the report option/env flag.

Remaining depth:

- Broader Universal UX state rollout to lower-level inline module errors and future Artifact Vault upload flows.
- Full admin UI for config registry.
- More event writes across permissions, plan limits, upload failures, source changes, AI states, duplicates, deadlines, quotes, and awards.
- Production AWS deployment execution, not just docs.
- MySQL runtime cutover after the expanded runtime slice: auth/session, account profile/password/delete, workspace read/update, admin auth gate, billing, supplier profile, bid search/detail/saved-bids, intent create/list/detail/status, crawler health, and admin crawler logs now have MySQL paths. Continue converting the remaining SQLite-bound paths: password reset, account export/preferences/usage, workspace invites/members/ownership, attachment metadata lookup, search alerts, deeper intent panels, admin/config/QA writes, notification/event workers, crawler write/import, and data import.

### P0B. Source Legal-Use and Ingestion Governance

Status: done locally as a first foundation slice.

Goal: align 50-state crawler work with the new source ingestion controls.

Delivered:

1. Source approval fields exist on `data_sources`.
2. 50-state registry has approval defaults: verified sources approved, beta sources needs-review.
3. Transferability docs describe source credential/secret handling boundaries.
4. Admin source projection and Admin UI surface source approval state.
5. Risk-check fails blocked/restricted enabled sources and can require explicit production approval for all enabled state sources.

Remaining depth:

- Editable approval workflow.
- APSI Registration Vault implementation.
- Python crawler source metadata parity.
- Production approval operations and ownership workflow.

### P1. Data and Production Readiness

Goal: keep the already completed 50-state coverage usable and production-safe.

Deliverables:

1. Promote beta state adapters in batches of 10-15 states with live validation and source quality notes.
2. Replace public fallback sources when stable official sources are available.
3. Add production crawler scheduling, monitoring, and alerting runbook coverage.
4. Connect real production email provider credentials and bounce/complaint handling.
5. Dry-run production billing, notification, and crawler workers with production-like environment separation.
6. Continue UI/UE production polish on real app pages rather than only static demos.

Acceptance criteria:

- 50-state data remains non-empty and accessible through search, bid detail, and attachment download checks.
- Admin can identify unhealthy sources and production worker failures.
- Billing and notification foundations can be operated outside local dev.

### P2. Workflow Depth

Goal: complete the supplier pursuit workflow after the foundation is safer.

Recommended order:

1. Artifact Vault Lite: supplier upload, intent/bid association, evidence type, permission, upload failed state.
2. Quote / Supply Chain Lite: partner list, quote request draft, quote comparison, supplier attachment references.
3. Deadline Notifications: bid deadline reminders, response task reminders, user notification preferences, digest entries.
4. Response Workspace depth: assignment, comments, version history, reusable package outline, LLM drafting later.
5. Submission Guidance Completion: submission version/history, readiness completion, recovery states.
6. Award / Tabulation Tracking Lite: award notice, tabulation record, manual status update, source evidence.
7. Win/Loss Learning Lite: outcome capture, reason taxonomy, future recommendation feedback.

Acceptance criteria:

- A paid user can move from opportunity discovery to pursuit, response preparation, evidence collection, quote support, reminder handling, and outcome capture.
- Admin and ordinary user experiences remain visibly different.
- Free, Pursuit Starter, Response Builder, and Enterprise gates remain enforced by backend and frontend.

### P3. Intelligence and Enterprise Depth

Goal: add advanced value after source, workflow, and audit foundations are stable.

Recommended order:

1. Production AI layer: LLM-backed extraction, citations, confidence, prompt/version logging, cost controls, AI unavailable and low-confidence states.
2. Knowledge Station depth: embeddings, retrieval, admin publishing workflow, artifact uploads, usage metrics, and credit metering.
3. Real credit consumption and paid credit packs.
4. Advanced usage metrics across artifacts, quotes, AI calls, Knowledge Station, and storage.
5. Product 6 intelligence data capture: buyer, competitor, pricing, category, forecasting, and supplier performance datasets before advanced predictions.
6. Custom enterprise permission rules only after real enterprise cases exist.

## Last Completed Phase

**P0 Standards Alignment Lite** is complete locally as the first foundation slice.

Completed locally:

- Transferability Pack skeleton.
- `config_registry` schema/migration, helpers, admin APIs, seed defaults, tests, and audit linkage.
- `event_log` and `event_outbox` schema/migration, request context, event writer, metadata redaction, idempotency, tests.
- Universal UX state model/component/tests.
- Source governance defaults, DB overrides, Admin projection/UI badges, and risk-check coverage.

Remaining depth:

- Full page-level Universal UX rollout.
- More audit/event coverage.
- Full Admin config UI.
- Production AWS execution.
- Deeper source approval workflow.

## Current System Position

Already strong enough for the next foundation phase:

- Account registration, login, admin/operator/support separation, settings, team basics, organization tier inheritance, and feature gates.
- Subscription, Stripe sandbox verification, billing portal/cancel foundation, invoice/payment history, and dunning foundation.
- 50-state crawler registry, non-empty guardrails, safe local attachment serving, Admin risk-check visibility, and Bid QA.
- Product 2 deterministic qualification flow: citations, document-grounded Q&A, amendment freshness, no-bid taxonomy, evidence/artifact links, and compliance evidence mapping.
- Knowledge Station Lite and Response Workspace Lite.
- Search Alerts UI, notification outbox, delivery worker, and digest history.

Main risk now:

- Too much future behavior is still hard-coded or module-local.
- Audit/event logging is not yet comprehensive.
- Universal UX states are not yet systematically enforced.
- Production handoff docs are incomplete for a new developer/operator.
- Source ingestion approval/legal-use controls need to be explicit before production crawler expansion.

## Out Of Scope For The Next Phase

- Full AWS deployment.
- Full production LLM integration.
- Full Artifact Vault upload implementation.
- Full Quote marketplace.
- Automated login, CAPTCHA bypass, paid/restricted source crawling, or source behavior that violates portal terms.
- Enterprise-specific custom permission language without a real customer case.

## Verification Baseline

Each implementation phase should end with:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

Crawler-specific phases should also run the relevant Python tests:

```bash
PYTHONPATH=crawler python3 -m pytest crawler/tests
```

## Recommended Next Implementation Plan

Create a Superpowers implementation plan for **Artifact Vault Lite** with these task groups:

1. Artifact data model and migration.
2. Local storage upload service with validation.
3. Intent/bid association API.
4. Business/Response Builder feature gating and quota/config hook.
5. Upload failed, permission denied, and plan limit UX using `UniversalState`.
6. Audit events for upload/create/delete/status changes.
7. Risk-check and status documentation update.

After that phase, continue with **Quote / Supply Chain Lite**, then **Deadline Notifications**.
