import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createHealthGet } from "./route";

describe("GET /api/health", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase();
    vi.stubEnv("NOTIFICATION_PROVIDER", "file");
  });

  afterEach(async () => {
    await testDb.cleanup();
    vi.unstubAllEnvs();
  });

  it("returns ok with database, notification, and error-tracking checks when healthy", async () => {
    const GET = createHealthGet({ database: testDb.db });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks.database).toEqual({ ok: true, status: "up", engine: "sqlite" });
    expect(body.checks.notifications).toEqual({ ok: true, status: "up", provider: "file" });
    expect(body.checks.errorTracking).toEqual({ configured: false });
    expect(typeof body.uptimeSeconds).toBe("number");
    expect(typeof body.timestamp).toBe("string");
  });

  it("reports errorTracking.configured true when SENTRY_DSN is set", async () => {
    vi.stubEnv("SENTRY_DSN", "https://example.invalid/1");

    const GET = createHealthGet({ database: testDb.db });
    const response = await GET();
    const body = await response.json();

    expect(body.checks.errorTracking).toEqual({ configured: true });
  });

  it("returns 503 with degraded status when the database check fails", async () => {
    const failingDatabase = {
      $client: {
        prepare() {
          throw new Error("database is closed");
        },
      },
    } as unknown as TestDatabase["db"];

    const GET = createHealthGet({ database: failingDatabase });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.detail).toContain("database is closed");
  });

  it("returns 503 with degraded status when the notification provider is misconfigured", async () => {
    vi.stubEnv("NOTIFICATION_PROVIDER", "http");
    vi.stubEnv("NOTIFICATION_HTTP_ENDPOINT", "");

    const GET = createHealthGet({ database: testDb.db });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.checks.notifications.ok).toBe(false);
  });

  it("can check MySQL reachability through a pool dependency", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@localhost:3306/apsi");

    const mysql = {
      async query() {
        return [[{ "1": 1 }]];
      },
    };

    const GET = createHealthGet({ mysql });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.checks.database).toEqual({ ok: true, status: "up", engine: "mysql" });
  });

  it("returns 503 when the MySQL pool dependency fails to respond", async () => {
    vi.stubEnv("DATABASE_URL", "mysql://user:pass@localhost:3306/apsi");

    const mysql = {
      async query() {
        throw new Error("connection refused");
      },
    };

    const GET = createHealthGet({ mysql });
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.checks.database).toEqual({
      ok: false,
      status: "down",
      engine: "mysql",
      detail: "connection refused",
    });
  });
});
