import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  ConfigRegistryValidationError,
  getEffectiveConfigValue,
  getEffectiveConfigValueFromMysql,
  listConfigEntries,
  listConfigEntriesFromMysql,
  seedDefaultConfigEntries,
  upsertConfigEntry,
  upsertConfigEntryFromMysql,
} from "./registry";

describe("config registry", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("seeds default configuration entries", () => {
    seedDefaultConfigEntries(testDb.db, "2026-06-01T00:00:00.000Z");

    const entries = listConfigEntries(testDb.db);

    expect(entries.map((entry) => `${entry.module}:${entry.configKey}`)).toEqual([
      "notification:deadline_reminders",
      "source:approval_defaults",
      "ux_state:severity_map",
    ]);
    expect(getEffectiveConfigValue(testDb.db, {
      module: "source",
      configKey: "approval_defaults",
      now: "2026-06-01T00:00:00.000Z",
    })?.configValue).toEqual({
      approvedForIngestion: false,
      approvalStatus: "needs_review",
      legalReviewStatus: "not_reviewed",
    });
  });

  it("returns active configuration and ignores expired entries", () => {
    upsertConfigEntry(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      configValue: { enabled: false },
      effectiveTo: "2026-05-31T00:00:00.000Z",
      changeReason: "Expired test config.",
      now: "2026-05-01T00:00:00.000Z",
    });

    expect(getEffectiveConfigValue(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      now: "2026-06-01T00:00:00.000Z",
    })).toBeNull();

    upsertConfigEntry(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      configValue: { enabled: true, offsetsHours: [48] },
      changeReason: "Activate test config.",
      now: "2026-06-01T00:00:00.000Z",
    });

    expect(getEffectiveConfigValue(testDb.db, {
      module: "notification",
      configKey: "deadline_reminders",
      now: "2026-06-01T00:00:00.000Z",
    })?.configValue).toEqual({ enabled: true, offsetsHours: [48] });
  });

  it("prefers organization scoped config over global config", () => {
    upsertConfigEntry(testDb.db, {
      module: "source",
      configKey: "approval_defaults",
      configValue: { approvalStatus: "needs_review" },
      changeReason: "Global source default.",
      now: "2026-06-01T00:00:00.000Z",
    });
    upsertConfigEntry(testDb.db, {
      scopeType: "organization",
      scopeId: "org_1",
      module: "source",
      configKey: "approval_defaults",
      configValue: { approvalStatus: "approved" },
      changeReason: "Organization source approval override.",
      now: "2026-06-01T00:01:00.000Z",
    });

    expect(getEffectiveConfigValue(testDb.db, {
      module: "source",
      configKey: "approval_defaults",
      organizationId: "org_1",
      now: "2026-06-01T00:02:00.000Z",
    })?.configValue).toEqual({ approvalStatus: "approved" });
  });

  it("rejects unsupported module/key pairs and missing change reasons", () => {
    expect(() =>
      upsertConfigEntry(testDb.db, {
        module: "source",
        configKey: "unknown_key",
        configValue: {},
        changeReason: "Nope.",
      }),
    ).toThrow(ConfigRegistryValidationError);

    expect(() =>
      upsertConfigEntry(testDb.db, {
        module: "source",
        configKey: "approval_defaults",
        configValue: {},
        changeReason: "  ",
      }),
    ).toThrow(ConfigRegistryValidationError);
  });

  it("runs the MySQL config registry lifecycle", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const mysql = {
      execute: async (sql: string, values: unknown[] = []) => {
        if (sql.includes("INSERT INTO config_registry")) {
          rows.set(values[0] as string, {
            id: values[0],
            scope_type: values[1],
            scope_id: values[2],
            module: values[3],
            config_key: values[4],
            config_value_json: values[5],
            schema_version: values[6],
            status: values[7],
            effective_from: values[8],
            effective_to: values[9],
            created_by: values[10],
            updated_by: values[11],
            change_reason: values[12],
            audit_event_id: values[13],
            created_at: values[14],
            updated_at: values[15],
          });
        }

        if (sql.includes("UPDATE config_registry")) {
          const row = rows.get(values.at(-1) as string);
          if (row) {
            row.scope_type = values[0];
            row.scope_id = values[1];
            row.module = values[2];
            row.config_key = values[3];
            row.config_value_json = values[4];
            row.schema_version = values[5];
            row.status = values[6];
            row.effective_from = values[7];
            row.effective_to = values[8];
            row.updated_by = values[9];
            row.change_reason = values[10];
            row.audit_event_id = values[11];
            row.updated_at = values[12];
          }
        }

        return [{ affectedRows: 1 }, undefined];
      },
      query: async (sql: string, values: unknown[] = []) => {
        const allRows = [...rows.values()];

        if (sql.includes("WHERE id = ?")) {
          return [[allRows.find((row) => row.id === values[0])].filter(Boolean), undefined];
        }

        if (sql.includes("COALESCE(scope_id")) {
          return [[allRows.find((row) =>
            row.scope_type === values[0] &&
            (row.scope_id ?? "") === (values[1] ?? "") &&
            row.module === values[2] &&
            row.config_key === values[3],
          )].filter(Boolean), undefined];
        }

        if (sql.includes("status = 'active'")) {
          return [
            allRows
              .filter((row) => row.module === values[0] && row.config_key === values[1] && row.status === "active")
              .filter((row) => row.scope_type === "global" || row.scope_id === values[2])
              .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))),
            undefined,
          ];
        }

        return [allRows.sort((left, right) => `${left.module}:${left.config_key}`.localeCompare(`${right.module}:${right.config_key}`)), undefined];
      },
    };

    const global = await upsertConfigEntryFromMysql(mysql, {
      module: "source",
      configKey: "approval_defaults",
      configValue: { approvalStatus: "needs_review" },
      changeReason: "Seed MySQL config.",
      now: "2026-06-01T00:00:00.000Z",
    });
    const organization = await upsertConfigEntryFromMysql(mysql, {
      scopeType: "organization",
      scopeId: "org_1",
      module: "source",
      configKey: "approval_defaults",
      configValue: { approvalStatus: "approved" },
      changeReason: "Override MySQL config.",
      auditEventId: "event_1",
      now: "2026-06-01T00:01:00.000Z",
    });

    expect(global.configValue).toEqual({ approvalStatus: "needs_review" });
    expect(organization).toMatchObject({
      scopeType: "organization",
      scopeId: "org_1",
      auditEventId: "event_1",
    });
    await expect(listConfigEntriesFromMysql(mysql, { module: "source" })).resolves.toHaveLength(2);
    await expect(getEffectiveConfigValueFromMysql(mysql, {
      module: "source",
      configKey: "approval_defaults",
      organizationId: "org_1",
      now: "2026-06-01T00:02:00.000Z",
    })).resolves.toMatchObject({
      id: organization.id,
      configValue: { approvalStatus: "approved" },
    });
  });
});
