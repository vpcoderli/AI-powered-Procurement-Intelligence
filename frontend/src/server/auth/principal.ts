import type { AppDatabase } from "@/server/db/client";
import { ensureUser } from "@/server/bids/repository";
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";
import {
  featuresForUser,
  type AccountTier,
  type FeatureKey,
  type UserRole,
} from "./entitlements";
import { getSessionUser } from "./service";
import { readSessionToken } from "./session";

export type RequestPrincipal =
  | {
      kind: "authenticated";
      userId: string;
      role: UserRole;
      tier: AccountTier;
      features: FeatureKey[];
    }
  | {
      kind: "anonymous";
      userId: string;
      role: UserRole;
      tier: AccountTier;
      features: FeatureKey[];
      anonymousCookie?: string;
    };

export async function resolvePrincipal(
  db: AppDatabase,
  request: Request,
): Promise<RequestPrincipal> {
  const sessionToken = readSessionToken(request);

  if (sessionToken) {
    const sessionUser = await getSessionUser(db, sessionToken);

    if (sessionUser) {
      return {
        kind: "authenticated",
        userId: sessionUser.id,
        role: sessionUser.role,
        tier: sessionUser.tier,
        features: sessionUser.features,
      };
    }
  }

  const anonymousUser = resolveAnonymousUser(request);
  await ensureUser(db, anonymousUser.userId);
  const anonymousEntitlements = {
    role: "user" as const,
    tier: "free" as const,
  };

  return {
    kind: "anonymous",
    userId: anonymousUser.userId,
    ...anonymousEntitlements,
    features: featuresForUser(anonymousEntitlements),
    ...(anonymousUser.isNewUser
      ? { anonymousCookie: createAnonymousUserCookie(anonymousUser.userId) }
      : {}),
  };
}
