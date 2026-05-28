import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, hashSessionToken } from "@/server/auth/session";
import { sessions, users } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { requireAdmin } from "./auth";

const NOW = "2026-05-19T00:00:00.000Z";

function requestWithSession(token: string) {
  return new Request("http://localhost/api/admin/data-sources", {
    headers: { cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
  });
}

describe("requireAdmin", () => {
  let testDb: TestDatabase;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    process.env.NODE_ENV = "test";
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
  });

  afterEach(async () => {
    await testDb.cleanup();
    process.env.NODE_ENV = originalNodeEnv;
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("allows explicit local bypass outside production", async () => {
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";

    await expect(requireAdmin(testDb.db, new Request("http://localhost/admin"))).resolves.toEqual({
      kind: "local-bypass",
    });
  });

  it("rejects local bypass in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";

    await expect(requireAdmin(testDb.db, new Request("http://localhost/admin"))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows authenticated admin users", async () => {
    const token = "session_token";
    testDb.db
      .insert(users)
      .values({
        id: "user_admin",
        email: "admin@example.com",
        role: "admin",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    testDb.db
      .insert(sessions)
      .values({
        id: "session_1",
        userId: "user_admin",
        tokenHash: hashSessionToken(token),
        expiresAt: "2099-05-20T00:00:00.000Z",
        createdAt: NOW,
        lastSeenAt: NOW,
      })
      .run();

    await expect(requireAdmin(testDb.db, requestWithSession(token))).resolves.toEqual({
      kind: "admin",
      userId: "user_admin",
    });
  });

  it("rejects authenticated non-admin users", async () => {
    const token = "session_token";
    testDb.db
      .insert(users)
      .values({
        id: "user_regular",
        email: "user@example.com",
        role: "user",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    testDb.db
      .insert(sessions)
      .values({
        id: "session_1",
        userId: "user_regular",
        tokenHash: hashSessionToken(token),
        expiresAt: "2099-05-20T00:00:00.000Z",
        createdAt: NOW,
        lastSeenAt: NOW,
      })
      .run();

    await expect(requireAdmin(testDb.db, requestWithSession(token))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects disabled admin users", async () => {
    const token = "session_token";
    testDb.db
      .insert(users)
      .values({
        id: "user_disabled_admin",
        email: "disabled-admin@example.com",
        role: "admin",
        isDisabled: 1,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    testDb.db
      .insert(sessions)
      .values({
        id: "session_1",
        userId: "user_disabled_admin",
        tokenHash: hashSessionToken(token),
        expiresAt: "2099-05-20T00:00:00.000Z",
        createdAt: NOW,
        lastSeenAt: NOW,
      })
      .run();

    await expect(requireAdmin(testDb.db, requestWithSession(token))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
