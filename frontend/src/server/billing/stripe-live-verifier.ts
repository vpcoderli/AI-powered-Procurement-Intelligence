export type StripeLiveTier = "pro" | "business";

export interface StripeLiveArgs {
  tier: string;
  origin: string;
  timeoutMs: number;
  confirmed: boolean;
}

export interface StripeLiveConfig {
  tier: StripeLiveTier;
  origin: string;
  timeoutMs: number;
  priceIds: Record<StripeLiveTier, string>;
  configuredEnv: {
    BILLING_PROVIDER: "stripe";
    STRIPE_SECRET_KEY: true;
    STRIPE_WEBHOOK_SECRET: true;
    STRIPE_PRICE_PRO_MONTHLY: true;
    STRIPE_PRICE_BUSINESS_MONTHLY: true;
  };
}

export interface StripeLiveSubscriptionLike {
  tier?: string | null;
  status?: string | null;
  source?: string | null;
  cancelAtPeriodEnd?: boolean | number | null;
}

export interface StripeLiveSessionUserLike {
  tier?: string | null;
  workspace?: {
    tier?: string | null;
  } | null;
}

type StripeLiveEnv = Record<string, string | undefined>;

const paidReadyStatuses = new Set(["active", "trialing", "past_due"]);
const sessionCookieName = "apsi_session";

const CONFIRM_FLAG = "--i-understand-this-charges-a-real-card";

function isPlaceholderValue(raw: string) {
  const value = raw.toLowerCase();
  return value.includes("replace_me") || value.includes("placeholder") || value.endsWith("_...");
}

export function parseStripeLiveArgs(argv: string[]): StripeLiveArgs {
  const args: StripeLiveArgs = {
    tier: "pro",
    origin: "http://localhost:3000",
    timeoutMs: 300000,
    confirmed: false,
  };

  for (const arg of argv) {
    if (arg === CONFIRM_FLAG) {
      args.confirmed = true;
      continue;
    }

    const [key, value] = arg.split("=", 2);
    if (key === "--tier" && value) args.tier = value;
    if (key === "--origin" && value) args.origin = value;
    if (key === "--timeout-ms" && value) args.timeoutMs = Number(value);
  }

  return args;
}

/**
 * This is the live-mode counterpart of validateStripeSandboxConfig. It requires
 * STRIPE_SECRET_KEY to start with sk_live_ and refuses sk_test_ keys outright, the
 * mirror image of the sandbox verifier's refusal of sk_live_ keys. Keeping both
 * checks explicit (rather than "not sk_test_") means a malformed or unknown-prefix
 * key fails closed in both directions instead of silently passing one of them.
 */
export function validateStripeLiveConfig(
  env: StripeLiveEnv,
  args: Partial<StripeLiveArgs> = {},
): StripeLiveConfig {
  const parsedArgs = { ...parseStripeLiveArgs([]), ...args };
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

  const secretKey = env.STRIPE_SECRET_KEY ?? "";
  if (secretKey && secretKey.startsWith("sk_test_")) {
    errors.push("STRIPE_SECRET_KEY is a Stripe test mode key; refusing to run the live smoke test with sk_test_. Use a sk_live_ key or run npm run billing:stripe:sandbox instead.");
  } else if (secretKey && !secretKey.startsWith("sk_live_")) {
    errors.push("STRIPE_SECRET_KEY must be a Stripe live mode secret key (sk_live_...)");
  }
  if (secretKey && isPlaceholderValue(secretKey)) {
    errors.push("STRIPE_SECRET_KEY must not use a placeholder value");
  }

  if (env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_WEBHOOK_SECRET.startsWith("whsec_")) {
    errors.push("STRIPE_WEBHOOK_SECRET must start with whsec_");
  }
  if (env.STRIPE_WEBHOOK_SECRET && isPlaceholderValue(env.STRIPE_WEBHOOK_SECRET)) {
    errors.push("STRIPE_WEBHOOK_SECRET must not use a placeholder value");
  }

  for (const key of ["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_BUSINESS_MONTHLY"]) {
    if (env[key] && !env[key].startsWith("price_")) {
      errors.push(`${key} must be a Stripe price id`);
    }
    if (env[key] && isPlaceholderValue(env[key])) {
      errors.push(`${key} must not use a placeholder value`);
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
    tier: parsedArgs.tier as StripeLiveTier,
    origin: parsedArgs.origin,
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

/**
 * Separate from validateStripeLiveConfig so the "did a human actually confirm this"
 * gate is enforced even if a caller only checks config validity. Requires either the
 * CLI flag or an explicit interactive confirmation to have been recorded.
 */
export function assertStripeLiveConfirmed(confirmedByFlag: boolean, confirmedInteractively: boolean) {
  if (!confirmedByFlag && !confirmedInteractively) {
    throw new Error(
      `Refusing to run: this script charges and refunds a real card on a live Stripe account. ` +
        `Re-run with ${CONFIRM_FLAG} or confirm the interactive prompt.`,
    );
  }
}

export function formatStripeLiveConfigSummary(config: StripeLiveConfig) {
  return [
    `tier=${config.tier}`,
    `origin=${config.origin}`,
    `timeoutMs=${config.timeoutMs}`,
    "BILLING_PROVIDER=stripe",
    "STRIPE_SECRET_KEY=configured(live)",
    "STRIPE_WEBHOOK_SECRET=configured",
    "STRIPE_PRICE_PRO_MONTHLY=configured",
    "STRIPE_PRICE_BUSINESS_MONTHLY=configured",
  ].join("\n");
}

export function isStripeLiveSubscriptionReady(
  subscription: StripeLiveSubscriptionLike | null | undefined,
  expectedTier: StripeLiveTier,
) {
  return (
    subscription?.tier === expectedTier &&
    subscription.source === "billing_provider" &&
    paidReadyStatuses.has(subscription.status ?? "")
  );
}

export function isStripeLiveTierSyncReady(
  user: StripeLiveSessionUserLike | null | undefined,
  expectedTier: StripeLiveTier,
) {
  return user?.tier === expectedTier && user.workspace?.tier === expectedTier;
}

export function extractStripeLiveSessionCookie(setCookieHeaders: string[]) {
  for (const header of setCookieHeaders) {
    const cookiePair = header.split(";", 1)[0] ?? "";
    if (cookiePair.startsWith(`${sessionCookieName}=`) && cookiePair.length > sessionCookieName.length + 1) {
      return cookiePair;
    }
  }

  throw new Error("Auth register response did not include a session cookie.");
}

export const STRIPE_LIVE_CONFIRM_FLAG = CONFIRM_FLAG;
