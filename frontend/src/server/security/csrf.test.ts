import { afterEach, describe, expect, it } from "vitest";
import { csrfRejectedResponse, verifyCsrfSafe } from "./csrf";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  Object.assign(process.env, ORIGINAL_ENV);
}

describe("verifyCsrfSafe", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("always allows safe methods regardless of headers", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const request = new Request("http://localhost/api/account", { method });
      expect(verifyCsrfSafe(request)).toBe(true);
    }
  });

  it("allows unsafe methods with no Origin or Referer header (documented trade-off; see module doc comment)", () => {
    const request = new Request("http://localhost/api/account/password", { method: "POST" });
    expect(verifyCsrfSafe(request)).toBe(true);
  });

  it("allows unsafe methods when Origin matches the request's own host", () => {
    const request = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { origin: "http://localhost" },
    });
    expect(verifyCsrfSafe(request)).toBe(true);
  });

  it("rejects unsafe methods when Origin is a different site", () => {
    const request = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    });
    expect(verifyCsrfSafe(request)).toBe(false);
  });

  it("falls back to Referer when Origin is absent", () => {
    const allowed = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { referer: "http://localhost/settings" },
    });
    expect(verifyCsrfSafe(allowed)).toBe(true);

    const blocked = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { referer: "https://evil.example.com/phish" },
    });
    expect(verifyCsrfSafe(blocked)).toBe(false);
  });

  it("prefers Origin over Referer when both are present", () => {
    const request = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: {
        origin: "https://evil.example.com",
        referer: "http://localhost/settings",
      },
    });
    expect(verifyCsrfSafe(request)).toBe(false);
  });

  it("honors APP_ORIGIN as an explicit allowlist entry", () => {
    process.env.APP_ORIGIN = "https://app.apsi.example.com";

    const request = new Request("https://app.apsi.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://app.apsi.example.com" },
    });
    expect(verifyCsrfSafe(request)).toBe(true);
  });

  it("honors CSRF_ALLOWED_ORIGINS as a comma-separated allowlist", () => {
    process.env.CSRF_ALLOWED_ORIGINS = "https://a.example.com, https://b.example.com";

    const requestA = new Request("https://a.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://a.example.com" },
    });
    const requestB = new Request("https://b.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://b.example.com" },
    });
    const requestC = new Request("https://c.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://c.example.com" },
    });

    expect(verifyCsrfSafe(requestA)).toBe(true);
    expect(verifyCsrfSafe(requestB)).toBe(true);
    expect(verifyCsrfSafe(requestC)).toBe(false);
  });

  it("rejects an Origin allowlisted only when explicit options.allowedOrigins is provided", () => {
    const request = new Request("https://app.apsi.example.com/api/account/password", {
      method: "POST",
      headers: { origin: "https://app.apsi.example.com" },
    });

    expect(verifyCsrfSafe(request, { allowedOrigins: ["https://other.example.com"] })).toBe(false);
    expect(
      verifyCsrfSafe(request, { allowedOrigins: ["https://app.apsi.example.com"] }),
    ).toBe(true);
  });

  it("treats a malformed Origin header as untrusted", () => {
    const request = new Request("http://localhost/api/account/password", {
      method: "POST",
      headers: { origin: "not-a-valid-origin" },
    });
    expect(verifyCsrfSafe(request)).toBe(false);
  });
});

describe("csrfRejectedResponse", () => {
  it("returns a 403 with a stable error code", async () => {
    const response = csrfRejectedResponse();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("CSRF_VALIDATION_FAILED");
  });
});
