import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "apsi_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken() {
  return `sess_${randomBytes(32).toString("base64url")}`;
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

interface SessionCookieOptions {
  secure?: boolean;
}

function shouldUseSecureCookie(options: SessionCookieOptions = {}) {
  return options.secure ?? process.env.NODE_ENV === "production";
}

function cookieParts(parts: string[], options?: SessionCookieOptions) {
  return [...parts, ...(shouldUseSecureCookie(options) ? ["Secure"] : [])].join("; ");
}

export function createSessionCookie(token: string, options?: SessionCookieOptions) {
  return cookieParts([
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ], options);
}

export function clearSessionCookie(options?: SessionCookieOptions) {
  return cookieParts([`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"], options);
}

export function readSessionToken(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`));

  try {
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}
