export const USER_ROLES = ["user", "admin"] as const;
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
  "knowledge_station",
  "admin_console",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type AccountTier = (typeof ACCOUNT_TIERS)[number];
export type FeatureKey = (typeof FEATURE_KEYS)[number];

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
  knowledge_station: "enterprise",
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && USER_ROLES.includes(value as UserRole);
}

export function isAccountTier(value: unknown): value is AccountTier {
  return typeof value === "string" && ACCOUNT_TIERS.includes(value as AccountTier);
}

export function normalizeUserRole(value: unknown): UserRole {
  return isUserRole(value) ? value : "user";
}

export function normalizeAccountTier(value: unknown): AccountTier {
  return isAccountTier(value) ? value : "free";
}

export function hasFeature(subject: EntitlementSubject, feature: FeatureKey): boolean {
  if (feature === "admin_console") {
    return subject.role === "admin";
  }

  return tierRank[subject.tier] >= tierRank[minimumTierByFeature[feature]];
}

export function featuresForUser(subject: EntitlementSubject): FeatureKey[] {
  return FEATURE_KEYS.filter((feature) => hasFeature(subject, feature));
}
