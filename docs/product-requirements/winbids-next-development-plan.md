# WinBids Next Development Plan

Updated: 2026-06-03

## Recommendation

Run the next phase as **Admin Source Governance Depth** or **Settings Reminder Center**, depending on whether the next priority is operations hardening or user-facing workflow depth. P0, P1, P2 50-state validity, and Source Health Operations Lite are complete locally.

Primary execution plan:

- `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`

The refreshed Drive Phase II documents introduce foundation requirements that now sit above the feature backlog:

- P0 Foundation Refined: AWS-first operations, environment separation, source/security controls, QA/release gates, and transferability.
- Configurable Before Custom: a general configuration registry and admin configuration matrix.
- Audit Event Logging Matrix: durable product, admin, source, AI, notification, billing, and integration event logging.
- Transferability Requirements: a developer handoff pack covering setup, deployment, environment variables, data model, runbooks, secrets, backups, limitations, and operations.
- Universal UX States: consistent Loading, Empty, Error, Permission Denied, AI Unavailable, Low Confidence, Upload Failed, Source Unavailable, Duplicate Opportunity, Expired Deadline, and Plan Limit handling.

These are not a replacement for workflow modules such as Deadline Notifications, Award Tracking, or Win/Loss Learning. They are the cross-cutting layer that makes those future features easier to build safely.

## Current Priority Order

### P0A. Standards Alignment Lite

Status: done locally as a first foundation slice.

Goal: make the project buildable, auditable, configurable, and handoff-ready before more modules create additional state.

Delivered:

1. Local Phase II requirements alignment is in the product docs.
2. Transferability Pack skeleton exists under `docs/transferability/`.
3. Minimal `config_registry` foundation exists for feature, plan, workflow, source, notification, AI, UX-state, and dashboard config domains, and `/admin` now includes a first read-only Config Registry / Config Matrix panel.
4. Durable `event_log` and `event_outbox` foundations exist with metadata redaction and idempotency.
5. Request/correlation id helper exists.
6. Reusable Universal UX state model/component exists and is used by `/admin` auth/error states.
7. `npm run risk:check` includes source ingestion governance, with stricter production approval mode available through the report option/env flag.
8. `npm run risk:check` includes deterministic 50-state source-validity metadata checks and state URL validity checks, including rejection of known demo/placeholder URLs.

Remaining depth:

- Broader Universal UX state rollout to lower-level inline module errors and future Artifact Vault upload flows.
- Editable admin UI for config registry beyond the first read-only matrix.
- More event writes across permissions, plan limits, upload failures, source changes, AI states, duplicates, deadlines, quotes, and awards.
- Production AWS deployment execution, not just docs.
- MySQL runtime cutover after the expanded runtime slice: auth/session/password reset, account profile/password/delete/export/preferences/usage, workspace read/update/invites/members/ownership, admin auth gate, admin users/feature overrides/audit logs, admin config registry/audit writes/event outbox delivery, admin data source list/update, admin bid QA list/review/display/correction/batch writes, billing/dunning, supplier profile, bid search/detail/saved-bids/attachment metadata, search alerts CRUD/quota/digest history, notification outbox/admin recent/delivery, intent create/list/detail/status, compliance manifest, submission guidance/confirmation, response workspace, pursuit decision, qualification citations/freshness/Q&A, crawler health/admin crawler logs, crawler locks/source enablement, direct JSON crawler result import/upsert, crawler search-alert matching/digest notification, repeatable SQLite-to-MySQL data import, MySQL-ready Stripe sandbox verifier, aggregate worker preflight, and production billing credential preflight now have MySQL-compatible paths. Remaining signoff work is running the operator-assisted Stripe sandbox flow with real test credentials against MySQL plus final low-risk live checkout/webhook execution.

### P0B. Source Legal-Use and Ingestion Governance

Status: done locally as a first foundation slice.

Goal: align 50-state crawler work with the new source ingestion controls.

Delivered:

1. Source approval fields exist on `data_sources`.
2. 50-state registry has approval defaults: verified sources approved, beta sources needs-review.
3. Transferability docs describe source credential/secret handling boundaries.
4. Admin source projection and Admin UI surface source approval state; the Admin Data Sources API also exposes latest persisted live source health details for each source when available.
5. Risk-check fails blocked/restricted enabled sources and can require explicit production approval for all enabled state sources.
6. Source-validity metadata distinguishes official verified portals, beta official portals, and public aggregator fallback sources in the frontend/Admin projection and Python crawler registry/output metadata.

Remaining depth:

- Editable approval workflow.
- APSI Registration Vault implementation.
- Operator-run live portal URL health reporting beyond deterministic local URL-shape checks.
- Production approval operations and ownership workflow.

### P1. Data and Production Readiness

Goal: keep the already completed 50-state coverage usable and production-safe.

Deliverables:

1. Promote beta state adapters in batches of 10-15 states with live validation and source quality notes.
2. Replace public fallback sources when stable official sources are available.
3. Operator-run live source URL health reporting is now available through `npm run source:health:check`; continue using it as a production operations signal without making normal test runs network-dependent.
4. Add production crawler scheduling, monitoring, and alerting runbook coverage.
5. Connect real production email provider credentials and bounce/complaint handling.
6. Dry-run production billing, notification, and crawler workers with production-like environment separation.
7. Continue UI/UE production polish on real app pages rather than only static demos.

Acceptance criteria:

- 50-state data remains non-empty and accessible through search, bid detail, and attachment download checks.
- Admin and `risk:check` can distinguish official, beta, and public aggregator fallback sources, and can reject demo/placeholder URLs before handoff.
- Operators can run a separate live source health probe for all 50 registry base URLs or a subset of state/source ids.
- Admin can identify unhealthy sources and production worker failures.
- Billing and notification foundations can be operated outside local dev.

### P2. Workflow Depth

Goal: complete the supplier pursuit workflow after the foundation is safer.

Recommended order:

1. Response Workspace depth: owner assignment and item comments are now the first local slice; next deepen comments into activity/version history, add artifact-task linking, reusable package outline, and LLM drafting later.
2. Submission Guidance Completion: submission version/history, readiness completion, recovery states.
3. Deadline Notifications depth: notification outbox scheduling, email/calendar delivery, Settings reminder center, submission checkpoint reminders, audit events.
4. Quote / Supply Chain depth: outbound email, supplier portal, quote response uploads, comparison scoring, partner profile depth, audit events.
5. Award / Tabulation Tracking Lite: award notice, tabulation record, manual status update, source evidence.
6. Win/Loss Learning Lite: outcome capture, reason taxonomy, future recommendation feedback.

Artifact Vault Lite is now complete locally as a v1 slice: Business-gated upload/list/download, intent/bid association, metadata, local storage, empty state, upload failed state, and bilingual Intent UI are implemented. Its future depth remains audit events, delete/replace/versioning, compliance auto-linking, production object storage, malware scanning, and retention policy.

Quote / Supply Chain Lite is now complete locally as a v1 slice: Business-gated partner records, quote request drafts, status flow, quote amounts, response notes, linked supplier artifacts, API/client helpers, bilingual Intent UI, and quote due-date reminders through Deadline Notifications Lite are implemented. Its future depth remains outbound email, supplier portal, response uploads, comparison scoring, partner profile depth, audit events, and richer compliance linkage.

Deadline Notifications Lite is now complete locally as a v1 slice: Business-gated `deadline_reminders`, an idempotent generator for bid deadlines, response task due dates, quote due dates, and artifact expiries, GET/PATCH APIs, acknowledge/snooze actions, client helpers, bilingual Intent UI, and locked/error/empty states are implemented. Its future depth remains notification outbox scheduling, email/calendar delivery, digest preferences, submission checkpoint reminders, audit events, Settings reminder center, and MySQL runtime adapter.

Response Workspace Assignment + Comments Lite is now the first local depth slice: response workspace items support owner assignment to active workspace members, `response_workspace_comments` stores item-level coordination notes, GET/POST comment APIs and client helpers are available, and the Intent detail UI exposes assignee selection plus bilingual comments. Its future depth remains activity/version history, artifact-task linking, response package generation, richer team member directory, and LLM drafting.

Intent workflow panel decomposition is now complete as a parallel-readiness slice: the Intent detail page renders Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications through dedicated component files while retaining existing state and handler ownership in the page. This lowers merge risk for the next Response Workspace and workflow-depth tasks without changing behavior.

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

**Source Health Operations Lite** is complete locally as the latest source-operations slice.

Completed locally:

- Batch 1 split Intent detail workflow sections into dedicated components for Response Workspace, Artifact Vault, Quote Workspace, and Deadline Notifications.
- Batch 1 added a first read-only Admin Config Registry / Config Matrix section backed by `/api/admin/config`.
- Batch 1 expanded P3 entitlement/Knowledge/Credit tests for Enterprise defaults, org overrides, expired overrides, Growth planned/disabled state, and static credit metadata.
- Batch 2 added Response Workspace artifact-task linking using the existing Artifact Vault foundation.
- Batch 2 added `response_workspace_item_artifacts` schema/migration coverage, MySQL-compatible repository/service behavior, and MySQL smoke verification for linked artifacts.
- Batch 2 surfaced persisted live source health in Admin Data Sources with live status, checked time, HTTP/status code, latency, error summary, and empty state.
- Response Workspace Activity History Lite added `response_workspace_activity`, activity hydration on workspace items, service-level writes for status/notes/assignee/due date/title/linked artifact/comment changes, MySQL repository coverage, and a compact bilingual activity surface in Intent detail.
- Response Package Snapshot / Readiness Lite added `response_package_snapshots`, SQLite/MySQL repository support, response package readiness summaries from outline/artifact/blocker state, Business-gated package GET/POST APIs, client helpers, Intent UI snapshot creation, recent snapshot display, and bilingual copy.
- Response Package Export / Download Lite added `response_package_exports`, deterministic local Markdown export generation from saved snapshots, SQLite/MySQL repository support, Business-gated export request/download APIs, client helpers, Intent UI export/download controls, and bilingual copy.
- Wave 1 / Tier / Paid Feature Locking is done locally: backend entitlement/API gate coverage and frontend locked/upgrade states align.
- Wave 2 / Anonymous Boundary Cleanup is done locally: public browsing remains anonymous, while saved bids, intents, profile/settings, search alerts, and paid workspace APIs require registered users.
- Wave 3 / 50-State Source Validity Hardening is done locally: `source:health:check -- --all` works, deterministic source/content/detail/download checks pass, crawler source metadata has non-placeholder URL coverage, and OH/WY hard 404 registry URLs were corrected.
- Source Health Operations Lite added `recommendedAction` and `operationalSeverity` to live source health results, CLI reports, Admin Data Sources API/UI, and the source-health runbook.

Remaining depth:

- Response Package format depth: PDF/DOCX/ZIP generation, production object storage, export audit events, and richer readiness blocking rules.
- Editable Config Matrix governance UI.
- Admin live source-health actions now include operator severity/action classification, source approval changes now keep visible approval history, explicit blocked/held/unapproved source governance prevents crawler execution before locks/runners, Admin UI/API support batch approve/hold for selected sources, and Admin Data Sources now shows recent per-source source-health trends.
- Settings reminder center is implemented locally; production notification delivery/preferences depth remains.
- Real credit consumption and production AI remain intentionally deferred.
- Live source health still reports external portal availability risk: the latest report-only run was 28/50 healthy and 22 unhealthy due to 403, timeout, or fetch failure.

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
- Full Artifact Vault production object storage/malware scanning implementation.
- Full Quote marketplace or supplier portal.
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

Use the Superpowers execution plan at `docs/superpowers/plans/2026-06-02-p1-p3-remaining-execution-schedule.md`.

The broader alignment plan remains at `docs/superpowers/plans/2026-06-02-auth-tier-source-anonymous-alignment.md`.

Run the next phase as **Submission Guidance Completion** if moving back to user-facing workflow depth, or **Response Package Format Depth** if continuing P3 response execution. Wave 1 / Tier / Paid Feature Locking, Wave 2 / Anonymous Boundary Cleanup, Wave 3 / 50-State Source Validity Hardening, Source Health Operations Lite, Admin Source Governance Lite, and Settings Reminder Center Lite are complete locally and should be treated as the permission + source-quality + reminder baseline.

Recommended order:

1. **P0 Admin/User Auth Regression**：Done locally. Admin API role coverage now has a manifest test, read/admin/operator route roles are explicit, source governance PATCH fields require full admin, `/admin` Config Registry is admin-only, `/` hides `/admin` source-health links from ordinary users, and `/intents/[id]` requires login before loading personal APIs.
2. **Wave 1 / P1 Tier / Paid Feature Locking**：Done locally. Backend entitlement/API gate 与 frontend locked/upgrade states 已统一；Free / Pursuit Starter / Response Builder / Enterprise 矩阵、Intent paid route auth guard、Knowledge Station 登录契约、Settings paid feature overview 和 Intent paid module locked-state coverage 已补齐。
3. **Wave 2 / P1 Anonymous Boundary Cleanup**：Done locally. 保留公开搜索/招标浏览的匿名能力；saved bids、intents、settings、profile、search alerts 等个人工作区匿名持久化路径已移除。
4. **Wave 3 / P2 50-State Source Validity Hardening**：Done locally. 50 州数据非空、来源可信、详情可打开、附件可通过本地安全下载接口访问的 deterministic checks 已通过；live source health 可报告全量状态，OH/WY 404 base URL 已修复。
5. **Wave 4 / P3 Docs / Operations Handoff**：Done locally for the current source-health slice. `source-health-check.md` now documents full runs, persisted snapshots, live failure action/severity classification, and remaining operational handling.

Subagent allocation:

- Agent A：Admin vs ordinary user route/API regression.
- Agent B：ordinary user auth flows and personal workspace page states.
- Agent C：tier/paid feature backend enforcement.
- Agent D：tier/paid feature frontend locked states.
- Agent E：50-state source validity and crawler output quality.
- Agent F：anonymous boundary cleanup and docs.

After this alignment phase, resume workflow depth in this order: Submission Guidance Completion, Response Package format depth, Config Matrix depth, Award / Tabulation Tracking Lite, Win/Loss Learning Lite.
