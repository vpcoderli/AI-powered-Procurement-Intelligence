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

Production billing deployment, live/test key isolation, webhook rotation, worker scheduling, and provider dashboard checks are covered in [`../docs/operations/production-billing-worker-runbook.md`](../docs/operations/production-billing-worker-runbook.md).

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

The database keeps the intent/bid association, artifact type, purpose, expiry date, review status, file metadata, checksum, and internal download route. Do not commit uploaded files or copy local storage paths into production configuration. Production hardening still needs object storage, malware scanning, retention rules, audit events, and delete/version workflows.

## Quote Workspace

Business-tier users can manage a lightweight quote workflow from an Intent detail page. The local v1 stores organization-scoped sourcing partners, intent-level quote requests, requested due dates, status, quoted amount, response notes, and links to uploaded supplier artifacts.

The Quote Workspace is manual-first: it does not send supplier emails, expose a supplier portal, or parse quote attachments automatically. Future depth should add richer notification/audit integration, response uploads, comparison scoring, and richer supplier profiles.

## Deadline Notifications

Business-tier users can view deadline reminders from an Intent detail page. Local v1 stores reminders in `deadline_reminders` and derives them idempotently from bid deadlines, response workspace task due dates, quote request due dates, and supplier artifact expiry dates.

Users can acknowledge reminders or snooze them for 24 hours from the Intent panel. This is a local workflow surface only: production email/calendar delivery, notification outbox scheduling, digest preferences, submission checkpoint reminders, audit events, Settings reminder center, and the MySQL deadline adapter remain future depth.

## Response Workspace Collaboration

Business-tier users can coordinate response workspace items from an Intent detail page. Local v1 stores task/checkpoint/artifact/outline items in `response_workspace_items`, supports owner assignment through `assigned_user_id`, and stores item-level notes in `response_workspace_comments`.

The current collaboration slice is manual-first: users can update item status/notes, assign owners from visible workspace members, and add comments. Future depth should add activity/version history, artifact-task links, reusable package outlines, richer team directory selection, audit events, and eventual drafting automation.

## MySQL Runtime And Migration

SQLite remains the default local runtime when no MySQL URL is configured. When `DATABASE_URL` or `MYSQL_DATABASE_URL` points to MySQL, the main product/runtime paths use the MySQL adapters and the migration tooling below:

```bash
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:migrate
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:import-sqlite
DATABASE_URL=mysql://USER:PASSWORD@HOST:3306/winbids npm run db:mysql:smoke
```

This migration path has been smoke-tested against MySQL 8 with a fresh schema, an idempotent re-run, a long bid-description insert, repeatable SQLite-to-MySQL data import, crawler/admin reads, direct JSON crawler import/upsert, crawler control locks/source enablement, crawler alert matching/digest notification, event outbox delivery, bid search/detail, saved bids, attachment metadata, auth/account/workspace/admin-users/admin-config/admin-bid-QA/billing/dunning, search alerts/notifications, and the core intent panels for compliance, submission, response workspace, pursuit decision, and qualification evidence. The `db:mysql:smoke` command redacts credentials in logs. Indexed text columns are converted to `VARCHAR(191)`, while long content columns are preserved as `LONGTEXT`.

The remaining production signoff items are Stripe sandbox verification in MySQL mode, production worker deployment dry runs, and final credential/runbook execution. The tracking runbook is in [`../docs/operations/mysql-cutover.md`](../docs/operations/mysql-cutover.md).

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

This command performs live HTTP checks and may report blocked/403/timeout statuses for otherwise valid public portals. It is intentionally separate from `risk:check` so normal local/CI verification stays deterministic. Use the output as an operations signal alongside crawler non-empty results, source-validity metadata, bid detail routes, and local attachment download checks.

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
