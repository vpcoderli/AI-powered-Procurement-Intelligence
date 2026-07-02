/**
 * Stripe LIVE-mode smoke test.
 *
 * DANGER: this script talks to the real Stripe account configured by
 * STRIPE_SECRET_KEY and, when run to completion by a human against real
 * live-mode credentials, creates one real chargeable Checkout Session that a
 * human must pay with a real card. It then verifies the webhook receipt and
 * issues a full refund plus subscription cancellation so no charge or active
 * subscription is left outstanding.
 *
 * This script intentionally will NOT run unless:
 *   1. STRIPE_SECRET_KEY starts with sk_live_ (see validateStripeLiveConfig).
 *   2. A human has explicitly confirmed via --i-understand-this-charges-a-real-card
 *      or an interactive y/N prompt.
 *
 * It is the live-mode counterpart of stripe-sandbox-e2e.ts. Do not add new
 * end-to-end orchestration logic here beyond what differs from the sandbox
 * script (live-only guardrails, real-money confirmation, and refund cleanup).
 */
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnvConfig } from "@next/env";
import Stripe from "stripe";
import type { AuthResponse, SessionResponse } from "../src/lib/api/auth";
import type {
  AccountSubscriptionResponse,
  CheckoutSessionResponse,
} from "../src/server/billing/subscriptions";
import {
  STRIPE_LIVE_CONFIRM_FLAG,
  assertStripeLiveConfirmed,
  extractStripeLiveSessionCookie,
  formatStripeLiveConfigSummary,
  isStripeLiveSubscriptionReady,
  isStripeLiveTierSyncReady,
  parseStripeLiveArgs,
  validateStripeLiveConfig,
  type StripeLiveConfig,
} from "../src/server/billing/stripe-live-verifier";

type JsonObject = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function endpoint(origin: string, pathname: string) {
  return new URL(pathname, origin).toString();
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: JsonObject = {};

  try {
    payload = text ? JSON.parse(text) as JsonObject : {};
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText || text.slice(0, 120)}`);
    }

    throw new Error(`Expected JSON response from ${response.url}`);
  }

  if (!response.ok) {
    const error = payload.error && typeof payload.error === "object" && "message" in payload.error
      ? String(payload.error.message)
      : response.statusText;
    throw new Error(`HTTP ${response.status}: ${error}`);
  }

  return payload as T;
}

async function apiGet<T>(origin: string, pathname: string, cookieHeader: string) {
  const response = await fetch(endpoint(origin, pathname), {
    headers: { cookie: cookieHeader },
  });

  return readJsonResponse<T>(response);
}

async function apiPost<T>(origin: string, pathname: string, cookieHeader: string, body?: JsonObject) {
  const response = await fetch(endpoint(origin, pathname), {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return readJsonResponse<T>(response);
}

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.();
  if (values?.length) return values;

  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

async function assertAppReachable(origin: string) {
  try {
    await fetch(origin, { method: "GET" });
  } catch (error) {
    throw new Error(
      `App is not reachable at ${origin}. Start the production (or production-like) deployment you intend to smoke test before running the live verifier.`,
      { cause: error },
    );
  }
}

async function createLiveSmokeAccount(origin: string) {
  const id = randomUUID().slice(0, 8);
  const email = `stripe-live-smoke-${Date.now()}-${id}@example.test`;
  const password = `StripeLiveSmoke-${id}!`;
  const response = await fetch(endpoint(origin, "/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      displayName: "Stripe Live Smoke Buyer",
    }),
  });
  const user = (await readJsonResponse<AuthResponse>(response)).user;
  const cookieHeader = extractStripeLiveSessionCookie(setCookieHeaders(response));

  return {
    email,
    userId: user.id,
    organizationId: user.workspace?.organizationId,
    cookieHeader,
  };
}

async function pollSubscriptionReady(config: StripeLiveConfig, cookieHeader: string) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  let lastError = "not checked";

  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      const data = await apiGet<AccountSubscriptionResponse>(config.origin, "/api/account/subscription", cookieHeader);
      const session = await apiGet<SessionResponse>(config.origin, "/api/auth/session", cookieHeader);

      if (
        isStripeLiveSubscriptionReady(data.subscription, config.tier) &&
        isStripeLiveTierSyncReady(session.user, config.tier)
      ) {
        return {
          subscription: data.subscription,
          tiers: {
            userTier: session.user?.tier ?? null,
            organizationTier: session.user?.workspace?.tier ?? null,
          },
        };
      }

      lastError = [
        `subscription status=${data.subscription.status}`,
        `source=${data.subscription.source}`,
        `subscriptionTier=${data.subscription.tier}`,
        `userTier=${session.user?.tier ?? "missing"}`,
        `organizationTier=${session.user?.workspace?.tier ?? "missing"}`,
      ].join(", ");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (Date.now() - lastLogAt > 15000) {
      console.log(`[poll] Waiting for Stripe webhook/local tier sync: ${lastError}`);
      lastLogAt = Date.now();
    }
    await sleep(2000);
  }

  throw new Error(`Timed out after ${config.timeoutMs}ms waiting for paid subscription state. Last state: ${lastError}`);
}

async function waitForOperatorPayment(checkoutUrl: string) {
  const rl = createInterface({ input, output });
  try {
    console.log("");
    console.log("================================================================");
    console.log("  LIVE MODE — this Checkout Session will charge a REAL card.");
    console.log(`  Checkout URL: ${checkoutUrl}`);
    console.log("  Use a real payment method you control and are prepared to have");
    console.log("  charged. This script issues a full refund and cancels the");
    console.log("  subscription immediately afterward, but the charge and refund");
    console.log("  will both be real Stripe live-mode events.");
    console.log("================================================================");
    console.log("");
    await rl.question("Complete Checkout with a real card, then press Enter to continue verification...");
  } finally {
    rl.close();
  }
}

async function confirmRealChargeInteractively() {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(
      `About to run a Stripe LIVE-mode smoke test that charges and refunds a real card.\n` +
        `Type "yes" to continue, anything else to abort: `,
    );
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

/** Retrieves the Checkout Session with the created subscription expanded. */
async function retrieveExpandedCheckoutSession(stripe: Stripe, providerSessionId: string) {
  return stripe.checkout.sessions.retrieve(providerSessionId, {
    expand: ["subscription"],
  });
}

function extractSubscriptionId(session: Stripe.Checkout.Session) {
  const subscription = session.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

function extractLatestInvoiceId(session: Stripe.Checkout.Session) {
  const subscription = session.subscription;
  if (!subscription || typeof subscription === "string") return null;

  const latestInvoice = subscription.latest_invoice;
  if (!latestInvoice) return null;
  return typeof latestInvoice === "string" ? latestInvoice : latestInvoice.id;
}

/**
 * Resolves the PaymentIntent id that actually moved money for this invoice.
 * Modern Stripe API versions (2025+, matching this SDK) no longer expose
 * invoice.payment_intent directly; the InvoicePayments resource is the
 * supported way to find the payment_intent tied to an invoice.
 */
async function resolvePaymentIntentIdForInvoice(stripe: Stripe, invoiceId: string) {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 1 });
  const payment = payments.data[0]?.payment;
  if (!payment?.payment_intent) return null;

  return typeof payment.payment_intent === "string" ? payment.payment_intent : payment.payment_intent.id;
}

async function refundAndCancelLiveCharge(stripe: Stripe, providerSessionId: string) {
  console.log("Retrieving live Checkout Session to locate the real charge for cleanup...");
  const session = await retrieveExpandedCheckoutSession(stripe, providerSessionId);

  const subscriptionId = extractSubscriptionId(session);

  if (!subscriptionId) {
    throw new Error(
      `Could not resolve a Stripe subscription id from Checkout Session ${providerSessionId}; ` +
        `refusing to continue without confirming what needs to be cancelled/refunded. ` +
        `Check the Stripe Dashboard manually for this session.`,
    );
  }

  const invoiceId = extractLatestInvoiceId(session);
  const paymentIntentId = invoiceId ? await resolvePaymentIntentIdForInvoice(stripe, invoiceId) : null;

  if (!paymentIntentId) {
    console.warn(
      `Warning: could not resolve a payment_intent for Checkout Session ${providerSessionId} ` +
        `(invoice=${invoiceId ?? "none"}). The subscription will still be cancelled, but no automatic ` +
        `refund can be issued by this script. Check the Stripe Dashboard and refund manually if a charge exists.`,
    );
  } else {
    console.log(`Issuing full refund for payment_intent=${paymentIntentId}...`);
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: "requested_by_customer",
    });
    console.log(`Refund created: id=${refund.id}, status=${refund.status}, amount=${refund.amount}`);
  }

  console.log(`Cancelling live subscription immediately: subscription=${subscriptionId}...`);
  const cancelled = await stripe.subscriptions.cancel(subscriptionId);
  console.log(`Subscription cancelled: id=${cancelled.id}, status=${cancelled.status}`);

  return { subscriptionId, paymentIntentId };
}

async function main() {
  loadEnvConfig(process.cwd());
  const args = parseStripeLiveArgs(process.argv.slice(2));
  const config = validateStripeLiveConfig(process.env, args);

  let confirmedInteractively = false;
  if (!args.confirmed) {
    confirmedInteractively = await confirmRealChargeInteractively();
  }
  assertStripeLiveConfirmed(args.confirmed, confirmedInteractively);

  console.log("Stripe LIVE smoke test config:");
  console.log(formatStripeLiveConfigSummary(config));
  console.log("");
  console.log(`Confirmation source: ${args.confirmed ? `flag (${STRIPE_LIVE_CONFIRM_FLAG})` : "interactive prompt"}`);

  await assertAppReachable(config.origin);

  const secretKey = process.env.STRIPE_SECRET_KEY!.trim();
  const stripe = new Stripe(secretKey);

  const account = await createLiveSmokeAccount(config.origin);
  console.log(`Created live smoke account through app API: ${account.email}`);
  console.log(`User id: ${account.userId}`);
  console.log(`Organization id: ${account.organizationId ?? "not found"}`);

  const checkout = await apiPost<CheckoutSessionResponse>(
    config.origin,
    "/api/account/subscription/checkout",
    account.cookieHeader,
    { tier: config.tier },
  );
  console.log(`Checkout session id: ${checkout.checkoutSession.providerSessionId}`);
  console.log(`Checkout URL: ${checkout.checkoutSession.checkoutUrl}`);

  await waitForOperatorPayment(checkout.checkoutSession.checkoutUrl);

  let cleanupError: unknown = null;
  try {
    const paid = await pollSubscriptionReady(config, account.cookieHeader);
    console.log(`Verified paid subscription: tier=${paid.subscription.tier}, status=${paid.subscription.status}`);
    console.log(`Verified local tier sync: user=${paid.tiers.userTier}, organization=${paid.tiers.organizationTier}`);
    console.log("Webhook receipt confirmed: local subscription state reflects the live Stripe event.");
  } catch (error) {
    cleanupError = error;
    console.error("Failed to confirm webhook receipt / paid subscription state before cleanup:");
    console.error(error instanceof Error ? error.message : error);
  }

  console.log("");
  console.log("Running cleanup (refund + cancellation) regardless of verification outcome above...");
  const cleanup = await refundAndCancelLiveCharge(stripe, checkout.checkoutSession.providerSessionId);
  console.log(`Cleanup complete: subscriptionId=${cleanup.subscriptionId}, paymentIntentId=${cleanup.paymentIntentId ?? "none"}`);
  console.log("");
  console.log("IMPORTANT: confirm in the Stripe Dashboard (live mode) that:");
  console.log("  1. The refund shows as succeeded against the real card used.");
  console.log("  2. The subscription shows as canceled.");
  console.log("  3. No further invoices are scheduled for this test customer.");
  console.log("Save a screenshot or the Stripe event log as evidence per docs/operations/stripe-live-launch-checklist.md.");

  if (cleanupError) {
    throw cleanupError instanceof Error
      ? cleanupError
      : new Error(String(cleanupError));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
