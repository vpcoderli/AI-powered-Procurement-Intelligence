import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionCookie } from "@/server/auth/session";
import { registerUser } from "@/server/auth/service";
import { ANONYMOUS_USER_COOKIE_NAME } from "@/server/bids/user";
import { users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { resolvePrincipal } from "./principal";

describe("principal resolution", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("prefers an authenticated session over an anonymous cookie", async () => {
    const registered = await registerUser(testDb.db, {
      email: "buyer@example.com",
      password: "strong-password",
    });
    const sessionCookie = createSessionCookie(registered.sessionToken);
    const request = new Request("http://localhost/api/saved-bids", {
      headers: {
        cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing; ${sessionCookie}`,
      },
    });

    const principal = await resolvePrincipal(testDb.db, request);

    expect(principal).toEqual({
      kind: "authenticated",
      userId: registered.user.id,
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search", "supplier_profile"]),
      workspace: {
        organizationId: expect.stringMatching(/^org_/),
        organizationName: "buyer's Workspace",
        role: "owner",
        tier: "free",
      },
    });
    expect(
      testDb.db.select().from(users).where(eq(users.id, "anon_existing")).limit(1).get(),
    ).toBeUndefined();
  });

  it("returns a non-persistent anonymous principal for an existing anonymous cookie", async () => {
    const principal = await resolvePrincipal(
      testDb.db,
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(principal).toEqual({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search"]),
    });
    expect(principal).not.toHaveProperty("anonymousCookie");
    expect(
      testDb.db.select().from(users).where(eq(users.id, "anon_existing")).limit(1).get(),
    ).toBeUndefined();
  });

  it("returns a non-persistent anonymous principal when no valid session exists", async () => {
    const principal = await resolvePrincipal(
      testDb.db,
      new Request("http://localhost/api/saved-bids"),
    );

    expect(principal).toEqual({
      kind: "anonymous",
      userId: "anonymous",
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search"]),
    });
    expect(principal).not.toHaveProperty("anonymousCookie");
    expect(
      testDb.db.select().from(users).where(eq(users.id, principal.userId)).limit(1).get(),
    ).toBeUndefined();
  });
});
