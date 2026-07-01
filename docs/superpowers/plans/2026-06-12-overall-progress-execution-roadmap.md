# WinBids Overall Progress Execution Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current local MVP into a production-ready procurement intelligence platform through a prioritized P0-P3 execution roadmap.

**Architecture:** Treat the current local system as the stable baseline and move forward through parallel but independently testable tracks: production infrastructure signoff, commercialization verification, source-health operations, UI/UE demo polish, workflow governance, and AI/Enterprise depth. Each track must update status docs, run focused tests, and then pass the shared freeze checklist before being marked complete.

**Tech Stack:** Next.js 16, TypeScript, SQLite local runtime, MySQL production-like runtime, AWS App Runner/RDS/S3/CloudFront/Secrets Manager target architecture, Stripe sandbox/live billing, Vitest, ESLint, custom demo/risk/worker smoke scripts.

---

## Current Progress Baseline

Updated: 2026-06-12

| Dimension | Completion | Current interpretation |
|---|---:|---|
| Local usable MVP | 92% | Search, 50-state data, auth, admin/user/tier separation, intent workspace, response workspace, artifact vault, quote workflow, deadline reminders, package exports, submission evidence, and local smoke checks are usable. |
| Production launch readiness | 70% | MySQL, AWS runbook, worker checks, production preflight, S3-compatible adapter, strict S3 posture validation, and backup/restore evidence requirements exist; real AWS/S3/Stripe/email/backup execution is not complete. |
| Commercialization loop | 68% | Registration/login, admin/common user separation, plan gates, Stripe foundation, sandbox verifier, checkout/portal/cancel/webhook paths exist; real Stripe sandbox/live verification is blocked on credentials. |
| Procurement workflow depth | 85% | Submission, compliance, pursue/no-bid, response workspace, artifact vault, quote, deadline, award/win-loss, exports, review history, version comparison, and artifact replacement are locally usable. |
| AI / Enterprise depth | 38% | Deterministic AI metadata, lexical Knowledge trace, dry-run credit ledger, and Enterprise-gated displays exist; real LLM, embeddings, vector retrieval, and real credit metering remain open. |
| Full PRD / long-term platform | 68-70% | The local platform is credible, but real production operations, enterprise governance, and intelligent automation still drive the remaining gap. |

## P0-P3 Priority Model

### P0: Launch-Blocking Production Readiness

Scope:
- AWS staging smoke for App Runner/RDS/S3/CloudFront/Secrets Manager/CloudWatch.
- Real S3 artifact/package upload, download, head, delete, signed URL or app-proxy behavior.
- Stripe sandbox E2E against MySQL with real test mode keys and CLI webhook forwarding.
- Production worker dry run for crawler, event outbox, notifications, and dunning.
- Backup/restore evidence, secret ownership, webhook rotation ownership.

Acceptance:
- `NODE_ENV=production npm run ops:production:check` exits 0 with only configured markers.
- `npm run db:mysql:migrate` and `npm run db:mysql:smoke` pass against staging RDS.
- `npm run workers:check` passes in production-like MySQL runtime with non-local notification provider.
- Stripe sandbox verifier confirms checkout, webhook subscription update, tier update, portal session, and cleanup.
- S3 staging evidence URL documents real upload/download/integrity behavior.

### P1: Local MVP Demo Polish And Product Trust

Scope:
- Browser walkthrough of anonymous, registered free, paid Business/Enterprise, and admin journeys.
- High-visibility page polish for `/`, `/search`, `/bids/[id]`, `/intents/[id]`, `/settings`, `/admin`.
- Dashboard remains overview/notifications oriented, not duplicated search.
- Source-health and 50-state risks are visible without making the product look broken.
- Demo links must not point to placeholder or known 404 evidence.

Acceptance:
- `npm run demo:check` passes with 50/50 states and no placeholder URLs.
- `npm run demo:smoke -- --origin=<local origin>` passes.
- Manual or Browser-assisted smoke confirms ordinary user and admin screens are visibly/functionally different.
- Mobile layout checks do not show text/button/attachment overflow on core pages.

### P2: Workflow Governance And Enterprise Depth

Scope:
- Review governance: approver display, review policy/threshold, review report export.
- Artifact/compliance auto-linking so supplier materials feed compliance evidence more directly.
- Award/outcome learning loop beyond manual capture.
- Admin source approval governance and event/audit expansion.
- Usage metrics for storage, artifacts, quotes, AI calls, Knowledge Station, and credits.

Acceptance:
- Every new workflow state has API, UI, audit/event coverage where appropriate.
- Feature gates and locked/upgrade states are visible for Free/Pro/Business/Enterprise.
- MySQL smoke covers newly introduced tables and core read/write paths.
- Docs record what is deterministic/local-only versus production-backed.

### P3: AI / Enterprise Intelligence

Scope:
- Real LLM provider seam with model/version/prompt metadata and fallback behavior.
- Embeddings/vector retrieval for Knowledge Station.
- Real credit consumption/refund and usage ledger.
- Product 6 intelligence datasets and advanced procurement insights.
- Evaluation criteria for model quality, source confidence, and hallucination controls.

Acceptance:
- No feature claims real AI unless provider keys, evaluation rules, fallback policy, and credit charging policy are approved.
- AI outputs include provenance, confidence, cost/credit metadata, and deterministic fallback state.
- Enterprise-only features remain gated at API and UI layers.

## Execution Tracks

### Track A: Production Artifact / Package Storage External Signoff

**Files:**
- Read/update: `docs/operations/aws-deployment-runbook.md`
- Read/update: `docs/product-requirements/winbids-implementation-status.md`
- Read/update: `docs/product-requirements/winbids-next-development-plan.md`
- Validate: `frontend/src/server/storage/object-storage.ts`
- Validate: `frontend/src/server/operations/production-readiness.ts`

- [ ] **Step 1: Prepare strict S3 staging environment**

Required environment:

```bash
NODE_ENV=production
DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_BUCKET=<staging-bucket>
OBJECT_STORAGE_REGION=<aws-region>
OBJECT_STORAGE_BASE_URL=https://s3.<aws-region>.amazonaws.com
OBJECT_STORAGE_CREDENTIALS_REF=<secrets-manager-ref>
OBJECT_STORAGE_PUBLIC_ACCESS=private
OBJECT_STORAGE_SIGNED_URL_MODE=app-proxy
OBJECT_STORAGE_MALWARE_SCANNER=external
OBJECT_STORAGE_RETENTION_POLICY=<approved-retention-policy-id>
OBJECT_STORAGE_STAGING_SMOKE_EVIDENCE_URL=<internal evidence URL>
```

- [ ] **Step 2: Run production readiness preflight**

Run:

```bash
cd frontend
NODE_ENV=production npm run ops:production:check
```

Expected: exits 0 and prints only configured markers for secrets/evidence.

- [ ] **Step 3: Run real staging storage smoke**

Use an operator script or manual API flow to upload, download, replace, and delete a harmless test artifact through the app route, not direct S3 calls.

Expected:
- Upload creates artifact and version 1.
- Replace creates version 2 and keeps version 1 in history.
- Download validates byte size and SHA-256.
- Delete hides the artifact from active vault and dependent links.
- Evidence URL is saved in the runbook.

- [ ] **Step 4: Update status docs**

Update:
- `docs/operations/aws-deployment-runbook.md`
- `docs/product-requirements/winbids-implementation-status.md`
- `docs/product-requirements/winbids-next-development-plan.md`

Include exact commands, sanitized evidence URLs, pass/fail, and remaining owner decisions.

### Track B: Stripe Sandbox E2E

**Files:**
- Read/update: `docs/operations/stripe-sandbox-e2e.md`
- Validate: `frontend/src/server/billing/stripe-sandbox-verifier.ts`
- Validate: `frontend/src/app/api/account/subscription/checkout/route.ts`
- Validate: `frontend/src/app/api/billing/webhook/route.ts`

- [ ] **Step 1: Configure sandbox credentials outside git**

Required environment:

```bash
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_<redacted>
STRIPE_WEBHOOK_SECRET=whsec_<redacted>
STRIPE_PRICE_PRO_MONTHLY=price_<redacted>
STRIPE_PRICE_BUSINESS_MONTHLY=price_<redacted>
DATABASE_URL=mysql://winbids:<redacted>@127.0.0.1:3306/winbids
```

- [ ] **Step 2: Start local app and webhook forwarder**

Run app:

```bash
cd frontend
npm run dev -- --port 3000
```

Run Stripe CLI in a separate terminal:

```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

- [ ] **Step 3: Run sandbox verifier**

Run:

```bash
cd frontend
npm run billing:stripe:sandbox -- --tier=pro --origin=http://localhost:3000
```

Expected:
- Checkout URL opens.
- Stripe test card completes checkout.
- Local subscription becomes paid provider state.
- User tier and organization tier update.
- Billing portal session is created.
- Test subscription is canceled unless `--skip-cancel` is used.

- [ ] **Step 4: Update billing docs and status**

Record sanitized success/failure details in:
- `docs/operations/stripe-sandbox-e2e.md`
- `docs/product-requirements/winbids-implementation-status.md`

### Track C: Production Worker / Secrets / Backup Dry Run

**Files:**
- Read/update: `docs/operations/aws-deployment-runbook.md`
- Read/update: `docs/operations/production-billing-worker-runbook.md`
- Read/update: `docs/transferability/secrets-and-access.md`
- Validate: `frontend/scripts/crawler-worker.ts`
- Validate: `frontend/scripts/event-worker.ts`
- Validate: `frontend/scripts/notification-worker.ts`

- [ ] **Step 1: Populate production-like owner/evidence variables**

Required non-secret variables:

```bash
PRODUCTION_OWNER_BILLING=<billing owner mailbox>
PRODUCTION_OWNER_WORKERS=<worker owner mailbox>
PRODUCTION_OWNER_BACKUPS=<backup owner mailbox>
PRODUCTION_BACKUP_RUNBOOK_URL=<internal backup runbook URL>
PRODUCTION_BACKUP_EVIDENCE_URL=<internal backup evidence URL>
PRODUCTION_RESTORE_EVIDENCE_URL=<internal restore rehearsal evidence URL>
PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP=<ISO-8601 UTC timestamp>
```

- [ ] **Step 2: Run worker preflight in strict mode**

Run:

```bash
cd frontend
NODE_ENV=production DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids NOTIFICATION_PROVIDER=http npm run workers:check
```

Expected: exits 0; database is MySQL; notification provider is not `file` or `console`.

- [ ] **Step 3: Record backup and restore evidence**

Evidence must include:
- RDS snapshot or logical dump proof.
- Restore rehearsal proof.
- Rollback target.
- Owner and timestamp.

- [ ] **Step 4: Update transferability docs**

Update:
- `docs/transferability/environment-variables.md`
- `docs/transferability/secrets-and-access.md`
- `docs/transferability/deployment-guide.md`
- `docs/operations/aws-deployment-runbook.md`

### Track D: Live Source Health Operations

**Files:**
- Read/update: `docs/operations/source-health-check.md`
- Validate: `frontend/scripts/source-health-check.ts`
- Validate: `frontend/src/server/source-validity/live-source-health.ts`
- Validate: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Run all-state live health in report-only mode**

Run:

```bash
cd frontend
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
```

Expected: report is produced, persisted, and every 403/timeout/bot-check/login/empty/network case is classified.

- [ ] **Step 2: Review Admin source health**

Open `/admin`, filter by source classification, and confirm source risk is understandable to an operator.

- [ ] **Step 3: Promote eligible beta sources**

Only promote a source after evidence shows:
- Official or approved public source.
- Non-empty current opportunities.
- Stable detail URL behavior.
- Attachment download does not point to placeholder or unsafe URLs.

### Track E: UI/UE Demo Polish

**Files:**
- Review/update: `frontend/src/app/page.tsx`
- Review/update: `frontend/src/app/search/page.tsx`
- Review/update: `frontend/src/app/bids/[id]/page.tsx`
- Review/update: `frontend/src/app/intents/[id]/page.tsx`
- Review/update: `frontend/src/app/settings/page.tsx`
- Review/update: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: Run baseline demo smoke**

Run:

```bash
cd frontend
npm run dev -- --port 3000
npm run demo:smoke -- --origin=http://localhost:3000
```

Expected: all eight smoke checks pass.

- [ ] **Step 2: Inspect core pages at desktop and mobile widths**

Check:
- `/`
- `/search`
- `/bids/1`
- `/intents/<generated intent id>`
- `/settings`
- `/admin`

Expected:
- No text overflow.
- Login/register entry is visible to anonymous users.
- Admin and regular user surfaces differ.
- Dashboard is summary/notification oriented.
- Search is the primary opportunity discovery surface.

- [ ] **Step 3: Add or update focused tests**

Use existing static tests for page structure and behavior:

```bash
cd frontend
npm test -- src/app/search/page.test.ts 'src/app/bids/[id]/page.test.ts' 'src/app/intents/[id]/page.test.ts' src/app/settings/page.test.ts src/app/admin/page.test.ts
```

Expected: all targeted tests pass.

## Shared Freeze Checklist

Run after every completed track before updating completion percentages:

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
npm run risk:check
npm audit --omit=dev --audit-level=high
git diff --check
```

For UI-affecting tracks, also run:

```bash
cd frontend
npm run dev -- --port 3020
npm run demo:smoke -- --origin=http://localhost:3020
```

Stop the dev server after smoke.

## Documentation Update Rule

After each completed track, update:
- `docs/product-requirements/winbids-implementation-status.md`
- `docs/product-requirements/winbids-next-development-plan.md`
- The relevant operations runbook.
- `frontend/README.md` if a developer command or local capability changes.

Each update must include:
- What changed.
- Verification commands and pass/fail evidence.
- Current remaining priorities.
- The next recommended track.

## Recommended Next Execution Order

Use `docs/superpowers/plans/2026-06-12-multi-agent-production-readiness-and-depth-plan.md` for the next multi-agent worker batch. It supersedes this roadmap for active execution while preserving this file as the high-level progress baseline.

1. **Track A: Production Artifact / Package Storage External Signoff** if AWS staging access is available.
2. **Track B: Stripe Sandbox E2E** if Stripe test credentials are available before AWS.
3. **Track C: Production Worker / Secrets / Backup Dry Run** if deployment ownership is ready.
4. **Track D: Live Source Health Operations** can run in parallel as report-only.
5. **Track E: UI/UE Demo Polish** should continue whenever external credentials are blocked.

## Execution Log

### 2026-06-12 Track D / Track E Local Pass

Completed:
- Track D Step 1: ran `npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body`.
- Fixed the only hard stale registry URL found in this run: `ms_state_procurement` now uses `https://www.ms.gov/dfa/contract_bid_search/Bid?autoloadGrid=true`.
- Verified MS with `npm run source:health:check -- --source MS --timeout-ms 10000 --report-only --persist --inspect-body`; result was 1/1 healthy.
- Re-ran all-state live source health in the MySQL runtime; result was 22/50 healthy, 28 unhealthy, 0 skipped, with remaining findings classified as operational risks.
- Fixed `source-health-check --persist` so it writes snapshots to MySQL when `DATABASE_URL` or `MYSQL_DATABASE_URL` is MySQL; without MySQL it still writes SQLite.
- Track D Step 2: browser-reviewed `/admin` Data Sources live-health filtering. `Login required` filtering shows 14/56 source rows with checked time, HTTP status, reason, and evidence snippets.
- Track E Step 1: ran `npm run demo:smoke -- --origin=http://localhost:3021`; result was 8 smoke checks passed.
- Track E Step 1 repeat: ran `npm run demo:smoke -- --origin=http://localhost:3022`; result was 8 smoke checks passed.
- Track E Step 2: Browser-assisted walkthrough passed for anonymous desktop/mobile home/search/bid detail/settings, ordinary Free registration/settings/admin-denial, and local admin login/admin operations. Page-level horizontal overflow was not observed on checked desktop/mobile pages.
- Track E Step 3: ran focused static/page tests for search, bid detail, intent detail, settings, admin, home, and bid card; result was 9 files / 48 tests passed.
- Runtime checks: SQLite and MySQL `npm run demo:check` passed, SQLite and MySQL `npm run risk:check` passed, `npm run lint` passed, `npm run build` passed, and `git diff --check` passed.

Still open:
- Track D Step 3 did not promote beta sources; promotion still requires production-like network evidence and source-owner approval.
- Track E still needs an automated screenshot/visual-regression harness if the team wants repeatable pixel-level proof; this pass was Browser-assisted DOM/viewport verification, not a committed screenshot test suite.

## Self-Review

Spec coverage:
- Overall progress percentages are captured.
- P0-P3 priorities are mapped to concrete tracks.
- External blockers are separated from local product work.
- Each track has files, exact commands, and acceptance criteria.
- Shared freeze checklist is explicit.

Placeholder scan:
- No TBD/TODO/fill-in placeholder remains.
- Redacted credential placeholders are intentional and must not be replaced in git.

Type/interface consistency:
- The plan references existing scripts and docs only.
- No new API shape is invented in this plan.
