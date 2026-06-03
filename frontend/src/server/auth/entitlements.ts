export const USER_ROLES = ["user", "admin", "operator", "support"] as const;
export const ACCOUNT_TIERS = ["free", "pro", "business", "enterprise"] as const;

export const FEATURE_KEYS = [
  "bid_search",
  "saved_bids",
  "supplier_profile",
  "match_score",
  "intent_workspace",
  "submission_guidance",
  "compliance_manifest",
  "pursue_no_bid",
  "quote_workflow",
  "deadline_notifications",
  "knowledge_station",
  "bid.brief.full.generate",
  "compliance.manifest.generate",
  "readiness.review.run",
  "response.workspace.create",
  "artifact.vault.upload",
  "response.section.draft",
  "package.review.run",
  "amendment.delta.run",
  "award.tabulation.analyze",
  "price.to.win.run",
  "team.member.invite",
  "admin_console",
] as const;

export const PRODUCT_PLAN_KEYS = ["free", "pursuit_starter", "response_builder", "growth", "enterprise"] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AccountTier = (typeof ACCOUNT_TIERS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type ProductPlanKey = (typeof PRODUCT_PLAN_KEYS)[number];
export type AdminConsoleRole = Exclude<UserRole, "user">;

interface EntitlementSubject {
  role: UserRole;
  tier: AccountTier;
}

const tierRank: Record<AccountTier, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};

export const ADMIN_CONSOLE_ROLES: AdminConsoleRole[] = ["admin", "operator", "support"];

const minimumTierByFeature: Record<Exclude<FeatureKey, "admin_console">, AccountTier> = {
  bid_search: "free",
  saved_bids: "free",
  supplier_profile: "free",
  match_score: "free",
  intent_workspace: "free",
  submission_guidance: "pro",
  compliance_manifest: "business",
  pursue_no_bid: "pro",
  quote_workflow: "business",
  deadline_notifications: "business",
  knowledge_station: "enterprise",
  "bid.brief.full.generate": "pro",
  "compliance.manifest.generate": "business",
  "readiness.review.run": "pro",
  "response.workspace.create": "business",
  "artifact.vault.upload": "business",
  "response.section.draft": "business",
  "package.review.run": "business",
  "amendment.delta.run": "business",
  "award.tabulation.analyze": "enterprise",
  "price.to.win.run": "enterprise",
  "team.member.invite": "business",
};

export const PRODUCT_PLAN_LABELS: Record<ProductPlanKey, string> = {
  free: "Free",
  pursuit_starter: "Pursuit Starter",
  response_builder: "Response Builder",
  growth: "Growth",
  enterprise: "Enterprise",
};

export const PRODUCT_PLAN_BY_TIER: Record<AccountTier, Exclude<ProductPlanKey, "growth">> = {
  free: "free",
  pro: "pursuit_starter",
  business: "response_builder",
  enterprise: "enterprise",
};

export const ACCOUNT_TIER_LABELS: Record<AccountTier, string> = {
  free: PRODUCT_PLAN_LABELS.free,
  pro: PRODUCT_PLAN_LABELS.pursuit_starter,
  business: PRODUCT_PLAN_LABELS.response_builder,
  enterprise: PRODUCT_PLAN_LABELS.enterprise,
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && FEATURE_KEYS.includes(value as FeatureKey);
}

export function isAccountTier(value: unknown): value is AccountTier {
  return typeof value === "string" && ACCOUNT_TIERS.includes(value as AccountTier);
}

export function isProductPlanKey(value: unknown): value is ProductPlanKey {
  return typeof value === "string" && PRODUCT_PLAN_KEYS.includes(value as ProductPlanKey);
}

export function productPlanForTier(tier: AccountTier): Exclude<ProductPlanKey, "growth"> {
  return PRODUCT_PLAN_BY_TIER[tier];
}

export function productPlanLabelForTier(tier: AccountTier): string {
  return PRODUCT_PLAN_LABELS[productPlanForTier(tier)];
}

export function normalizeUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : "user";
}

export function normalizeAccountTier(value: unknown): AccountTier {
  return isAccountTier(value) ? value : "free";
}

export function hasFeature(subject: EntitlementSubject, feature: FeatureKey): boolean {
  if (feature === "admin_console") {
    return ADMIN_CONSOLE_ROLES.includes(subject.role as AdminConsoleRole);
  }

  return tierRank[subject.tier] >= tierRank[minimumTierByFeature[feature]];
}

export function featuresForUser(subject: EntitlementSubject): FeatureKey[] {
  return FEATURE_KEYS.filter((feature) => hasFeature(subject, feature));
}

export function applyFeatureOverrides(
  baseFeatures: readonly FeatureKey[],
  overrides: Iterable<{ featureKey: unknown; isEnabled: unknown; expiresAt?: unknown }>,
  now = new Date(),
): FeatureKey[] {
  const enabled = new Set(baseFeatures);

  for (const override of overrides) {
    if (!isFeatureKey(override.featureKey) || override.featureKey === "admin_console") {
      continue;
    }

    if (typeof override.expiresAt === "string" && new Date(override.expiresAt).getTime() <= now.getTime()) {
      continue;
    }

    if (override.isEnabled === 1 || override.isEnabled === true) {
      enabled.add(override.featureKey);
    } else {
      enabled.delete(override.featureKey);
    }
  }

  return FEATURE_KEYS.filter((feature) => enabled.has(feature));
}

export function minimumTierForFeature(feature: FeatureKey): AccountTier | null {
  if (feature === "admin_console") {
    return null;
  }

  return minimumTierByFeature[feature];
}

export function minimumTierLabelForFeature(feature: FeatureKey): string {
  const tier = minimumTierForFeature(feature);

  return tier ? ACCOUNT_TIER_LABELS[tier] : "Admin";
}
