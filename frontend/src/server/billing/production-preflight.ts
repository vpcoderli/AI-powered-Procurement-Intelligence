type ProductionBillingEnv = Record<string, string | undefined>;

export interface ProductionBillingPreflightResult {
  ok: true;
  provider: "stripe";
  database: "mysql";
  stripeMode: "live";
  nodeEnv: string;
  warnings: string[];
  configured: {
    STRIPE_SECRET_KEY: true;
    STRIPE_WEBHOOK_SECRET: true;
    STRIPE_PRICE_PRO_MONTHLY: true;
    STRIPE_PRICE_BUSINESS_MONTHLY: true;
  };
}

const requiredKeys = [
  "BILLING_PROVIDER",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_PRO_MONTHLY",
  "STRIPE_PRICE_BUSINESS_MONTHLY",
] as const;

function value(env: ProductionBillingEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function isPlaceholder(raw: string) {
  return raw.includes("REPLACE_ME") || raw.includes("placeholder") || raw.endsWith("_...");
}

function hasMysqlUrl(env: ProductionBillingEnv) {
  const url = value(env, "DATABASE_URL") || value(env, "MYSQL_DATABASE_URL");
  return /^mysql2?:\/\//.test(url);
}

export function validateProductionBillingPreflight(
  env: ProductionBillingEnv = process.env,
): ProductionBillingPreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missing = requiredKeys.filter((key) => !value(env, key));
  if (missing.length > 0) {
    errors.push(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (value(env, "BILLING_PROVIDER") && value(env, "BILLING_PROVIDER").toLowerCase() !== "stripe") {
    errors.push("BILLING_PROVIDER must be stripe");
  }

  const secretKey = value(env, "STRIPE_SECRET_KEY");
  if (secretKey && !secretKey.startsWith("sk_live_")) {
    errors.push("STRIPE_SECRET_KEY must be a Stripe live mode secret key");
  }
  if (secretKey && isPlaceholder(secretKey)) {
    errors.push("STRIPE_SECRET_KEY must not use a placeholder value");
  }

  const webhookSecret = value(env, "STRIPE_WEBHOOK_SECRET");
  if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
    errors.push("STRIPE_WEBHOOK_SECRET must start with whsec_");
  }
  if (webhookSecret && isPlaceholder(webhookSecret)) {
    errors.push("STRIPE_WEBHOOK_SECRET must not use a placeholder value");
  }

  for (const key of ["STRIPE_PRICE_PRO_MONTHLY", "STRIPE_PRICE_BUSINESS_MONTHLY"]) {
    const priceId = value(env, key);
    if (priceId && !priceId.startsWith("price_")) {
      errors.push(`${key} must be a Stripe price id`);
    }
    if (priceId && isPlaceholder(priceId)) {
      errors.push(`${key} must not use a placeholder value`);
    }
  }

  if (!hasMysqlUrl(env)) {
    errors.push("DATABASE_URL or MYSQL_DATABASE_URL must be a MySQL URL");
  }

  if (value(env, "NODE_ENV") !== "production") {
    warnings.push("NODE_ENV is not production; run this check in the production deployment environment before launch.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return {
    ok: true,
    provider: "stripe",
    database: "mysql",
    stripeMode: "live",
    nodeEnv: value(env, "NODE_ENV") || "unset",
    warnings,
    configured: {
      STRIPE_SECRET_KEY: true,
      STRIPE_WEBHOOK_SECRET: true,
      STRIPE_PRICE_PRO_MONTHLY: true,
      STRIPE_PRICE_BUSINESS_MONTHLY: true,
    },
  };
}

export function formatProductionBillingPreflightSummary(result: ProductionBillingPreflightResult) {
  return [
    "billingProductionPreflight=ok",
    `provider=${result.provider}`,
    `database=${result.database}`,
    `stripeMode=${result.stripeMode}`,
    `nodeEnv=${result.nodeEnv}`,
    "STRIPE_SECRET_KEY=configured",
    "STRIPE_WEBHOOK_SECRET=configured",
    "STRIPE_PRICE_PRO_MONTHLY=configured",
    "STRIPE_PRICE_BUSINESS_MONTHLY=configured",
    `warnings=${result.warnings.length}`,
  ].join("\n");
}
