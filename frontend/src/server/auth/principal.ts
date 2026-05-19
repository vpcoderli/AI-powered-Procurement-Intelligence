import type { AppDatabase } from "@/server/db/client";
import { ensureUser } from "@/server/bids/repository";
import {
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "@/server/bids/user";
import { getSessionUser } from "./service";
import { readSessionToken } from "./session";

export type RequestPrincipal =
  | {
      kind: "authenticated";
      userId: string;
    }
  | {
      kind: "anonymous";
      userId: string;
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
      };
    }
  }

  const anonymousUser = resolveAnonymousUser(request);
  await ensureUser(db, anonymousUser.userId);

  return {
    kind: "anonymous",
    userId: anonymousUser.userId,
    ...(anonymousUser.isNewUser
      ? { anonymousCookie: createAnonymousUserCookie(anonymousUser.userId) }
      : {}),
  };
}
