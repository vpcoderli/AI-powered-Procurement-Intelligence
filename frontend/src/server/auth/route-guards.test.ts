import { describe, expect, it } from "vitest";
import { authRequiredResponse, isAuthenticatedPrincipal } from "./route-guards";

describe("route auth guards", () => {
  it("recognizes authenticated principals only", () => {
    expect(
      isAuthenticatedPrincipal({
        kind: "authenticated",
        userId: "user_1",
        role: "user",
        tier: "free",
        features: ["bid_search"],
      }),
    ).toBe(true);

    expect(
      isAuthenticatedPrincipal({
        kind: "anonymous",
        userId: "anon_1",
        role: "user",
        tier: "free",
        features: ["bid_search"],
      }),
    ).toBe(false);
  });

  it("returns a stable auth-required API response", async () => {
    const response = authRequiredResponse();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "AUTH_REQUIRED", message: "Authentication is required" },
    });
  });
});
