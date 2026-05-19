import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_USER_COOKIE_NAME,
  createAnonymousUserCookie,
  resolveAnonymousUser,
} from "./user";

describe("anonymous saved-bids user", () => {
  it("uses a valid existing anonymous user cookie", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(result.userId).toBe("anon_existing");
    expect(result.isNewUser).toBe(false);
  });

  it("creates an anonymous user when no cookie exists", () => {
    const result = resolveAnonymousUser(new Request("http://localhost/api/saved-bids"));

    expect(result.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(result.isNewUser).toBe(true);
  });

  it("creates an anonymous user when cookie is invalid", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=bad value` },
      }),
    );

    expect(result.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(result.isNewUser).toBe(true);
  });

  it("creates an anonymous user when the anonymous user cookie is malformed", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=%E0%A4%A` },
      }),
    );

    expect(result.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(result.isNewUser).toBe(true);
  });

  it("uses a valid anonymous user cookie when another cookie is malformed", () => {
    const result = resolveAnonymousUser(
      new Request("http://localhost/api/saved-bids", {
        headers: {
          cookie: `other=%E0%A4%A; ${ANONYMOUS_USER_COOKIE_NAME}=anon_existing`,
        },
      }),
    );

    expect(result.userId).toBe("anon_existing");
    expect(result.isNewUser).toBe(false);
  });

  it("formats the anonymous user cookie", () => {
    expect(createAnonymousUserCookie("anon_abc")).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=anon_abc`,
    );
    expect(createAnonymousUserCookie("anon_abc")).toContain("HttpOnly");
    expect(createAnonymousUserCookie("anon_abc")).toContain("SameSite=Lax");
    expect(createAnonymousUserCookie("anon_abc")).toContain("Path=/");
    expect(createAnonymousUserCookie("anon_abc")).toContain("Max-Age=");
  });
});
