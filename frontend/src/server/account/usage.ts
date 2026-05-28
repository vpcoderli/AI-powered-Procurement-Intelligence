import { eq } from "drizzle-orm";
import { listWorkspaceMemberUserIds } from "@/server/account/workspace";
import { normalizeAccountTier, type AccountTier } from "@/server/auth/entitlements";
import {
  getUsageLimitStatus,
  type LimitedFeature,
  type UsageLimitStatus,
} from "@/server/auth/usage-limits";
import type { AppDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";

const ACCOUNT_USAGE_FEATURES: LimitedFeature[] = [
  "saved_bids",
  "intent_workspace",
  "search_alerts",
  "team_members",
];

export interface AccountUsageItem {
  feature: LimitedFeature;
  used: number;
  limit: number | null;
  remaining: number | null;
  isLimited: boolean;
  requiredTier: AccountTier | null;
}

export interface AccountUsageResponse {
  tier: AccountTier;
  workspaceUserIds: string[];
  items: AccountUsageItem[];
}

function toAccountUsageItem(status: UsageLimitStatus): AccountUsageItem {
  return {
    feature: status.feature,
    used: status.used,
    limit: status.limit,
    remaining: status.remaining,
    isLimited: status.isLimited,
    requiredTier: status.requiredTier,
  };
}

export function getAccountUsage(db: AppDatabase, userId: string): AccountUsageResponse {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  const tier = normalizeAccountTier(user?.accountTier);
  const workspaceUserIds = listWorkspaceMemberUserIds(db, userId).sort((left, right) => {
    if (left === userId) return -1;
    if (right === userId) return 1;

    return left.localeCompare(right);
  });

  return {
    tier,
    workspaceUserIds,
    items: ACCOUNT_USAGE_FEATURES.map((feature) =>
      toAccountUsageItem(
        getUsageLimitStatus(db, userId, tier, feature, {
          scopeUserIds: workspaceUserIds,
        }),
      ),
    ),
  };
}
