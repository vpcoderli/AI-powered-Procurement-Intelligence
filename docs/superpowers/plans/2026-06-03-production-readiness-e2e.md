# Production Readiness E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move billing, production deployment handoff, source health operations, and response package depth from local foundations to repeatable operator verification.

**Architecture:** Keep real-money Stripe verification operator-assisted and HTTP-route based. Add deterministic preflight helpers for local/CI-safe checks, and keep live government portal probes opt-in because public portals can return 403, timeout, or bot checks from developer networks.

**Tech Stack:** Next.js 16, TypeScript, Vitest, tsx scripts, MySQL runtime, Stripe SDK, existing crawler/source-validity registry.

---

### Task 1: Stripe Sandbox Hardening

**Files:**
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.ts`
- Modify: `frontend/src/server/billing/stripe-sandbox-verifier.test.ts`
- Modify: `docs/operations/stripe-sandbox-e2e.md`

- [ ] **Step 1: Write failing validation tests**

Add tests that call `validateStripeSandboxConfig()` with `STRIPE_SECRET_KEY=sk_test_REPLACE_ME`, `STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME`, and `STRIPE_PRICE_PRO_MONTHLY=price_REPLACE_ME`, then expect placeholder-specific errors. Also assert malformed `--timeout-ms=abc` and unsafe `--origin=ftp://example.test` fail.

Run:

```bash
cd frontend
npm test -- src/server/billing/stripe-sandbox-verifier.test.ts
```

Expected before implementation: at least one new placeholder validation assertion fails.

- [ ] **Step 2: Implement sandbox placeholder validation**

Add an `isPlaceholderValue()` helper that rejects `REPLACE_ME`, `placeholder`, and values ending in `_...` for the Stripe secret, webhook secret, and price ids. Keep summary output secret-safe.

- [ ] **Step 3: Verify Stripe sandbox tests**

Run:

```bash
cd frontend
npm test -- src/server/billing/stripe-sandbox-verifier.test.ts
```

Expected after implementation: all tests in the file pass.

### Task 2: Production Operations Dry Run

**Files:**
- Create: `frontend/src/server/operations/production-readiness.ts`
- Create: `frontend/src/server/operations/production-readiness.test.ts`
- Create: `frontend/scripts/production-readiness-check.ts`
- Modify: `frontend/package.json`
- Modify: `docs/operations/production-billing-worker-runbook.md`

- [ ] **Step 1: Write failing readiness tests**

Create tests that validate:

```ts
validateProductionReadiness({
  NODE_ENV: "production",
  BILLING_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_live",
  STRIPE_PRICE_PRO_MONTHLY: "price_live_pro",
  STRIPE_PRICE_BUSINESS_MONTHLY: "price_live_business",
  DATABASE_URL: "mysql://user:pass@db.example.com:3306/winbids",
  PRODUCTION_OWNER_BILLING: "finance@example.com",
  PRODUCTION_OWNER_WORKERS: "ops@example.com",
  PRODUCTION_OWNER_BACKUPS: "infra@example.com",
  PRODUCTION_BACKUP_RUNBOOK_URL: "https://docs.example.com/backups",
}).ok === true
```

Also assert missing owner and backup fields fail without printing secret values.

Run:

```bash
cd frontend
npm test -- src/server/operations/production-readiness.test.ts
```

Expected before implementation: the new module cannot be resolved.

- [ ] **Step 2: Implement readiness helper and CLI**

The helper should call existing `validateProductionBillingPreflight()`, validate ownership fields, and format a secret-safe summary. The CLI should load `.env.local`, print the summary, and exit non-zero on validation failure.

- [ ] **Step 3: Wire npm script**

Add:

```json
"ops:production:check": "tsx scripts/production-readiness-check.ts"
```

- [ ] **Step 4: Verify operations tests**

Run:

```bash
cd frontend
npm test -- src/server/operations/production-readiness.test.ts src/server/billing/production-preflight.test.ts
```

Expected: all tests pass.

### Task 3: Live Source Health Operations Handoff

**Files:**
- Modify: `docs/operations/source-health-check.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] **Step 1: Document the deterministic/live split**

Update the runbook so operators understand:

- `npm run risk:check` proves deterministic local integrity.
- `npm run source:health:check -- --all --report-only --persist` captures live external risk.
- 403/timeout are operations risks, not automatic product data failures.
- 404/410 require registry correction.

- [ ] **Step 2: Add weekly and release check cadence**

Add release, weekly, and post-registry-change cadence with owner expectations.

### Task 4: Response Package Production Depth Handoff

**Files:**
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] **Step 1: Clarify current depth**

Document that local Markdown export and download are implemented, while production depth still needs object storage, malware scanning for uploads, immutable export history, richer package versioning, and audit review.

- [ ] **Step 2: Keep next implementation slice concrete**

Set the next slice to response package production storage/audit rather than vague "more depth".

### Task 5: Full Verification

**Files:**
- No production code edits after this step unless verification reveals a failure.

- [ ] **Step 1: Run targeted tests**

```bash
cd frontend
npm test -- src/server/billing/stripe-sandbox-verifier.test.ts src/server/operations/production-readiness.test.ts src/server/billing/production-preflight.test.ts
```

- [ ] **Step 2: Run regression checks**

```bash
cd frontend
npm test
npm run lint
npm run build
npm run workers:check
npm run db:mysql:smoke
npm audit --omit=dev --audit-level=high
git diff --check
```

- [ ] **Step 3: Report blocked external checks**

If real Stripe test credentials or production live credentials are not present, report them as blocked by missing external secrets while confirming the verifier/preflight code path is implemented and tested.
