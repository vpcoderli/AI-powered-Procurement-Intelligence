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
    });
    expect(
      testDb.db.select().from(users).where(eq(users.id, "anon_existing")).limit(1).get(),
    ).toBeUndefined();
  });

  it("falls back to an existing anonymous cookie and ensures the user exists", async () => {
    const principal = await resolvePrincipal(
      testDb.db,
      new Request("http://localhost/api/saved-bids", {
        headers: { cookie: `${ANONYMOUS_USER_COOKIE_NAME}=anon_existing` },
      }),
    );

    expect(principal).toEqual({
      kind: "anonymous",
      userId: "anon_existing",
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search"]),
    });
    expect(
      testDb.db.select().from(users).where(eq(users.id, "anon_existing")).limit(1).get(),
    ).toMatchObject({ id: "anon_existing" });
  });

  it("creates an anonymous principal and cookie when no valid session or user cookie exists", async () => {
    const principal = await resolvePrincipal(
      testDb.db,
      new Request("http://localhost/api/saved-bids"),
    );

    expect(principal.kind).toBe("anonymous");
    expect(principal.userId).toMatch(/^anon_[a-zA-Z0-9_-]+$/);
    expect(principal).toMatchObject({
      role: "user",
      tier: "free",
      features: expect.arrayContaining(["bid_search"]),
    });
    expect(principal.anonymousCookie).toContain(
      `${ANONYMOUS_USER_COOKIE_NAME}=${principal.userId}`,
    );
    expect(
      testDb.db.select().from(users).where(eq(users.id, principal.userId)).limit(1).get(),
    ).toMatchObject({ id: principal.userId });
  });
});
