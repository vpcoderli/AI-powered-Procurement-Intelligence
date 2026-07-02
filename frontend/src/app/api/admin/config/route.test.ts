import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminConfigHandlers } from "./route";

describe("GET/POST /api/admin/config", () => {
  let testDb: TestDatabase;
  const originalBypass = process.env.ADMIN_UI_LOCAL_BYPASS;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    process.env.ADMIN_UI_LOCAL_BYPASS = "true";
  });

  afterEach(async () => {
    await testDb.cleanup();
    if (originalBypass === undefined) {
      delete process.env.ADMIN_UI_LOCAL_BYPASS;
    } else {
      process.env.ADMIN_UI_LOCAL_BYPASS = originalBypass;
    }
  });

  it("creates and lists config entries for admins", async () => {
    const handlers = createAdminConfigHandlers(testDb.db);
    const postResponse = await handlers.POST(new Request("http://localhost/api/admin/config", {
      method: "POST",
      body: JSON.stringify({
        module: "source",
        configKey: "approval_defaults",
        configValue: { approvalStatus: "approved" },
        changeReason: "Approve local public sources.",
      }),
    }));
    const postBody = await postResponse.json();

    expect(postResponse.status).toBe(200);
    expect(postBody.entry).toEqual(expect.objectContaining({
      module: "source",
      configKey: "approval_defaults",
      configValue: { approvalStatus: "approved" },
      changeReason: "Approve local public sources.",
    }));
    expect(postBody.entry.auditEventId).toMatch(/^event_/);
    expect(testDb.db.$client.prepare("SELECT event_name FROM event_log WHERE id = ?").get(postBody.entry.auditEventId)).toEqual({
      event_name: "admin.config.upserted",
    });

    const getResponse = await handlers.GET(new Request("http://localhost/api/admin/config?module=source"));
    const getBody = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(getBody.entries).toHaveLength(1);
    expect(getBody.entries[0].configKey).toBe("approval_defaults");
  });

  it("rejects invalid config bodies and filters", async () => {
    const handlers = createAdminConfigHandlers(testDb.db);
    const postResponse = await handlers.POST(new Request("http://localhost/api/admin/config", {
      method: "POST",
      body: JSON.stringify({
        module: "source",
        configKey: "unsupported",
        configValue: {},
        changeReason: "Invalid key.",
      }),
    }));
    const getResponse = await handlers.GET(new Request("http://localhost/api/admin/config?module=nope"));

    expect(postResponse.status).toBe(400);
    expect(getResponse.status).toBe(400);
  });

  it("records denied audit events for unauthenticated admin config reads", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const handlers = createAdminConfigHandlers(testDb.db);

    const response = await handlers.GET(new Request("http://localhost/api/admin/config"));
    const auditEvent = testDb.db.$client
      .prepare("SELECT event_name, outcome, target_type FROM event_log WHERE event_name = ?")
      .get("admin.config.access_denied");

    expect(response.status).toBe(403);
    expect(auditEvent).toEqual({
      event_name: "admin.config.access_denied",
      outcome: "denied",
      target_type: "config",
    });
  });

  it("rejects config writes from a cross-site Origin before checking admin access", async () => {
    const handlers = createAdminConfigHandlers(testDb.db);
    const postResponse = await handlers.POST(new Request("http://localhost/api/admin/config", {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
      body: JSON.stringify({
        module: "source",
        configKey: "approval_defaults",
        configValue: { approvalStatus: "approved" },
        changeReason: "Approve local public sources.",
      }),
    }));
    const postBody = await postResponse.json();

    expect(postResponse.status).toBe(403);
    expect(postBody.error.code).toBe("CSRF_VALIDATION_FAILED");
  });
});
