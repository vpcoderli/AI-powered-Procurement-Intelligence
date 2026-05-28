import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { accountSubscriptions, subscriptionEvents, users } from "@/server/db/schema";
import {
  ACCOUNT_TIER_LABELS,
  normalizeAccountTier,
  type AccountTier,
} from "@/server/auth/entitlements";

export const SUBSCRIPTION_STATUSES = ["none", "trialing", "active", "past_due", "canceled"] as const;
export const SUBSCRIPTION_SOURCES = ["admin_override", "local_checkout", "billing_provider"] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

export interface SubscriptionPlan {
  tier: AccountTier;
  label: string;
  priceMonthlyUsd: number | null;
  featureHighlights: string[];
}

export interface AccountSubscriptionView {
  userId: string;
  tier: AccountTier;
  status: SubscriptionStatus;
  source: SubscriptionSource;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface AccountSubscriptionResponse {
  subscription: AccountSubscriptionView;
  plans: SubscriptionPlan[];
}

export interface UpsertAccountSubscriptionInput {
  tier: AccountTier;
  status: SubscriptionStatus;
  source: Exclude<SubscriptionSource, "admin_override">;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  provider?: string | null;
  providerCustomerId?: string | null;
  providerSubscriptionId?: string | null;
  metadata?: Record<string, unknown>;
}

export class InvalidSubscriptionInputError extends Error {
  constructor(message = "Invalid subscription input") {
    super(message);
    this.name = "InvalidSubscriptionInputError";
  }
}

const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    tier: "free",
    label: ACCOUNT_TIER_LABELS.free,
    priceMonthlyUsd: 0,
    featureHighlights: ["Search bids", "Save bids", "Supplier profile"],
  },
  {
    tier: "pro",
    label: ACCOUNT_TIER_LABELS.pro,
    priceMonthlyUsd: 79,
    featureHighlights: ["Submission guidance", "Pursue / no-bid workflow", "Full match explanation"],
  },
  {
    tier: "business",
    label: ACCOUNT_TIER_LABELS.business,
    priceMonthlyUsd: 249,
    featureHighlights: ["Compliance manifest", "Quote workflow", "Team-ready bid workspace"],
  },
  {
    tier: "enterprise",
    label: ACCOUNT_TIER_LABELS.enterprise,
    priceMonthlyUsd: null,
    featureHighlights: ["Knowledge Station", "Advanced intelligence", "Higher support limits"],
  },
];

function nowIso() {
  return new Date().toISOString();
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === "string" && SUBSCRIPTION_STATUSES.includes(value as SubscriptionStatus);
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  return isSubscriptionStatus(value) ? value : "none";
}

function isSubscriptionSource(value: unknown): value is SubscriptionSource {
  return typeof value === "string" && SUBSCRIPTION_SOURCES.includes(value as SubscriptionSource);
}

function normalizeSubscriptionSource(value: unknown): SubscriptionSource {
  return isSubscriptionSource(value) ? value : "admin_override";
}

export function listSubscriptionPlans() {
  return SUBSCRIPTION_PLANS;
}

function getUserOrThrow(db: AppDatabase, userId: string) {
  const user = db.select().from(users).where(eq(users.id, userId)).limit(1).get();

  if (!user) {
    throw new InvalidSubscriptionInputError("User not found");
  }

  return user;
}

export function getAccountSubscription(db: AppDatabase, userId: string): AccountSubscriptionResponse {
  const user = getUserOrThrow(db, userId);
  const row = db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
  const effectiveTier = normalizeAccountTier(user.accountTier);

  if (!row) {
    return {
      subscription: {
        userId,
        tier: effectiveTier,
        status: "none",
        source: "admin_override",
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      plans: listSubscriptionPlans(),
    };
  }

  const storedTier = normalizeAccountTier(row.tier);

  return {
    subscription: {
      userId,
      tier: effectiveTier,
      status: normalizeSubscriptionStatus(row.status),
      source: effectiveTier === storedTier ? normalizeSubscriptionSource(row.source) : "admin_override",
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd === 1,
    },
    plans: listSubscriptionPlans(),
  };
}

export function upsertAccountSubscription(
  db: AppDatabase,
  userId: string,
  input: UpsertAccountSubscriptionInput,
): AccountSubscriptionResponse {
  const user = getUserOrThrow(db, userId);
  const existing = db
    .select()
    .from(accountSubscriptions)
    .where(eq(accountSubscriptions.userId, userId))
    .limit(1)
    .get();
  const timestamp = nowIso();
  const subscriptionId = existing?.id ?? `sub_${randomUUID()}`;
  const fromTier = normalizeAccountTier(user.accountTier);
  const fromStatus = normalizeSubscriptionStatus(existing?.status);

  if (existing) {
    db.update(accountSubscriptions)
      .set({
        tier: input.tier,
        status: input.status,
        source: input.source,
        provider: input.provider ?? existing.provider,
        providerCustomerId: input.providerCustomerId ?? existing.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId ?? existing.providerSubscriptionId,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
        updatedAt: timestamp,
      })
      .where(eq(accountSubscriptions.id, subscriptionId))
      .run();
  } else {
    db.insert(accountSubscriptions)
      .values({
        id: subscriptionId,
        userId,
        tier: input.tier,
        status: input.status,
        source: input.source,
        provider: input.provider ?? null,
        providerCustomerId: input.providerCustomerId ?? null,
        providerSubscriptionId: input.providerSubscriptionId ?? null,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd ? 1 : 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  db.update(users)
    .set({
      accountTier: input.tier,
      updatedAt: timestamp,
    })
    .where(eq(users.id, userId))
    .run();

  db.insert(subscriptionEvents)
    .values({
      id: `subevt_${randomUUID()}`,
      userId,
      subscriptionId,
      eventType: "subscription_updated",
      fromTier,
      toTier: input.tier,
      fromStatus,
      toStatus: input.status,
      source: input.source,
      metadataJson: JSON.stringify(input.metadata ?? {}),
      createdAt: timestamp,
    })
    .run();

  return getAccountSubscription(db, userId);
}
