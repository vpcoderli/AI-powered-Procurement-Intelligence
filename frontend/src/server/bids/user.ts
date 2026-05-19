import { randomUUID } from "node:crypto";

export const ANONYMOUS_USER_COOKIE_NAME = "apsi_user_id";

const USER_ID_PATTERN = /^anon_[a-zA-Z0-9_-]+$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

function parseCookies(cookieHeader: string | null) {
  const cookies = new Map<string, string>();

  for (const rawPart of (cookieHeader ?? "").split(";")) {
    const part = rawPart.trim();
    if (!part) continue;

    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1) {
      cookies.set(part, "");
      continue;
    }

    try {
      cookies.set(
        part.slice(0, separatorIndex),
        decodeURIComponent(part.slice(separatorIndex + 1)),
      );
    } catch {
      continue;
    }
  }

  return cookies;
}

function createAnonymousUserId() {
  return `anon_${randomUUID().replaceAll("-", "")}`;
}

export function createAnonymousUserCookie(userId: string) {
  return [
    `${ANONYMOUS_USER_COOKIE_NAME}=${encodeURIComponent(userId)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");
}

export function clearAnonymousUserCookie() {
  return [
    `${ANONYMOUS_USER_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

export function resolveAnonymousUser(request: Request) {
  const cookies = parseCookies(request.headers.get("cookie"));
  const existingUserId = cookies.get(ANONYMOUS_USER_COOKIE_NAME);

  if (existingUserId && USER_ID_PATTERN.test(existingUserId)) {
    return { userId: existingUserId, isNewUser: false };
  }

  return { userId: createAnonymousUserId(), isNewUser: true };
}
