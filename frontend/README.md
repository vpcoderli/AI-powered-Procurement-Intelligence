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
  --limit 3 \
  --timeout 20
```

The command fails if a crawler returns zero opportunities or records missing required content. Current local live validation has PA/MA/NJ/OR/VA/WA plus IA/GA/ME/MO/NV and UT/KS/MT/NM/CO/IN/MS/CT returning non-empty results; SC times out from this environment and OH requires a new OhioBuys browser/session strategy.

## Notification Worker

The notification worker schedules staged billing dunning reminders and delivers pending notification outbox rows.

Run once:

```bash
NOTIFICATION_WORKER_RUN_ONCE=1 npm run worker:notifications
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
