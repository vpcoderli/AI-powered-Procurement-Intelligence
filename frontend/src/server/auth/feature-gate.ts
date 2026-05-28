import type { RequestPrincipal } from "./principal";
import {
  ACCOUNT_TIER_LABELS,
  isAccountTier,
  minimumTierLabelForFeature,
  type FeatureKey,
} from "./entitlements";

function tierDisplayName(value: string) {
  return isAccountTier(value) ? ACCOUNT_TIER_LABELS[value] : value;
}

export class FeatureAccessError extends Error {
  code = "FEATURE_NOT_AVAILABLE" as const;
  status = 403;

  constructor(
    readonly feature: FeatureKey,
    readonly requiredTier = minimumTierLabelForFeature(feature),
  ) {
    super(`${tierDisplayName(requiredTier)} plan is required for this feature.`);
    this.name = "FeatureAccessError";
  }
}

export function requireFeature<TPrincipal extends { features: readonly FeatureKey[] }>(
  principal: TPrincipal,
  feature: FeatureKey,
): TPrincipal {
  if (!principal.features.includes(feature)) {
    throw new FeatureAccessError(feature);
  }

  return principal;
}

export function featureErrorResponse(error: FeatureAccessError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      feature: error.feature,
      requiredTier: error.requiredTier,
    },
  };
}

export type FeatureGatedPrincipal = RequestPrincipal;
