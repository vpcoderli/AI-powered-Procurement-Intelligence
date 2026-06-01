import { eq } from "drizzle-orm";
import type { Pool } from "mysql2/promise";
import { ensureMysqlUserWorkspace, listMysqlWorkspaceMemberUserIds } from "@/server/account/mysql-workspace";
import { listWorkspaceMemberUserIds, workspaceTierForUser } from "@/server/account/workspace";
import { normalizeAccountTier, type AccountTier } from "@/server/auth/entitlements";
import {
  getUsageLimitStatus,
  type LimitedFeature,
  type UsageLimitStatus,
  usageLimitForTier,
} from "@/server/auth/usage-limits";
import type { AppDatabase } from "@/server/db/client";
import { expandMysqlInClause, mysqlSelectOne } from "@/server/db/mysql-runtime";
import { users } from "@/server/db/schema";
import { creditSummaryForTier, type CreditSummary } from "@/server/billing/credits";

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
  creditSummary: CreditSummary;
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

function toMysqlAccountUsageItem(
  feature: LimitedFeature,
  tier: AccountTier,
  used: number,
): AccountUsageItem {
  const limit = usageLimitForTier(tier, feature);
  const requiredTier = limit === null
    ? null
    : feature === "team_members" && (tier === "free" || tier === "pro")
      ? "business"
      : tier === "business"
        ? "enterprise"
        : tier === "free"
          ? "pro"
          : tier === "pro"
            ? "business"
            : null;

  return {
    feature,
    used,
    limit,
    remaining: limit === null ? null : Math.max(limit - used, 0),
    isLimited: limit !== null && used >= limit,
    requiredTier,
  };
}

export function getAccountUsage(db: AppDatabase, userId: string): AccountUsageResponse {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();
  const tier = user?.email ? workspaceTierForUser(db, userId) : normalizeAccountTier(user?.accountTier);
  const workspaceUserIds = listWorkspaceMemberUserIds(db, userId).sort((left, right) => {
    if (left === userId) return -1;
    if (right === userId) return 1;

    return left.localeCompare(right);
  });

  return {
    tier,
    workspaceUserIds,
    creditSummary: creditSummaryForTier(tier),
    items: ACCOUNT_USAGE_FEATURES.map((feature) =>
      toAccountUsageItem(
        getUsageLimitStatus(db, userId, tier, feature, {
          scopeUserIds: workspaceUserIds,
        }),
      ),
    ),
  };
}

async function mysqlUsedCount(mysql: Pick<Pool, "query">, feature: LimitedFeature, userIds: string[]) {
  const { placeholders, values } = expandMysqlInClause(userIds);
  const fromClause = (() => {
    if (feature === "saved_bids") {
      return `SELECT COUNT(DISTINCT bid_id) AS used FROM saved_bids WHERE user_id IN (${placeholders})`;
    }

    if (feature === "intent_workspace") {
      return `SELECT COUNT(DISTINCT bid_id) AS used FROM intent_to_bid WHERE user_id IN (${placeholders})`;
    }

    if (feature === "search_alerts") {
      return `SELECT COUNT(id) AS used FROM alerts WHERE user_id IN (${placeholders})`;
    }

    return `
      SELECT COUNT(user_id) AS used
      FROM organization_memberships
      WHERE user_id IN (${placeholders}) AND status IN ('active', 'invited')
    `;
  })();
  const row = await mysqlSelectOne<{ used: number | string }>(mysql, fromClause, values);

  return Number(row?.used ?? 0);
}

export async function getAccountUsageFromMysql(
  mysql: Pick<Pool, "query">,
  userId: string,
): Promise<AccountUsageResponse> {
  const workspace = await ensureMysqlUserWorkspace(mysql as Pool, userId);
  const tier = normalizeAccountTier(workspace.tier);
  const workspaceUserIds = (await listMysqlWorkspaceMemberUserIds(mysql as Pool, userId)).sort((left, right) => {
    if (left === userId) return -1;
    if (right === userId) return 1;

    return left.localeCompare(right);
  });
  const items = [];

  for (const feature of ACCOUNT_USAGE_FEATURES) {
    items.push(toMysqlAccountUsageItem(feature, tier, await mysqlUsedCount(mysql, feature, workspaceUserIds)));
  }

  return {
    tier,
    workspaceUserIds,
    creditSummary: creditSummaryForTier(tier),
    items,
  };
}
