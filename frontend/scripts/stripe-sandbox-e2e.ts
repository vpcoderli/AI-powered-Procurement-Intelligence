import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { and, eq } from "drizzle-orm";
import { loadEnvConfig } from "@next/env";
import { registerUser } from "../src/server/auth/service";
import { createSessionCookie } from "../src/server/auth/session";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { runMigrations } from "../src/server/db/migrate";
import { organizationMemberships, organizations, users } from "../src/server/db/schema";
import type {
  AccountSubscriptionResponse,
  CheckoutSessionResponse,
  CustomerPortalSessionResponse,
} from "../src/server/billing/subscriptions";
import {
  formatStripeSandboxConfigSummary,
  isStripeSandboxCancelReady,
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

async function createSandboxAccount(db: AppDatabase) {
  const id = randomUUID().slice(0, 8);
  const email = `stripe-sandbox-${Date.now()}-${id}@example.test`;
  const password = `StripeSandbox-${id}!`;
  const result = await registerUser(db, {
    email,
    password,
    displayName: "Stripe Sandbox Buyer",
  });

  return {
    email,
    userId: result.user.id,
    organizationId: result.user.workspace?.organizationId,
    cookieHeader: createSessionCookie(result.sessionToken).split(";")[0],
  };
}

function tierRows(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  const membership = db
    .select({
      organizationId: organizationMemberships.organizationId,
      accountTier: organizations.accountTier,
    })
    .from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "active")))
    .limit(1)
    .get();

  return {
    userTier: user?.accountTier ?? null,
    organizationId: membership?.organizationId ?? null,
    organizationTier: membership?.accountTier ?? null,
  };
}

function assertTierSync(db: AppDatabase, userId: string, tier: StripeSandboxConfig["tier"]) {
  const rows = tierRows(db, userId);

  if (rows.userTier !== tier || rows.organizationTier !== tier) {
    throw new Error(
      `Waiting for local tier sync: user=${rows.userTier ?? "missing"}, organization=${rows.organizationTier ?? "missing"}`,
    );
  }

  return rows;
}

async function pollSubscriptionReady(db: AppDatabase, config: StripeSandboxConfig, userId: string, cookieHeader: string) {
  const startedAt = Date.now();
  let lastLogAt = 0;
  let lastError = "not checked";

  while (Date.now() - startedAt < config.timeoutMs) {
    try {
      const data = await apiGet<AccountSubscriptionResponse>(config.origin, "/api/account/subscription", cookieHeader);
      const tiers = assertTierSync(db, userId, config.tier);

      if (isStripeSandboxSubscriptionReady(data.subscription, config.tier)) {
        return { subscription: data.subscription, tiers };
      }

      lastError = `subscription status=${data.subscription.status}, source=${data.subscription.source}, tier=${data.subscription.tier}`;
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

  const db = createDatabase();
  runMigrations(db);

  try {
    const account = await createSandboxAccount(db);
    console.log(`Created sandbox account: ${account.email}`);
    console.log(`User id: ${account.userId}`);
    console.log(`Organization id: ${account.organizationId ?? tierRows(db, account.userId).organizationId ?? "not found"}`);

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

    const paid = await pollSubscriptionReady(db, config, account.userId, account.cookieHeader);
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
  } finally {
    db.$client.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
