# Stripe Live Launch Checklist

Updated: 2026-07-01

This is a human-executable pre-launch checklist for turning on real Stripe billing. It complements two existing documents and does not replace them:

- `docs/operations/stripe-sandbox-e2e.md` — Stripe **test mode** end-to-end verification (run this first, repeatedly, during development).
- `docs/operations/production-billing-worker-runbook.md` — the full production billing/worker deployment runbook, including webhook rotation and the `npm run billing:production:check` / `npm run ops:production:check` preflight commands.

Use this checklist exactly once per environment cutover (initial launch, and again any time the live Stripe account, webhook endpoint, or price catalog changes materially). Every item here requires a human to actually do something in the Stripe Dashboard or in production; none of it can be completed by an agent, and none of it should be attempted from a local development machine against real customer cards.

**Do not run `frontend/scripts/stripe-live-smoke.ts` from an unattended session, CI, or an agent.** It charges and refunds a real card on a live Stripe account. It requires a human to hold the confirmation prompt (or explicitly pass `--i-understand-this-charges-a-real-card`) and to physically enter real card details in the browser during the run.

## 0. Preconditions

- [ ] `npm run billing:production:check` passes in the production deployment environment (`NODE_ENV=production`), confirming `STRIPE_SECRET_KEY` is `sk_live_...`, `STRIPE_WEBHOOK_SECRET` is set, and both price IDs are configured. See `docs/operations/production-billing-worker-runbook.md`.
- [ ] `npm run ops:production:check` passes, confirming billing + worker + backup ownership variables are all set.
- [ ] Production database is MySQL (`DATABASE_URL` resolves to `mysql://` or `mysql2://`), not SQLite.
- [ ] The person running this checklist has Stripe Dashboard access to the **live** account (not just test mode) and is authorized to make a real purchase and issue a refund on the company's behalf.

## 1. Stripe Dashboard — Live Mode Setup

- [ ] Toggle **Live mode** in the Stripe Dashboard (top right). Everything below happens in live mode, not test mode.
- [ ] Confirm the Pro product and its monthly recurring price exist in live mode; copy the live `price_...` id.
- [ ] Confirm the Business product and its monthly recurring price exist in live mode; copy the live `price_...` id.
- [ ] Confirm these live price IDs match `STRIPE_PRICE_PRO_MONTHLY` and `STRIPE_PRICE_BUSINESS_MONTHLY` in the production environment. Do not reuse test-mode price IDs.
- [ ] Confirm the Billing Customer Portal is configured in live mode and allows customers to view subscriptions and cancel/update payment methods (Settings → Billing → Customer portal).
- [ ] Confirm Checkout is configured to collect customer email.
- [ ] Confirm payment failure/retry (dunning) behavior is configured under Settings → Billing → Subscriptions and emails.

## 2. Webhook Endpoint — Live Mode

- [ ] Create (or confirm existing) a live-mode webhook endpoint pointing at `https://<production-host>/api/billing/webhook`.
- [ ] Confirm the event list matches `docs/operations/production-billing-worker-runbook.md`:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- [ ] Copy the live endpoint's signing secret (`whsec_...`) into the production environment as `STRIPE_WEBHOOK_SECRET`. This must be the **live** endpoint's secret, never a test-mode or Stripe CLI secret.
- [ ] Redeploy or restart the production app process so the new `STRIPE_WEBHOOK_SECRET` is loaded.
- [ ] Confirm there is exactly one active live webhook endpoint for `/api/billing/webhook` (no stale/duplicate endpoints left enabled from prior rotations).

## 3. Run the Live Smoke Test (human-executed, real card)

This step is a deliberate one-time human action. It must be run interactively by a person, from a machine with access to a real payment method, against the production (or a production-equivalent staging-with-live-keys) deployment.

- [ ] Set `STRIPE_SECRET_KEY` to the live secret key (`sk_live_...`) and the other required env vars (`BILLING_PROVIDER=stripe`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_BUSINESS_MONTHLY`) in the shell that will run the script — not committed to any file.
- [ ] From `frontend/`, run:
  ```bash
  npm run billing:stripe:live-smoke -- --tier=pro --origin=https://<production-host>
  ```
  Omit `--i-understand-this-charges-a-real-card` to get the interactive `yes` confirmation prompt, or pass it explicitly if running in a terminal where an interactive prompt is inconvenient (still requires a human at the keyboard to have typed the flag deliberately).
- [ ] When the script prints the Checkout URL, open it and complete payment with a real card you are authorized to charge.
- [ ] Confirm the script reports:
  - Webhook receipt confirmed (local subscription state synced to `billing_provider` / paid status).
  - A refund created with `status=succeeded` (or `pending`, followed by manual confirmation it settles).
  - The subscription cancelled immediately.
- [ ] If the script reports it could not resolve a `payment_intent` for automatic refund, or any other cleanup warning, manually refund the charge and cancel the subscription in the Stripe Dashboard before proceeding, and treat this as a blocker to investigate, not something to ignore.
- [ ] In the Stripe Dashboard (live mode), independently confirm:
  - The refund appears against the correct charge and shows `succeeded`.
  - The subscription shows `canceled`.
  - No further invoices are scheduled for the test customer created by the script (email starts with `stripe-live-smoke-`).
- [ ] Delete or archive the test customer created by the script once verification is complete.

## 4. Evidence

- [ ] Save the full terminal output of the live smoke test run (redact nothing except the raw secret key values, which the script never prints).
- [ ] Save a screenshot of the Stripe Dashboard (live mode) showing: the succeeded charge, the succeeded refund, and the canceled subscription for the test customer.
- [ ] Save a screenshot of the live webhook endpoint's recent deliveries showing `2xx` responses for the events triggered by this test.
- [ ] Store both the terminal log and screenshots in the team's launch evidence location (e.g. the production launch ticket or `docs/operations/` evidence links referenced by `PRODUCTION_BACKUP_EVIDENCE_URL`-style variables) with a timestamp and the name of the person who ran the test.
- [ ] Record the date, operator name, and Stripe live-mode charge/refund IDs in the launch sign-off notes.

## 5. Invoice and Receipt Email Delivery

- [ ] Confirm Stripe is configured to email a receipt/invoice for the live smoke test charge (Settings → Customer emails → email customers about successful payments).
- [ ] Confirm the receipt email actually arrived at the address used during the smoke test (or at a monitored inbox if using a real personal card with a real email).
- [ ] Confirm the refund confirmation email (if enabled) also arrived.
- [ ] Confirm invoice PDFs are reachable from the links stored in the app (`/api/account/billing/invoices` or equivalent) for the smoke-test subscription before it was cancelled, if the product surfaces invoice history to users.
- [ ] If email delivery failed or was delayed, treat this as a launch blocker and investigate sender domain / SPF / DKIM / DMARC configuration per `docs/operations/production-billing-worker-runbook.md` before continuing.

## 6. Final Sign-off

- [ ] All sections above are checked.
- [ ] `npm run billing:production:check` and `npm run ops:production:check` both still pass after any configuration changes made while working through this checklist.
- [ ] No test-mode (`sk_test_...`) keys remain anywhere in the production environment configuration.
- [ ] No live-mode (`sk_live_...`) keys have been committed to source control, `.env.local`, or shared with the sandbox verifier.
- [ ] A named human has signed off with date and Stripe live charge/refund IDs as evidence.

## Related Documents

- `docs/operations/stripe-sandbox-e2e.md` — test-mode end-to-end verification runbook.
- `docs/operations/production-billing-worker-runbook.md` — full production billing and worker deployment runbook, webhook rotation procedure, and release smoke test sequence.
- `frontend/scripts/stripe-live-smoke.ts` — the live-mode smoke test script referenced in Section 3.
- `frontend/scripts/stripe-sandbox-e2e.ts` — the test-mode equivalent script; do not run it with live keys (it refuses `sk_live_...` keys).
