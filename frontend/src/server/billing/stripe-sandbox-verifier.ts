export type StripeSandboxTier = "pro" | "business";

export interface StripeSandboxArgs {
  tier: string;
  origin: string;
  skipCancel: boolean;
  timeoutMs: number;
}

export interface StripeSandboxConfig {
  tier: StripeSandboxTier;
  origin: string;
  skipCancel: boolean;
  timeoutMs: number;
  priceIds: Record<StripeSandboxTier, string>;
  configuredEnv: {
    BILLING_PROVIDER: "stripe";
    STRIPE_SECRET_KEY: true;
    STRIPE_WEBHOOK_SECRET: true;
    STRIPE_PRICE_PRO_MONTHLY: true;
    STRIPE_PRICE_BUSINESS_MONTHLY: true;
  };
}

export interface StripeSandboxSubscriptionLike {
  tier?: string | null;
  status?: string | null;
  source?: string | null;
  cancelAtPeriodEnd?: boolean | number | null;
}

type StripeSandboxEnv = Record<string, string | undefined>;

const paidReadyStatuses = new Set(["active", "trialing", "past_due"]);

export function parseStripeSandboxArgs(argv: string[]): StripeSandboxArgs {
  const args: StripeSandboxArgs = {
    tier: "pro",
    origin: "http://localhost:3000",
    skipCancel: false,
    timeoutMs: 300000,
  };

  for (const arg of argv) {
    if (arg === "--skip-cancel") {
      args.skipCancel = true;
      continue;
    }

    const [key, value] = arg.split("=", 2);
    if (key === "--tier" && value) args.tier = value;
    if (key === "--origin" && value) args.origin = value;
    if (key === "--timeout-ms" && value) args.timeoutMs = Number(value);
  }

  return args;
}

export function validateStripeSandboxConfig(
  env: StripeSandboxEnv,
  args: Partial<StripeSandboxArgs> = {},
): StripeSandboxConfig {
  const parsedArgs = { ...parseStripeSandboxArgs([]), ...args };
  const missing = [
    "BILLING_PROVIDER",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
  ].filter((key) => !env[key]?.trim());

  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (env.BILLING_PROVIDER && env.BILLING_PROVIDER.toLowerCase() !== "stripe") {
    errors.push("BILLING_PROVIDER must be stripe");
  }

  if (env.STRIPE_SECRET_KEY && !env.STRIPE_SECRET_KEY.startsWith("sk_test_")) {
    errors.push("STRIPE_SECRET_KEY must be a Stripe test mode secret key");
  }

  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    errors.push("STRIPE_WEBHOOK_SECRET must start with whsec_");
  }

  for (const key of ["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_BUSINESS_MONTHLY"]) {
    if (env[key] && !env[key].startsWith("price_")) {
      errors.push(`${key} must be a Stripe price id`);
    }
  }

  if (parsedArgs.tier !== "pro" && parsedArgs.tier !== "business") {
    errors.push("tier must be pro or business");
  }

  try {
    const origin = new URL(parsedArgs.origin);
    if (!["http:", "https:"].includes(origin.protocol)) {
      errors.push("origin must be an http or https URL");
    }
  } catch {
    errors.push("origin must be a valid URL");
  }

  if (!Number.isInteger(parsedArgs.timeoutMs) || parsedArgs.timeoutMs <= 0) {
    errors.push("timeout-ms must be a positive integer");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    tier: parsedArgs.tier as StripeSandboxTier,
    origin: parsedArgs.origin,
    skipCancel: parsedArgs.skipCancel,
    timeoutMs: parsedArgs.timeoutMs,
    priceIds: {
      pro: env.STRIPE_PRICE_PRO_MONTHLY!,
      business: env.STRIPE_PRICE_BUSINESS_MONTHLY!,
    },
    configuredEnv: {
      BILLING_PROVIDER: "stripe",
      STRIPE_SECRET_KEY: true,
      STRIPE_WEBHOOK_SECRET: true,
      STRIPE_PRICE_PRO_MONTHLY: true,
      STRIPE_PRICE_BUSINESS_MONTHLY: true,
    },
  };
}

export function formatStripeSandboxConfigSummary(config: StripeSandboxConfig) {
  return [
    `tier=${config.tier}`,
    `origin=${config.origin}`,
    `timeoutMs=${config.timeoutMs}`,
    `skipCancel=${config.skipCancel}`,
    "BILLING_PROVIDER=stripe",
    "STRIPE_SECRET_KEY=configured",
    "STRIPE_WEBHOOK_SECRET=configured",
    "STRIPE_PRICE_PRO_MONTHLY=configured",
    "STRIPE_PRICE_BUSINESS_MONTHLY=configured",
  ].join("\n");
}

export function isStripeSandboxSubscriptionReady(
  subscription: StripeSandboxSubscriptionLike | null | undefined,
  expectedTier: StripeSandboxTier,
) {
  return (
    subscription?.tier === expectedTier &&
    subscription.source === "billing_provider" &&
    paidReadyStatuses.has(subscription.status ?? "")
  );
}

export function isStripeSandboxCancelReady(subscription: StripeSandboxSubscriptionLike | null | undefined) {
  return subscription?.status === "canceled" || subscription?.cancelAtPeriodEnd === true || subscription?.cancelAtPeriodEnd === 1;
}
