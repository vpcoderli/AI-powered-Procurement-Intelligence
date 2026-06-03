import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadEnvConfig } from "@next/env";
import type { AuthResponse, SessionResponse } from "../src/lib/api/auth";
import type {
  AccountSubscriptionResponse,
  CheckoutSessionResponse,
  CustomerPortalSessionResponse,
} from "../src/server/billing/subscriptions";
import {
  extractStripeSandboxSessionCookie,
  formatStripeSandboxConfigSummary,
  isStripeSandboxCancelReady,
  isStripeSandboxTierSyncReady,
  isStripeSandboxSubscriptionReady,
  parseStripeSandboxArgs,
  validateStripeSandboxConfig,
  type StripeSandboxConfig,
} from "../src/server/billing/stripe-sandbox-verifier";

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
      `Local app is not reachable at ${origin}. Start it with npm run dev before running the sandbox verifier.`,
      { cause: error },
    );
  }
}

async function createSandboxAccount(origin: string) {
  const id = randomUUID().slice(0, 8);
  const email = `stripe-sandbox-${Date.now()}-${id}@example.test`;
  const password = `StripeSandbox-${id}!`;
  const response = await fetch(endpoint(origin, "/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      displayName: "Stripe Sandbox Buyer",
    }),
  });
  const user = (await readJsonResponse<AuthResponse>(response)).user;
  const cookieHeader = extractStripeSandboxSessionCookie(setCookieHeaders(response));

  return {
    email,
    userId: user.id,
    organizationId: user.workspace?.organizationId,
    cookieHeader,
  };
}

async function pollSubscriptionReady(config: StripeSandboxConfig, cookieHeader: string) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  let lastError = "not checked";

  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      const data = await apiGet<AccountSubscriptionResponse>(config.origin, "/api/account/subscription", cookieHeader);
      const session = await apiGet<SessionResponse>(config.origin, "/api/auth/session", cookieHeader);

      if (
        isStripeSandboxSubscriptionReady(data.subscription, config.tier) &&
        isStripeSandboxTierSyncReady(session.user, config.tier)
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

async function pollCancelReady(config: StripeSandboxConfig, cookieHeader: string) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  let lastError = "not checked";

  while (Date.now() - startedAt < config.timeoutMs) {
    const data = await apiGet<AccountSubscriptionResponse>(config.origin, "/api/account/subscription", cookieHeader);

    if (isStripeSandboxCancelReady(data.subscription)) {
      return data.subscription;
    }

    lastError = `subscription status=${data.subscription.status}, cancelAtPeriodEnd=${data.subscription.cancelAtPeriodEnd}`;
    if (Date.now() - lastLogAt > 15000) {
      console.log(`[poll] Waiting for cancellation cleanup: ${lastError}`);
      lastLogAt = Date.now();
    }
    await sleep(2000);
  }

  throw new Error(`Timed out after ${config.timeoutMs}ms waiting for cancellation cleanup. Last state: ${lastError}`);
}

async function waitForOperator() {
  const rl = createInterface({ input, output });
  try {
    await rl.question("Complete Checkout in Stripe test mode, then press Enter to continue verification...");
  } finally {
    rl.close();
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const config = validateStripeSandboxConfig(process.env, parseStripeSandboxArgs(process.argv.slice(2)));
  console.log("Stripe sandbox verifier config:");
  console.log(formatStripeSandboxConfigSummary(config));

  await assertAppReachable(config.origin);

  const account = await createSandboxAccount(config.origin);
  console.log(`Created sandbox account through local API: ${account.email}`);
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
  console.log("Use Stripe test card 4242 4242 4242 4242, any future expiry, any CVC.");

  await waitForOperator();

  const paid = await pollSubscriptionReady(config, account.cookieHeader);
  console.log(`Verified paid subscription: tier=${paid.subscription.tier}, status=${paid.subscription.status}`);
  console.log(`Verified local tier sync: user=${paid.tiers.userTier}, organization=${paid.tiers.organizationTier}`);

  const portal = await apiPost<CustomerPortalSessionResponse>(
    config.origin,
    "/api/account/billing/portal",
    account.cookieHeader,
  );
  if (!portal.portalSession.portalUrl.includes("billing.stripe.com")) {
    throw new Error(`Unexpected portal URL host: ${portal.portalSession.portalUrl}`);
  }
  console.log(`Verified Stripe customer portal URL: ${portal.portalSession.portalUrl}`);

  if (config.skipCancel) {
    console.log("Skipping cancellation cleanup because --skip-cancel was provided.");
    return;
  }

  await apiPost<AccountSubscriptionResponse>(
    config.origin,
    "/api/account/subscription/cancel",
    account.cookieHeader,
  );
  const canceled = await pollCancelReady(config, account.cookieHeader);
  console.log(
    `Verified sandbox cleanup: status=${canceled.status}, cancelAtPeriodEnd=${canceled.cancelAtPeriodEnd}`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
