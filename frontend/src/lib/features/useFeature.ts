"use client";

import { useAuth } from "@/context/AuthContext";
import {
  minimumTierLabelForFeature,
  type FeatureKey,
} from "@/server/auth/entitlements";
import type { PublicUser } from "@/lib/api/auth";

export function canUseFeature(user: PublicUser | null, feature: FeatureKey) {
  return user?.features.includes(feature) ?? false;
}

export function lockedFeatureMessage(feature: FeatureKey) {
  const requiredTier = minimumTierLabelForFeature(feature);

  if (requiredTier === "Admin") {
    return "Admin role is required for this feature.";
  }

  return `Upgrade to ${requiredTier} to unlock this feature.`;
}

export function useFeature(feature: FeatureKey) {
  const { user } = useAuth();
  const enabled = canUseFeature(user, feature);

  return {
    enabled,
    feature,
    requiredTier: minimumTierLabelForFeature(feature),
    message: enabled ? null : lockedFeatureMessage(feature),
  };
}
