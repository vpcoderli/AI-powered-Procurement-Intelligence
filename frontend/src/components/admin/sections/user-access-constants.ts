import type { AccountTier, FeatureKey, UserRole } from "@/server/auth/entitlements";

export const USER_ROLES: UserRole[] = ["user", "admin", "operator", "support"];
export const ACCOUNT_TIERS: AccountTier[] = ["free", "pro", "business", "enterprise"];
export const OVERRIDABLE_FEATURES: FeatureKey[] = [
  "submission_guidance",
  "compliance_manifest",
  "pursue_no_bid",
  "quote_workflow",
  "knowledge_station",
];
