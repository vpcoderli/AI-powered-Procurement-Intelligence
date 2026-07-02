import { describe, expect, it } from "vitest";
import { getClientIp } from "./request-ip";

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-real-ip": "198.51.100.7" },
    });

    expect(getClientIp(request)).toBe("198.51.100.7");
  });

  it("returns a constant fallback when no proxy headers are present", () => {
    const request = new Request("http://localhost/api/auth/login");

    expect(getClientIp(request)).toBe("unknown");
  });

  it("trims whitespace around the extracted address", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "x-forwarded-for": "  203.0.113.9  , 10.0.0.1" },
    });

    expect(getClientIp(request)).toBe("203.0.113.9");
  });
});
