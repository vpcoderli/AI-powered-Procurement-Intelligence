import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  hashSessionToken,
  readSessionToken,
} from "./session";

describe("session helpers", () => {
  it("creates opaque tokens and stable hashes", () => {
    const token = createSessionToken();

    expect(token).toMatch(/^sess_/);
    expect(createSessionToken()).not.toBe(token);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
  });

  it("creates and clears the session cookie", () => {
    const token = "sess_test-token";

    expect(createSessionCookie(token)).toContain(`${SESSION_COOKIE_NAME}=sess_test-token`);
    expect(createSessionCookie(token)).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(createSessionCookie(token, { secure: true })).toContain("Secure");
    expect(clearSessionCookie()).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(clearSessionCookie()).toContain("Max-Age=0");
    expect(clearSessionCookie({ secure: true })).toContain("Secure");
  });

  it("reads the session token from request cookies", () => {
    const request = new Request("http://localhost/api/auth/session", {
      headers: { cookie: `theme=dark; ${SESSION_COOKIE_NAME}=sess_abc%20123` },
    });

    expect(readSessionToken(request)).toBe("sess_abc 123");
    expect(readSessionToken(new Request("http://localhost/api/auth/session"))).toBeNull();
  });

  it("ignores malformed encoded session cookies", () => {
    const request = new Request("http://localhost/api/auth/session", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=sess_%E0%A4%A` },
    });

    expect(readSessionToken(request)).toBeNull();
  });
});
