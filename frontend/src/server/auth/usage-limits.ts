import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { intentToBid, savedBids } from "@/server/db/schema";
import type { AccountTier, FeatureKey } from "./entitlements";

type LimitedFeature = Extract<FeatureKey, "saved_bids" | "intent_workspace">;

type TierUsageLimits = Record<LimitedFeature, number | null>;

const USAGE_LIMITS_BY_TIER: Record<AccountTier, TierUsageLimits> = {
  free: {
    saved_bids: 5,
    intent_workspace: 2,
  },
  pro: {
    saved_bids: 50,
    intent_workspace: 20,
  },
  business: {
    saved_bids: 250,
    intent_workspace: 100,
  },
  enterprise: {
    saved_bids: null,
    intent_workspace: null,
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

function usedCount(db: AppDatabase, userId: string, feature: LimitedFeature) {
  if (feature === "saved_bids") {
    return db.select().from(savedBids).where(eq(savedBids.userId, userId)).all().length;
  }

  return db.select().from(intentToBid).where(eq(intentToBid.userId, userId)).all().length;
}

function hasExistingResource(
  db: AppDatabase,
  userId: string,
  feature: LimitedFeature,
  resourceId: string | undefined,
) {
  if (!resourceId) return false;

  if (feature === "saved_bids") {
    return Boolean(
      db
        .select()
        .from(savedBids)
        .where(and(eq(savedBids.userId, userId), eq(savedBids.bidId, resourceId)))
        .limit(1)
        .get(),
    );
  }

  return Boolean(
    db
      .select()
      .from(intentToBid)
      .where(and(eq(intentToBid.userId, userId), eq(intentToBid.bidId, resourceId)))
      .limit(1)
      .get(),
  );
}

export function getUsageLimitStatus(
  db: AppDatabase,
  userId: string,
  tier: AccountTier,
  feature: LimitedFeature,
): UsageLimitStatus {
  const limit = usageLimitForTier(tier, feature);
  const used = usedCount(db, userId, feature);

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
  },
) {
  if (hasExistingResource(db, input.userId, input.feature, input.resourceId)) {
    return;
  }

  const status = getUsageLimitStatus(db, input.userId, input.tier, input.feature);

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
