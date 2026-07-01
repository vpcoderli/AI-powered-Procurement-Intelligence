This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Demo Smoke

Start the local app before running the repeatable Browser/API smoke:

```bash
npm run dev -- --port 3000
npm run demo:smoke -- --origin=http://localhost:3000
```

The smoke runner uses headless HTTP checks, not a real browser dependency. It verifies anonymous public pages, auth-required workspace APIs, generated ordinary-user registration/login/session/settings, ordinary-user admin rejection, local admin reset/login plus admin summary/users/data-sources/risk APIs, a generated Business paid fixture against the response workspace API, and `/api/bids/1` attachment download safety. It does not print generated passwords, admin passwords, temporary paid-user passwords, or session cookies.

## Local Admin Login

Reset or create the local development admin account with:

```bash
npm run auth:reset-admin
```

The default local-only credential is `admin@winbids.local` / `AdminLocal-2026!`. You can override it for a single run with `LOCAL_ADMIN_EMAIL` and `LOCAL_ADMIN_PASSWORD`. Do not reuse this password in production; production admin access must use the deployment password reset flow.

## Billing Provider

Local development works without external billing credentials. In that mode, checkout and billing portal sessions fall back to local/template URLs.

To enable Stripe-backed subscription billing, configure:

```bash
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_BUSINESS_MONTHLY=price_...
```

Stripe webhooks should POST to `/api/billing/webhook` with the standard `Stripe-Signature` header. The app maps Stripe checkout, subscription, and invoice events into the internal billing event format before updating user tiers and subscription state.

To run the operator-assisted Stripe sandbox E2E verifier, start the local app and Stripe CLI webhook forwarder, then run:

```bash
npm run billing:stripe:sandbox -- --tier=pro
```

Use `--tier=business` for the Business plan, `--origin=http://localhost:3000` to target a different local origin, `--timeout-ms=300000` to change the webhook wait timeout, and `--skip-cancel` to keep the test subscription after verification. Full setup and troubleshooting steps live in [`../docs/operations/stripe-sandbox-e2e.md`](../docs/operations/stripe-sandbox-e2e.md).

Production billing deployment, live/test key isolation, webhook rotation, worker scheduling, owner handoff, backup runbook ownership, and provider dashboard checks are covered in [`../docs/operations/production-billing-worker-runbook.md`](../docs/operations/production-billing-worker-runbook.md). The production handoff preflight is:

```bash
NODE_ENV=production npm run ops:production:check
```

To generate one consolidated external launch handoff report across Stripe sandbox, production preflight,
AWS staging dry-run evidence, live source-health evidence, browser demo evidence, and risk gate evidence:

```bash
npm run ops:launch-handoff -- --allow-blocked
```

Use `--format=json --output=../ops-evidence/launch-handoff.json` to save a machine-readable report.
The root-level `ops-evidence/` directory is intentionally ignored by Git because it can contain local
operator notes and environment-specific release evidence.
For Stripe sandbox evidence alongside production live billing config, set the sandbox-only aliases
`STRIPE_SANDBOX_SECRET_KEY`, `STRIPE_SANDBOX_WEBHOOK_SECRET`, `STRIPE_SANDBOX_PRICE_PRO_MONTHLY`, and
`STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY`. The report prints configured markers and blocker names only,
not secret values. If `SOURCE_HEALTH_OPS_EVIDENCE_FILE` is set, the report reads the JSON bundle and
requires `ok=true`, 50-state coverage, a fresh snapshot, zero critical unhealthy sources, and no missing
owner/disposition/next-review blockers. The source-health track also requires
`SOURCE_HEALTH_ACCESS_REVIEW_URL` or `SOURCE_HEALTH_ACCESS_REVIEW_FILE`; local access-review JSON is
validated for review count, `reviewMode`, and `requiredEvidence`. Use URL variables for external evidence
systems that cannot be read locally.

AWS publishing steps are covered in [`../docs/operations/aws-deployment-runbook.md`](../docs/operations/aws-deployment-runbook.md). The recommended first AWS web release is App Runner + RDS MySQL + Secrets Manager/SSM + CloudWatch; full production requires a separate worker runtime such as ECS/Fargate scheduled tasks.

## Risk Checklist

Run the local risk checklist before handing off a development phase:

```bash
npm run risk:check
```

This verifies that all 50 states have active non-empty state bid data, bid detail route IDs round-trip safely, state attachments use the internal download route instead of broken public URLs, ordinary/admin/paid feature entitlements remain separated, and production dependencies have no moderate-or-higher audit findings.

## Artifact Vault

Business-tier users can upload supplier-managed artifacts from an Intent detail page. Local development stores uploaded files under:

```bash
frontend/data/artifact-vault/
```

The database keeps the intent/bid association, artifact type, purpose, expiry date, review status, file metadata, checksum, internal download route, soft-delete metadata, derived security scan status, retention policy, and append-only file version records. Local uploads now go through the shared object-storage provider, downloads verify byte size plus SHA-256 before returning file content, deterministic local/noop malware test signatures are blocked before storage/DB writes, deletes write `artifact.deleted` audit events while hiding the artifact from the active vault, Response Workspace links, and Quote Workspace links, and replacements write a new artifact version plus `artifact.replaced` audit metadata while preserving the prior file history. The provider supports local files by default and an S3-compatible SigV4 REST path when `OBJECT_STORAGE_PROVIDER=s3` plus runtime credentials are injected. Do not commit uploaded files, local storage paths, or object-storage credentials. Production hardening still needs real AWS/S3 staging validation, signed URL/CDN posture, external malware scanning, and approved retention/lifecycle policy proof.

## Quote Workspace

Business-tier users can manage a lightweight quote workflow from an Intent detail page. The local v1 stores organization-scoped sourcing partners, intent-level quote requests, requested due dates, status, quoted amount, response notes, and links to uploaded supplier artifacts.

The Quote Workspace is manual-first: it does not send supplier emails or expose a supplier portal. Quote comparison and deterministic CSV/JSON quote parser logic exist locally, while the visible upload UI, XLSX parsing, richer notification/audit integration, response uploads, deeper scoring, and richer supplier profiles remain future depth.

## Deadline Notifications

Business-tier users can view deadline reminders from an Intent detail page. Local v1 stores reminders in `deadline_reminders` and derives them idempotently from bid deadlines, response workspace task due dates, quote request due dates, and supplier artifact expiry dates.

Users can acknowledge reminders or snooze them for 24 hours from the Intent panel and account reminder center. The workflow is MySQL-runtime aware when `DATABASE_URL` or `MYSQL_DATABASE_URL` points to MySQL. Production email/calendar delivery, notification outbox scheduling, digest preferences, submission checkpoint reminders, and richer audit events remain future depth.

## Response Workspace Collaboration

Business-tier users can coordinate response workspace items from an Intent detail page. Local v1 stores task/checkpoint/artifact/outline items in `response_workspace_items`, supports owner assignment through `assigned_user_id`, item-level comments, linked artifacts with soft-delete filtering, activity history, response package snapshots with full version-history totals, an expandable all-version list, adjacent version summaries/change comparisons, any-version side-by-side comparison, Markdown/ZIP/PDF/DOCX exports, package manifests, download audit timestamps, approve/request-changes review actions, redacted review audit events, export review-state metadata, and manifest-backed export download integrity checks.

The current collaboration slice is manual-first: users can update item status/notes, assign owners from visible workspace members, add comments, link artifacts, create package snapshots, inspect the full version list, compare any two package versions, export Markdown/ZIP/PDF/DOCX packages, approve or request changes on generated packages, download generated packages, and freeze concrete package/export evidence on submission confirmations. Future depth should add real AWS/S3 staging validation, external malware scanning, approved retention lifecycle proof, review governance reporting, and eventual drafting automation.

## MySQL Runtime And Migration

SQLite remains the default local runtime when no MySQL URL is configured. When `DATABASE_URL` or `MYSQL_DATABASE_URL` points to MySQL, the runtime `db` singleton becomes an explicit guard instead of opening SQLite; migrated product paths use MySQL adapters and unmigrated paths fail loudly. Use the migration tooling below:

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:import-sqlite
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:smoke
```

This migration path has been smoke-tested against MySQL 8 with a fresh schema, an idempotent re-run, a long bid-description insert, repeatable SQLite-to-MySQL data import, crawler/admin reads, direct JSON crawler import/upsert, crawler control locks/source enablement, crawler alert matching/digest notification, event outbox delivery, bid search/detail, saved bids, attachment metadata, auth/account/workspace/admin-users/admin-config/admin-bid-QA/dashboard/billing/dunning/subscription-reconcile, search alerts/notifications, deadline reminders, Knowledge Station, and the core intent panels for compliance, submission, response workspace, pursuit decision, and qualification evidence. The `db:mysql:smoke` command redacts credentials in logs. Indexed text columns are converted to `VARCHAR(191)`, while long content columns are preserved as `LONGTEXT`.

Local MySQL verification also includes route-level guard coverage, admin versus ordinary-user browser smoke, paid-feature locked states, 50-state detail sampling, and the refreshed deterministic release gate with 50/50 states, 1,146 active state bid detail routes, and 216 safe local attachment download routes. The remaining production signoff items are Stripe sandbox verification in MySQL mode with real test credentials, low-risk live billing webhook/checkout validation, production worker deployment dry runs, and final credential/runbook execution. The tracking runbook is in [`../docs/operations/mysql-cutover.md`](../docs/operations/mysql-cutover.md).

## State Crawler Validation

From the repository root, run live adapter validation without writing to the local database:

```bash
PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live --limit 3 --timeout 20
```

Use repeated `--source <source_id>` flags to validate a subset, for example:

```bash
PYTHONPATH=crawler python3 -m apsi_crawler.cli validate-state-live \
  --source pa_state_procurement \
  --source ma_state_procurement \
  --source nj_state_procurement \
  --source or_state_procurement \
  --source va_state_procurement \
  --source wa_state_procurement \
  --source ia_state_procurement \
  --source ga_state_procurement \
  --source me_state_procurement \
  --source mo_state_procurement \
  --source nv_state_procurement \
  --source ut_state_procurement \
  --source ks_state_procurement \
  --source mt_state_procurement \
  --source nm_state_procurement \
  --source co_state_procurement \
  --source in_state_procurement \
  --source ms_state_procurement \
  --source ct_state_procurement \
  --source ok_state_procurement \
  --source ar_state_procurement \
  --source sd_state_procurement \
  --source wv_state_procurement \
  --source wy_state_procurement \
  --source al_state_procurement \
  --source ak_state_procurement \
  --source hi_state_procurement \
  --source ky_state_procurement \
  --source mn_state_procurement \
  --source wi_state_procurement \
  --source nh_state_procurement \
  --source de_state_procurement \
  --source ri_state_procurement \
  --source tn_state_procurement \
  --source az_state_procurement \
  --source id_state_procurement \
  --source la_state_procurement \
  --source md_state_procurement \
  --source mi_state_procurement \
  --source ne_state_procurement \
  --source nc_state_procurement \
  --source nd_state_procurement \
  --source oh_state_procurement \
  --source sc_state_procurement \
  --source vt_state_procurement \
  --limit 3 \
  --timeout 20
```

The command fails if a crawler returns zero opportunities or records missing required content. Current local live validation has all 50 state crawler sources reachable through verified or beta dedicated adapters. MI/SC/OH currently use public BidNet fallback pages because the official/default routes are 404, timeout, or browser-check blocked from the local environment.

To run an operator-only live source health probe against registry base URLs, use:

```bash
npm run source:health:check -- --report-only
```

Check a subset with either state codes or source ids:

```bash
npm run source:health:check -- --source CA --source tx_esbd --timeout-ms 5000 --report-only
```

Persist the latest probe for the Admin Data Sources table:

```bash
npm run source:health:check -- --source CA --timeout-ms 5000 --report-only --persist
```

When `DATABASE_URL` or `MYSQL_DATABASE_URL` is MySQL, `--persist` writes the snapshot to MySQL so the running Admin UI reads the same source-health data; otherwise it writes to local SQLite.

For release checks, add `--inspect-body` so successful pages are also checked for empty bodies, login pages, CAPTCHA, or bot-check content:

```bash
npm run source:health:check -- --all --timeout-ms 10000 --report-only --persist --inspect-body
```

This command performs live HTTP checks and may report blocked/403/timeout statuses for otherwise valid public portals. It is intentionally separate from `risk:check` so normal local/CI verification stays deterministic. Use the output as an operations signal alongside crawler non-empty results, source-validity metadata, bid detail routes, and local attachment download checks.

After a live probe has been persisted, generate the handoff evidence bundle:

```bash
npm run source:health:evidence -- --allow-blocked
npm run source:health:evidence -- --format=json --output=../ops-evidence/source-health-evidence.json
```

The evidence bundle reads the latest persisted snapshot from the current shell runtime, does not call public portals, includes safe source URLs with query strings/fragments stripped for high-priority follow-up rows, and blocks release signoff when unhealthy sources lack owner, disposition, or next-review date.

If the bundle is blocked only by missing owner/disposition/next-review values, generate and apply a bulk triage plan:

```bash
npm run source:health:triage -- --owner=source-ops@example.com
npm run source:health:triage -- --owner=source-ops@example.com --apply
```

To turn access-blocked live source findings into a handoff queue for browser/vendor-account or production-network review, generate the access review packet:

```bash
npm run source:health:access-review
npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json
```

This reads the latest persisted source-health snapshot and triage fields, groups unhealthy sources by required operator review mode, includes sanitized source URLs, and lists the evidence needed for the next manual or production-network verification step. It does not call external portals or store credentials.

## Notification Worker

The notification worker schedules staged billing dunning reminders and delivers pending notification outbox rows.

Run once:

```bash
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
```

Validate worker environment without opening the database:

```bash
npm run worker:notifications:check
```

Run continuously:

```bash
npm run worker:notifications
```

Useful worker environment variables:

```bash
NOTIFICATION_WORKER_INTERVAL_MS=900000
NOTIFICATION_WORKER_DUNNING_LIMIT=100
NOTIFICATION_WORKER_DELIVERY_LIMIT=25
NOTIFICATION_WORKER_MAX_ATTEMPTS=3
NOTIFICATION_PROVIDER=file # file, console, or http
DATABASE_PATH=data/apsi.sqlite
```

## Local MVP Status

Latest local baseline on June 11, 2026:

- Production Artifact / Package Storage Lite is complete locally: strict S3 production posture preflight, artifact version records, replace API/client, Intent UI replacement controls, and artifact version display have landed.
- Response Package Review History + UI Polish Wave 1 is complete locally.
- Response package exports include append-only review events and Intent UI review timelines.
- `/search` has operational loading/error/empty/filter feedback and anonymous save login/register guidance.
- `/bids/[id]` has mobile-safe action, title, metadata, contact, attachment, and evidence-link wrapping.
- Verified commands: `npm test` (228 files / 1,131 tests), `npm run lint`, `npm run build`, `npm run db:migrate`, `.env.local` loaded `npm run db:mysql:migrate`, `.env.local` loaded `npm run db:mysql:smoke`, `.env.local` loaded `npm run workers:check`, `npm run demo:check`, `npm run demo:smoke -- --origin=http://localhost:3020`, `npm run risk:check`, `npm audit --omit=dev --audit-level=high`, and `git diff --check`.

Remaining top priorities:

1. Real AWS/S3 staging validation for Production Artifact / Package Storage.
2. Stripe Sandbox E2E with real test mode keys, webhook secret, and price ids.
3. Production worker/secrets/backup dry run.
4. Live source-health operations for real portal 403/timeout/bot-check triage.
5. Review governance deepening: approver display, policy thresholds, and review report export.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
