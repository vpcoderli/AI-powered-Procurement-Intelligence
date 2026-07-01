# Multi-Agent Production Readiness And Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the current local MVP into a production-signoff-ready platform while continuing the highest-value local product-depth work that does not require external credentials.

**Architecture:** Run four independent tracks in parallel with disjoint ownership: production external signoff, commercialization verification, 50-state source operations, and workflow/UI/AI depth. Local worker tasks must remain testable without AWS, Stripe, LLM keys, or production storage; external signoff tasks must produce sanitized evidence rather than code-only confidence.

**Tech Stack:** Next.js 16, TypeScript, SQLite local runtime, MySQL production-like runtime, AWS App Runner/RDS/S3/CloudFront/Secrets Manager target architecture, Stripe sandbox/live billing, Vitest, ESLint, Browser-assisted smoke, custom demo/risk/source-health/worker scripts.

---

## Multi-Agent Findings Snapshot

Updated: 2026-06-12

| Agent | Track | Key finding | Next action |
|---|---|---|---|
| Agent A | Production external readiness | Local preflight/runbooks/S3 adapter exist; real AWS/S3/RDS/worker/backup/secret evidence is still the launch blocker. | Prepare evidence gates and run real staging smoke when AWS access exists. |
| Agent B | Commercialization / Stripe | Billing foundation, gates, checkout/webhook/portal/cancel and MySQL paths exist; true Stripe sandbox E2E is still blocked on real test credentials. | Strengthen local billing tests now; run sandbox when keys are provided. |
| Agent C | 50-state source operations | Deterministic 50-state demo data is valid; 22/50 live probes healthy and 28 are source-ops risks, not demo data failures. | Turn unhealthy live findings into an owned triage queue. |
| Agent D | UI / workflow / AI depth | Core UI/workflows are usable; gaps are repeatable visual evidence, workflow governance summary, and real AI/RAG/credit execution. | Add visual regression harness and response package governance lite. |

## Execution Priority

### P0: External Production Signoff

These are launch blockers but cannot be completed without real external environments or credentials.

- AWS staging/prod resources: App Runner, RDS MySQL, S3, CloudFront, Secrets Manager/SSM, CloudWatch, EventBridge/ECS workers.
- Real S3/CloudFront evidence: upload, download, head, delete, checksum, artifact replacement, signed URL or app-proxy behavior.
- Real RDS evidence: migration, MySQL smoke, backup snapshot, logical dump, restore rehearsal, rollback target.
- Real worker evidence: crawler, event outbox, notification/dunning workers in a production-like AWS runtime.
- Real Stripe sandbox: `sk_test...`, current `whsec...`, Pro/Business price ids, checkout, webhook, portal, cancel, tier update.
- Real owner/evidence variables: billing owner, worker owner, backup owner, backup/restore evidence URLs, rotation owner.

### P0: Local Work That Reduces Production Risk

Run these first when external credentials are not ready:

1. Source health triage queue: owner, disposition, next review, notes, reviewed timestamp.
2. Admin source-health triage UI: unassigned/overdue/classification filters and save actions.
3. Source-health report export: JSON/CSV/Markdown weekly/release report from latest snapshot without hitting live portals.
4. Production readiness evidence hardening: ensure preflight prints configured markers only and fails closed on placeholders.
5. Stripe local hardening: sandbox helper validation, webhook idempotency/security, local checkout/portal/cancel route coverage.

### P1: Demo And Workflow Trust

1. Browser demo evidence harness: automated desktop/mobile screenshots or DOM/overflow evidence for `/`, `/search`, `/bids/1`, real `/intents/<id>`, `/settings`, `/admin`.
2. Response Package Review Governance Lite: pending/approved/needs_changes counts, longest pending age, last reviewer, submit readiness, reviewed export bound to submission evidence.
3. Intent workflow governance rail: top-of-page status summary that links qualification, compliance, response package, artifact, quote, deadline, and award states to their panels.

### P2/P3: Enterprise Intelligence

1. Deterministic Knowledge/Credit clarity: keep provider=`lexical`, dry-run credit metadata, fallback reason, and billingEnforcement=false visible.
2. Real LLM/RAG/credit execution waits for model keys, embedding store, evaluation policy, and credit charging policy.

## Worker Allocation

### Worker 1: Source Health Triage Data Layer

**Owner:** Source Ops track.

**Files:**
- Modify: `frontend/src/server/db/schema.ts`
- Modify: `frontend/src/server/db/migrate.ts`
- Modify: `frontend/src/server/admin/data-sources-repository.ts`
- Modify: `frontend/src/app/api/admin/data-sources/[id]/route.ts`
- Modify: `frontend/src/lib/api/admin.ts`
- Test: `frontend/src/server/db/schema.test.ts`
- Test: `frontend/src/server/admin/data-sources-repository.test.ts`
- Test: `frontend/src/app/api/admin/data-sources/[id]/route.test.ts`

- [x] **Step 1: Add failing tests for triage fields**

Add coverage that an admin can write and read:
- `liveHealthOwner`
- `liveHealthDisposition`
- `liveHealthNextReviewAt`
- `liveHealthNotes`
- `liveHealthReviewedAt`

Run:

```bash
cd frontend
npm test -- src/server/admin/data-sources-repository.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/db/schema.test.ts
```

Expected: FAIL before implementation because fields and persistence are missing.

- [x] **Step 2: Implement SQLite/MySQL schema and repository support**

Keep this as a source-operations triage model, separate from legal/source approval fields. Notes must be redacted/sanitized enough to avoid credential leakage.

Run:

```bash
cd frontend
npm test -- src/server/admin/data-sources-repository.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/db/schema.test.ts
```

Expected: PASS.

- [x] **Step 3: Verify runtime migrations**

Run:

```bash
cd frontend
npm run db:migrate
set -a; source .env.local; set +a; npm run db:mysql:migrate
```

Expected: both migrations complete without losing existing data.

### Worker 2: Admin Source Health Triage UI

**Owner:** Admin UI track.

**Files:**
- Modify: `frontend/src/app/admin/page.tsx`
- Modify: `frontend/src/app/admin/page.test.ts`
- Modify: `frontend/src/app/admin/page.test.tsx`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/zh.ts`

- [x] **Step 1: Add tests for triage visibility and filters**

Cover:
- source rows display owner/disposition/next-review
- unassigned and overdue states are visible
- classification filter still works
- triage controls are admin-only

Run:

```bash
cd frontend
npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx
```

Expected: FAIL before UI implementation.

- [x] **Step 2: Implement the UI using compact operational controls**

Use existing Admin visual language. Do not turn the table into a marketing layout. Show source health as an operations queue:
- unassigned
- overdue
- review scheduled
- accepted fallback/manual/vendor-account disposition

Run:

```bash
cd frontend
npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx
npm run lint
```

Expected: PASS.

### Worker 3: Source Health Report Export

**Owner:** Source Ops reporting track.

**Files:**
- Modify: `frontend/scripts/source-health-check.ts`
- Create: `frontend/scripts/source-health-report.ts`
- Modify: `frontend/scripts/source-health-check.test.ts`
- Modify: `frontend/package.json`
- Modify: `docs/operations/source-health-check.md`

- [x] **Step 1: Add report command tests**

The report command must read the latest snapshot from the current DB runtime and produce JSON/CSV/Markdown without live network calls.

Run:

```bash
cd frontend
npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts
```

Expected: FAIL until report helper exists.

- [x] **Step 2: Implement report export**

Output must include:
- summary
- unhealthy classification counts
- owner/disposition/next-review when available
- trend/current streak
- recommended action

Output must not include:
- raw long HTML bodies
- credentials
- full secret values
- unsafe external attachment URLs

Run:

```bash
cd frontend
npm run source:health:report -- --format=markdown
npm run source:health:report -- --format=json
npm run source:health:report -- --format=csv
npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts
```

Expected: reports are generated and tests pass.

### Worker 4: Billing Local Hardening

**Owner:** Commercialization track.

**Files:**
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.ts`
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.test.ts`
- Modify: `frontend/src/app/api/billing/webhook/route.test.ts`
- Modify: `frontend/src/app/api/account/subscription/checkout/route.test.ts`
- Modify: `frontend/src/app/api/account/subscription/cancel/route.test.ts`
- Modify: `frontend/src/app/api/account/billing/portal/route.test.ts`
- Modify: `frontend/scripts/demo-smoke.ts`
- Modify: `frontend/scripts/demo-smoke.test.ts`

- [x] **Step 1: Harden sandbox helper tests**

Cover invalid tier, placeholder keys, live key in sandbox mode, invalid price id, invalid origin, timeout parsing, and secret redaction.

Run:

```bash
cd frontend
npm test -- src/server/billing/stripe-sandbox-verifier.test.ts
```

Expected: PASS after adding tests and fixes.

Actual: `npm test -- src/server/billing/stripe-sandbox-verifier.test.ts` passed with 11 helper tests covering missing env, invalid tier, placeholder keys, live key rejection, malformed origin, timeout parsing, readiness states, cancellation readiness, tier sync, cookie extraction, and secret redaction.

- [x] **Step 2: Expand billing route and smoke coverage**

Cover:
- unauthenticated 401
- Free/Enterprise checkout rejected
- Pro/Business checkout allowed
- portal behavior with and without provider customer id
- cancel only for active provider/local subscriptions
- ordinary user admin rejection still holds
- Business paid gated workspace API still opens

Run:

```bash
cd frontend
npm test -- src/app/api/account/subscription/checkout/route.test.ts src/app/api/account/subscription/cancel/route.test.ts src/app/api/account/billing/portal/route.test.ts scripts/demo-smoke.test.ts
```

Expected: PASS.

Actual: route/smoke tests passed with 4 files / 19 tests, and the broader billing slice passed with 6 files / 36 tests. Added coverage for Business checkout, Free/Enterprise checkout rejection through the billing service boundary, stale-session 401s, portal provider-customer-id errors, local/provider cancellation scheduling, no-active-subscription cancellation errors, ordinary user admin rejection, and Business paid gated workspace access. Full `npm test` passed with 229 files / 1,162 tests; `npm run lint`, `npm run build`, and `git diff --check` passed.

### Worker 5: Browser Demo Evidence Harness

**Owner:** UI/UE track.

**Files:**
- Create or modify: `frontend/scripts/demo-browser-evidence.ts`
- Create or modify: `frontend/scripts/demo-browser-evidence.test.ts`
- Modify: `frontend/package.json`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [x] **Step 1: Define evidence schema tests**

Evidence should record:
- route
- viewport
- role/session state
- title/headings
- page-level horizontal overflow boolean
- auth/admin/tier signals
- screenshot path if the harness supports screenshots

Run:

```bash
cd frontend
npm test -- scripts/demo-browser-evidence.test.ts
```

Expected: FAIL before implementation.

Actual after implementation: `npm test -- scripts/demo-browser-evidence.test.ts` passes with 6 tests covering schema, route matrix, sensitive-output redaction, 4xx page failure handling, CLI parsing, and npm script wiring.

- [x] **Step 2: Implement harness using the project’s available browser tooling**

Do not require live external portals. Use local dev origin and generated local users. Cover:
- anonymous `/`, `/search`, `/bids/1`, `/settings`
- ordinary Free user `/`, `/settings`, `/admin`
- admin `/admin`
- a generated real `/intents/<id>` when possible

Run:

```bash
cd frontend
npm run dev -- --port 3020
npm run demo:browser-evidence -- --origin=http://localhost:3020
npm test -- scripts/demo-browser-evidence.test.ts
```

Expected: evidence file is generated, no page-level horizontal overflow on core pages, admin/common user signals differ. Stop the dev server after the run.

Actual: `npm run demo:browser-evidence -- --origin=http://localhost:3020 --output=/tmp/winbids-demo-browser-evidence.json --timeout-ms=45000` passed using the Chrome DevTools collector. The report captured 18 entries across 9 role/route targets and 2 viewports, generated 18 screenshots, found 0 page-level horizontal overflow failures, included a generated real `/intents/<id>` route, and produced no `session=`, password, token, or Bearer leaks in the report scan. The CLI now cleans up Chrome/temporary profile state and exits cleanly after collection.

### Worker 6: Response Package Governance Lite

**Owner:** Workflow governance track.

**Files:**
- Modify: `frontend/src/server/response-workspace/types.ts`
- Modify: `frontend/src/server/response-workspace/service.ts`
- Modify: `frontend/src/server/response-workspace/service.test.ts`
- Modify: `frontend/src/components/intents/ResponseWorkspacePanel.tsx`
- Modify: `frontend/src/app/intents/[id]/page.test.ts`

- [x] **Step 1: Add governance summary tests**

Summary should include:
- pending review count
- approved count
- needs changes count
- longest pending age
- latest reviewer
- whether submission can reference a reviewed export

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'
```

Expected: FAIL before implementation.

Actual after implementation: target tests cover pending/approved/needs-changes export counts, longest pending age, latest reviewer, reviewed-export submission readiness, and Response Workspace panel wiring.

- [x] **Step 2: Implement governance summary and UI**

Keep export creation/download/review flows unchanged. Add a concise governance strip to the response package panel.

Run:

```bash
cd frontend
npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'
npm run lint
```

Expected: PASS.

Actual: `npm test -- src/server/response-workspace/service.test.ts 'src/app/intents/[id]/page.test.ts'` passed with 3 files / 44 tests. `npm run lint`, `npm run build`, and `git diff --check` passed. ResponsePackageWorkspace now returns `governanceSummary`, and the Response Package panel shows a concise governance strip without changing export creation/download/review flows.

### Worker 7: External Launch Handoff Gate

**Owner:** Production readiness / operations track.

**Files:**
- Create: `frontend/src/server/operations/launch-handoff.ts`
- Create: `frontend/src/server/operations/launch-handoff.test.ts`
- Create: `frontend/scripts/launch-handoff.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/README.md`
- Modify: `docs/operations/aws-deployment-runbook.md`

- [x] **Step 1: Define handoff report tests**

The report must summarize:
- Stripe sandbox E2E readiness
- production readiness preflight readiness
- AWS staging dry-run evidence
- live source-health evidence
- browser demo evidence
- risk gate evidence

It must return actionable blockers and commands when external credentials/evidence are missing, and must not print Stripe secrets, webhook secrets, database passwords, AWS secret keys, or object-storage secret keys.

Run:

```bash
cd frontend
npm test -- src/server/operations/launch-handoff.test.ts
```

Actual: passed with 3 tests covering ready status, blocker/command output, and secret redaction.

- [x] **Step 2: Implement CLI and docs**

Added:

```bash
npm run ops:launch-handoff
```

Use `--allow-blocked` to generate a report during no-credential dry-runs, or omit it so blockers fail the command for launch signoff. Use `--format=json --output=<path>` to write evidence artifacts.

Verification:

```bash
cd frontend
npm run ops:launch-handoff -- --help
npm run ops:launch-handoff -- --allow-blocked --format=json --output=/tmp/winbids-launch-handoff.json
```

Actual: both commands passed locally; the generated no-credential report marked all 6 external tracks blocked and produced no Stripe/webhook/database/AWS/object-storage secret leaks in the report scan.

### Worker 8: Source Health Evidence Bundle

**Owner:** Live source operations track.

**Files:**
- Create: `frontend/scripts/source-health-evidence.ts`
- Create: `frontend/scripts/source-health-evidence.test.ts`
- Modify: `frontend/package.json`
- Modify: `frontend/src/server/operations/launch-handoff.ts`
- Modify: `docs/operations/source-health-check.md`
- Modify: `docs/operations/aws-deployment-runbook.md`
- Modify: `frontend/README.md`

- [x] **Step 1: Define evidence bundle behavior**

The bundle must read the latest persisted source-health snapshot from the current runtime without calling public portals. It must report:
- 50-state observed/expected coverage
- snapshot age and stale status
- unhealthy / critical / warning counts
- missing owner / disposition / next-review counts
- overdue next-review counts
- classification counts
- high-priority source queue

Run:

```bash
cd frontend
npm test -- scripts/source-health-evidence.test.ts
```

Actual: passed with 5 tests covering ready evidence, missing snapshot blocker, stale/incomplete/untriaged blockers, output sanitization, CLI parsing, and npm script registration.

- [x] **Step 2: Implement evidence CLI and launch handoff integration**

Added:

```bash
npm run source:health:evidence
```

Use `--allow-blocked` for daily/weekly evidence generation and omit it for release signoff. `ops:launch-handoff` now includes the evidence command and accepts `SOURCE_HEALTH_OPS_EVIDENCE_URL` or `SOURCE_HEALTH_OPS_EVIDENCE_FILE`.

Verification:

```bash
cd frontend
npm test -- scripts/source-health-evidence.test.ts scripts/source-health-check.test.ts src/server/operations/launch-handoff.test.ts
npm run source:health:ops
npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.after.json
npm run source:health:report -- --format=markdown --output=/tmp/winbids-source-health-report.after.md
```

Actual: focused tests passed with 3 files / 22 tests. The live all-state probe completed on 2026-06-13 with 21/50 healthy, 29 unhealthy, 0 skipped. The evidence bundle covers 50/50 sources, is current, has 0 critical unhealthy sources, and initially blocked because all 29 unhealthy sources still needed owner, disposition, and next-review triage. Worker 9 resolved that local blocker.

### Worker 9: Source Health Bulk Triage Assignment

**Owner:** Live source operations track.

**Files:**
- Create: `frontend/scripts/source-health-triage.ts`
- Create: `frontend/scripts/source-health-triage.test.ts`
- Modify: `frontend/package.json`
- Modify: `docs/operations/source-health-check.md`
- Modify: `frontend/README.md`

- [x] **Step 1: Define triage plan behavior**

The bulk assignment tool must:
- default to dry-run
- require an owner or `SOURCE_HEALTH_OWNER`
- update only unhealthy sources missing triage fields by default
- support `--all-unhealthy` for intentional overwrite
- set next-review dates
- map source-health classifications/actions into durable dispositions
- avoid copying raw secrets or evidence snippets into notes

Run:

```bash
cd frontend
npm test -- scripts/source-health-triage.test.ts
```

Actual: passed with 5 tests covering disposition mapping, default only-missing plan behavior, all-unhealthy overwrite planning, dry-run/apply updater behavior, CLI parsing, and npm script registration.

- [x] **Step 2: Apply local triage and regenerate evidence**

Run:

```bash
cd frontend
npm run source:health:triage -- --owner=source-ops@winbids.local --format=json --output=/tmp/winbids-source-health-triage.dry.json
npm run source:health:triage -- --owner=source-ops@winbids.local --apply --format=json --output=/tmp/winbids-source-health-triage.apply.json
npm run source:health:evidence -- --allow-blocked --format=json --output=/tmp/winbids-source-health-evidence.post-triage.json
```

Actual: dry-run planned 29 updates / 21 skipped; apply wrote 29 updates to the current SQLite runtime. The regenerated evidence bundle returned `ok=true` with 50/50 observed states, 0 critical unhealthy, 0 unassigned unhealthy, 0 missing disposition, 0 missing next-review, and 0 overdue next-review.

- [x] **Step 3: Gate launch handoff on evidence file contents**

`ops:launch-handoff` now reads local `SOURCE_HEALTH_OPS_EVIDENCE_FILE` JSON instead of treating the path as a marker. The source-health track is ready only when the file is readable JSON, `ok=true`, expected/observed state coverage is complete, the snapshot is not stale, critical unhealthy count is zero, and owner/disposition/next-review blockers are clear. Local `ops-evidence/` output is ignored by Git.

Verification:

```bash
cd frontend
npm test -- src/server/operations/launch-handoff.test.ts
npm run source:health:evidence -- --allow-blocked --format=json --output=../ops-evidence/source-health/source-health-evidence.json
SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json
```

Actual: focused launch-handoff tests passed, and the local source-health handoff track returned `ready` with no source-health blockers after validating the generated evidence JSON. The follow-up source-health focused suite passed with 4 files / 29 tests, and full verification passed with `npm test` 232 files / 1,177 tests, `npm run lint`, `npm run build`, `npm run risk:check`, and `git diff --check`.

- [x] **Step 4: Require access-review evidence in launch handoff**

`ops:launch-handoff` now requires `SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE` alongside the source-health evidence URL/file. Local access-review JSON is read and validated for review coverage, entry count, `reviewMode`, and `requiredEvidence`, so Track D cannot be marked ready by a path-only source-health marker.

Verification:

```bash
cd frontend
npm test -- src/server/operations/launch-handoff.test.ts
SOURCE_HEALTH_OWNER=source-ops@winbids.local SOURCE_HEALTH_OPS_EVIDENCE_FILE=../ops-evidence/source-health/source-health-evidence.json SOURCE_HEALTH_ACCESS_REVIEW_FILE=../ops-evidence/source-health/source-health-access-review.json npm run ops:launch-handoff -- --allow-blocked --format=json --output=../ops-evidence/source-health/launch-handoff-source-health.json
```

Actual: launch-handoff focused tests passed with 1 file / 7 tests. The local source-health track returned `ready` with both local JSON files configured; overall launch handoff still showed 1 ready / 5 blocked because AWS, Stripe, production preflight, browser evidence, and risk evidence remain external tracks. The full Track D focused suite passed with 5 files / 35 tests; full `npm test` passed with 233 files / 1,183 tests; `npm run lint`, `npm run build`, `npm run risk:check`, and `git diff --check` passed.

### Worker 10: Source Health Access Review Packet

**Owner:** Live source operations track.

**Files:**
- Create: `frontend/scripts/source-health-access-review.ts`
- Create: `frontend/scripts/source-health-access-review.test.ts`
- Modify: `frontend/package.json`
- Modify: `docs/operations/source-health-check.md`
- Modify: `frontend/README.md`

- [x] **Step 1: Define access-review packet behavior**

The packet must read the latest persisted source-health operational report without calling public portals. It must include only unhealthy rows, group them into browser/vendor/timeout/network/registry/portal/parser/manual review modes, list required evidence and operator checklist items, support Markdown/JSON/CSV output, support mode filters, and sanitize credential-like text.

Run:

```bash
cd frontend
npm test -- scripts/source-health-access-review.test.ts
```

Actual: the test failed first because `source-health-access-review` did not exist, then passed after implementing the CLI and npm script.

- [x] **Step 2: Generate current local access-review evidence**

Run:

```bash
cd frontend
SOURCE_HEALTH_OWNER=source-ops@winbids.local npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json
```

Actual: the generated local evidence packet covers 50 sources and identifies 29 follow-up sources: 8 `browser_access`, 11 `vendor_account`, 6 `long_timeout_retry`, 2 `network_tls`, 1 `portal_status`, and 1 `parser_or_access`. Markdown, JSON, and filtered CSV outputs were generated under the Git-ignored `ops-evidence/source-health/` directory. Focused source-health suite passed with 5 files / 33 tests; full `npm test` passed with 233 files / 1,181 tests; `npm run lint`, `npm run build`, `npm run risk:check`, and `git diff --check` passed.

## External Execution Tracks

These tracks should be run by an operator when credentials and environments are ready.

### External Track A: AWS / S3 / RDS Staging Signoff

Run:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids npm run db:mysql:smoke
```

Required evidence:
- sanitized App Runner URL
- RDS migration/smoke logs
- S3 upload/download/head/delete evidence
- CloudFront/signed URL/app-proxy decision
- CloudWatch logs and alarm routing
- backup and restore proof

### External Track B: Stripe Sandbox E2E

Run:

```bash
cd frontend
npm run billing:stripe:sandbox -- --tier=pro --origin=http://localhost:3000
npm run billing:stripe:sandbox -- --tier=business --origin=http://localhost:3000
```

Required evidence:
- checkout completed
- webhook received through Stripe CLI
- subscription active/trialing/past_due state handled
- user tier and workspace tier updated
- portal URL created
- sandbox subscription canceled unless intentionally kept

### External Track C: Production Worker / Secrets / Backup Dry Run

Run:

```bash
cd frontend
NODE_ENV=production DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids NOTIFICATION_PROVIDER=http npm run workers:check
```

Required evidence:
- worker env uses MySQL
- notification provider is not local
- crawler/event/notification checks pass
- owner and backup/restore evidence fields are configured

## Freeze Checklist

For local worker batches:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run db:migrate
set -a; source .env.local; set +a; npm run db:mysql:migrate
set -a; source .env.local; set +a; npm run db:mysql:smoke
set -a; source .env.local; set +a; npm run workers:check
npm run demo:check
set -a; source .env.local; set +a; npm run demo:check
npm run risk:check
set -a; source .env.local; set +a; npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

For UI-affecting batches:

```bash
cd frontend
npm run dev -- --port 3020
npm run demo:smoke -- --origin=http://localhost:3020
```

Stop the dev server after the run.

## Completed Local Batch A: Source Health Triage Queue

Completed on 2026-06-12:

- Worker 1 added source-health triage persistence for SQLite and MySQL: owner, disposition, next-review, notes, and reviewed timestamp.
- Worker 1 wired PATCH support for admin/operator triage updates while keeping legal/source approval governance admin-only.
- Worker 1 added light credential-like redaction for triage notes.
- Worker 2 added the Admin Data Sources triage panel with unassigned/overdue/scheduled/reviewed states, disposition labels, and quick save actions for assign review, accept fallback, manual path, vendor account, and clear triage.
- Integration fix: MySQL risk-check data-source mapper now includes the new triage columns so production build remains type-clean.

Verification:

```bash
cd frontend
npm test -- src/server/admin/data-sources-repository.test.ts 'src/app/api/admin/data-sources/[id]/route.test.ts' src/server/db/schema.test.ts
npm test -- src/app/admin/page.test.ts src/app/admin/page.test.tsx
npm test -- src/lib/api/admin.test.ts
npm test -- src/server/risk/checklist.test.ts
npm run db:migrate
set -a; source .env.local; set +a; npm run db:mysql:migrate
npm run risk:check
npm run lint
npm run build
git diff --check
```

Browser verification:
- `/admin` renders Data Sources and Health triage quick actions.
- No runtime error and no page-level horizontal overflow at 1280px.

## Completed Local Batch A2: Source Health Report Export

Completed on 2026-06-12:

- Added `npm run source:health:report`.
- Added `frontend/scripts/source-health-report.ts`.
- Report export reads the latest persisted `source_health_snapshots` rows from the current runtime only; it does not run live source probes or fetch public portals.
- Supports `--format=markdown|json|csv`, default markdown, and optional `--output=<path>`.
- Output includes summary counts, unhealthy classification counts, source triage owner/disposition/next-review, trend/current streak, healthy percentage, recommended action, severity, and sanitized reason.
- Output omits raw URLs and evidence snippets and redacts credential-like values and long HTML bodies before writing Markdown, JSON, or CSV.
- SQLite and MySQL runtime paths are covered; MySQL was also verified against the local `.env.local` runtime.

Verification:

```bash
cd frontend
npm test -- scripts/source-health-check.test.ts src/server/source-validity/health-snapshots.test.ts
npm run source:health:report -- --format=markdown --output /tmp/winbids-source-health-report.md
npm run source:health:report -- --format=json --output /tmp/winbids-source-health-report.json
npm run source:health:report -- --format=csv --output /tmp/winbids-source-health-report.csv
set -a; source .env.local; set +a; npm run source:health:report -- --format=json --output /tmp/winbids-source-health-report.mysql.json
npm run risk:check
npm run lint
npm run build
git diff --check
```

Observed runtime summaries:
- SQLite report: 50 total, 20 healthy, 30 unhealthy, 0 skipped.
- MySQL report: 50 total, 22 healthy, 28 unhealthy, 0 skipped.

## Recommended Next Batch

If no AWS or Stripe credentials are available, start local workers in this order:

1. Done: Worker 1 and Worker 2 together: source triage data + Admin triage UI/save actions.
2. Done: Worker 3: source health report export.
3. Next: Worker 5: browser demo evidence harness.
4. Worker 6: response package governance lite.
5. Worker 4: billing local hardening, or run it earlier if billing confidence is the priority.

If AWS access is available, run External Track A first. If Stripe keys are available first, run External Track B first.

## Self-Review

Spec coverage:
- P0-P3 requirements are grouped by external blockers and local implementable work.
- Four agent findings are reflected in concrete worker tracks.
- Each worker has file ownership, test commands, and acceptance criteria.
- External tracks list exact evidence requirements.

Placeholder scan:
- Redacted credential placeholders are intentional.
- No task uses open-ended “TBD” implementation language.

Type/interface consistency:
- Suggested field names are consistent across data, API, and UI tasks.
- Source-health dispositions are kept separate from legal approval fields.
