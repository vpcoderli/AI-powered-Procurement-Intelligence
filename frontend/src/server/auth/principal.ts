import type { AppDatabase } from "@/server/db/client";
import type { PublicWorkspace } from "@/server/account/workspace";
import { ensureUser, ensureUserFromMysql } from "@/server/bids/repository";
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  featuresForUser,
  type AccountTier,
  type FeatureKey,
  type UserRole,
} from "./entitlements";
import { getSessionUser } from "./service";
import { getMysqlSessionUser } from "./mysql-service";
import { readSessionToken } from "./session";

export type RequestPrincipal =
  | {
      kind: "authenticated";
      userId: string;
      role: UserRole;
      tier: AccountTier;
      features: FeatureKey[];
      workspace?: PublicWorkspace;
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
  const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;

  if (sessionToken) {
    const sessionUser = mysql ? await getMysqlSessionUser(mysql, sessionToken) : await getSessionUser(db, sessionToken);

    if (sessionUser) {
      return {
        kind: "authenticated",
        userId: sessionUser.id,
        role: sessionUser.role,
        tier: sessionUser.tier,
        features: sessionUser.features,
        workspace: sessionUser.workspace,
      };
    }
  }

  const anonymousUser = resolveAnonymousUser(request);
  if (mysql) {
    await ensureUserFromMysql(mysql, anonymousUser.userId);
  } else {
    await ensureUser(db, anonymousUser.userId);
  }
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
