import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertConfigEntry } from "@/server/config/registry";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { createAdminConfigPatch } from "./route";

describe("PATCH /api/admin/config/[id]", () => {
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

  it("patches an existing config entry", async () => {
    const existing = upsertConfigEntry(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      configValue: { enabled: true, offsetsHours: [72] },
      changeReason: "Seed test notification config.",
      now: "2026-06-01T00:00:00.000Z",
    });

    const PATCH = createAdminConfigPatch(testDb.db);
    const response = await PATCH(
      new Request(`http://localhost/api/admin/config/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          configValue: { enabled: false },
          status: "inactive",
          changeReason: "Disable deadline reminders for test.",
        }),
      }),
      { params: Promise.resolve({ id: existing.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.entry).toEqual(expect.objectContaining({
      id: existing.id,
      status: "inactive",
      configValue: { enabled: false },
      changeReason: "Disable deadline reminders for test.",
    }));
    expect(body.entry.auditEventId).toMatch(/^event_/);
    expect(testDb.db.$client.prepare("SELECT event_name FROM event_log WHERE id = ?").get(body.entry.auditEventId)).toEqual({
      event_name: "admin.config.updated",
    });
  });

  it("returns not found for unknown config entries", async () => {
    const PATCH = createAdminConfigPatch(testDb.db);
    const response = await PATCH(
      new Request("http://localhost/api/admin/config/cfg_missing", {
        method: "PATCH",
        body: JSON.stringify({ changeReason: "Update missing config." }),
      }),
      { params: Promise.resolve({ id: "cfg_missing" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("CONFIG_NOT_FOUND");
  });

  it("rejects config patches without a change reason", async () => {
    const existing = upsertConfigEntry(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      configValue: { enabled: true },
      changeReason: "Seed config for validation.",
    });
    const PATCH = createAdminConfigPatch(testDb.db);

    const response = await PATCH(
      new Request(`http://localhost/api/admin/config/${existing.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          configValue: { enabled: false },
          changeReason: "  ",
        }),
      }),
      { params: Promise.resolve({ id: existing.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_CONFIG");
  });

  it("records denied audit events for unauthenticated config patches", async () => {
    delete process.env.ADMIN_UI_LOCAL_BYPASS;
    const PATCH = createAdminConfigPatch(testDb.db);

    const response = await PATCH(
      new Request("http://localhost/api/admin/config/cfg_denied", {
        method: "PATCH",
        body: JSON.stringify({ changeReason: "Attempt unauthenticated patch." }),
      }),
      { params: Promise.resolve({ id: "cfg_denied" }) },
    );
    const auditEvent = testDb.db.$client
      .prepare("SELECT event_name, outcome, target_id FROM event_log WHERE event_name = ?")
      .get("admin.config.access_denied");

    expect(response.status).toBe(403);
    expect(auditEvent).toEqual({
      event_name: "admin.config.access_denied",
      outcome: "denied",
      target_id: "cfg_denied",
    });
  });
});
