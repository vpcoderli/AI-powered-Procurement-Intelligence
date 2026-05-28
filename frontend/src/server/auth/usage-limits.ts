import { and, eq, inArray } from "drizzle-orm";
import { listWorkspaceMemberUserIds } from "@/server/account/workspace";
import type { AppDatabase } from "@/server/db/client";
import { alerts, intentToBid, organizationMemberships, savedBids } from "@/server/db/schema";
import type { AccountTier } from "./entitlements";

export type LimitedFeature = "saved_bids" | "intent_workspace" | "search_alerts" | "team_members";

type TierUsageLimits = Record<LimitedFeature, number | null>;

const USAGE_LIMITS_BY_TIER: Record<AccountTier, TierUsageLimits> = {
  free: {
    saved_bids: 5,
    intent_workspace: 2,
    search_alerts: 2,
    team_members: 1,
  },
  pro: {
    saved_bids: 50,
    intent_workspace: 20,
    search_alerts: 10,
    team_members: 3,
  },
  business: {
    saved_bids: 250,
    intent_workspace: 100,
    search_alerts: 50,
    team_members: 10,
  },
  enterprise: {
    saved_bids: null,
    intent_workspace: null,
    search_alerts: null,
    team_members: null,
  },
};

const nextTierByFeatureAndTier: Record<LimitedFeature, Partial<Record<AccountTier, AccountTier>>> = {
  saved_bids: {
    free: "pro",
    pro: "business",
    business: "enterprise",
  },
  intent_workspace: {
    free: "pro",
    pro: "business",
    business: "enterprise",
  },
  search_alerts: {
    free: "pro",
    pro: "business",
    business: "enterprise",
  },
  team_members: {
    free: "business",
    pro: "business",
    business: "enterprise",
  },
};

export interface UsageLimitStatus {
  feature: LimitedFeature;
  tier: AccountTier;
  used: number;
  limit: number | null;
  remaining: number | null;
  isLimited: boolean;
  requiredTier: AccountTier | null;
}

export class UsageLimitError extends Error {
  code = "USAGE_LIMIT_REACHED" as const;
  feature: LimitedFeature;
  tier: AccountTier;
  used: number;
  limit: number;
  requiredTier: AccountTier | null;

  constructor(status: {
    feature: LimitedFeature;
    tier: AccountTier;
    used: number;
    limit: number;
    requiredTier?: AccountTier | null;
  }) {
    super("Usage limit reached");
    this.name = "UsageLimitError";
    this.feature = status.feature;
    this.tier = status.tier;
    this.used = status.used;
    this.limit = status.limit;
    this.requiredTier = status.requiredTier ?? nextTierByFeatureAndTier[status.feature][status.tier] ?? null;
  }
}

export function usageLimitForTier(tier: AccountTier, feature: LimitedFeature) {
  return USAGE_LIMITS_BY_TIER[tier][feature];
}

interface UsageLimitScopeOptions {
  scopeUserIds?: string[];
}

function scopedUserIds(db: AppDatabase, userId: string, options: UsageLimitScopeOptions = {}) {
  return options.scopeUserIds && options.scopeUserIds.length > 0
    ? options.scopeUserIds
    : listWorkspaceMemberUserIds(db, userId);
}

function usedCount(
  db: AppDatabase,
  userId: string,
  feature: LimitedFeature,
  options: UsageLimitScopeOptions = {},
) {
  const userIds = scopedUserIds(db, userId, options);

  if (feature === "saved_bids") {
    return new Set(
      db
        .select({ bidId: savedBids.bidId })
        .from(savedBids)
        .where(inArray(savedBids.userId, userIds))
        .all()
        .map((row) => row.bidId),
    ).size;
  }

  if (feature === "intent_workspace") {
    return new Set(
      db
        .select({ bidId: intentToBid.bidId })
        .from(intentToBid)
        .where(inArray(intentToBid.userId, userIds))
        .all()
        .map((row) => row.bidId),
    ).size;
  }

  if (feature === "search_alerts") {
    return db
      .select({ id: alerts.id })
      .from(alerts)
      .where(inArray(alerts.userId, userIds))
      .all().length;
  }

  return db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(
      inArray(organizationMemberships.userId, userIds),
      eq(organizationMemberships.status, "active"),
    ))
    .all().length;
}

function hasExistingResource(
  db: AppDatabase,
  userId: string,
  feature: LimitedFeature,
  resourceId: string | undefined,
  options: UsageLimitScopeOptions = {},
) {
  if (!resourceId) return false;
  const userIds = scopedUserIds(db, userId, options);

  if (feature === "saved_bids") {
    return Boolean(
      db
        .select()
        .from(savedBids)
        .where(and(inArray(savedBids.userId, userIds), eq(savedBids.bidId, resourceId)))
        .limit(1)
        .get(),
    );
  }

  if (feature === "intent_workspace") {
    return Boolean(
      db
        .select()
        .from(intentToBid)
        .where(and(inArray(intentToBid.userId, userIds), eq(intentToBid.bidId, resourceId)))
        .limit(1)
        .get(),
    );
  }

  if (feature === "search_alerts") {
    return Boolean(
      db
        .select()
        .from(alerts)
        .where(and(inArray(alerts.userId, userIds), eq(alerts.id, resourceId)))
        .limit(1)
        .get(),
    );
  }

  return Boolean(
    db
      .select()
      .from(organizationMemberships)
      .where(and(
        inArray(organizationMemberships.userId, userIds),
        eq(organizationMemberships.userId, resourceId),
        eq(organizationMemberships.status, "active"),
      ))
      .limit(1)
      .get(),
  );
}

export function getUsageLimitStatus(
  db: AppDatabase,
  userId: string,
  tier: AccountTier,
  feature: LimitedFeature,
  options: UsageLimitScopeOptions = {},
): UsageLimitStatus {
  const limit = usageLimitForTier(tier, feature);
  const used = usedCount(db, userId, feature, options);

  return {
    feature,
    tier,
    used,
    limit,
    remaining: limit === null ? null : Math.max(limit - used, 0),
    isLimited: limit !== null && used >= limit,
    requiredTier: limit === null ? null : nextTierByFeatureAndTier[feature][tier] ?? null,
  };
}

export function enforceUsageLimit(
  db: AppDatabase,
  input: {
    userId: string;
    tier: AccountTier;
    feature: LimitedFeature;
    resourceId?: string;
    scopeUserIds?: string[];
  },
) {
  if (hasExistingResource(db, input.userId, input.feature, input.resourceId, input)) {
    return;
  }

  const status = getUsageLimitStatus(db, input.userId, input.tier, input.feature, input);

  if (status.limit !== null && status.used >= status.limit) {
    throw new UsageLimitError({
      feature: status.feature,
      tier: status.tier,
      used: status.used,
      limit: status.limit,
      requiredTier: status.requiredTier,
    });
  }
}
