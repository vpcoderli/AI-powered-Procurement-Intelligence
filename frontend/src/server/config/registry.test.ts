import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import {
  ConfigRegistryValidationError,
  getEffectiveConfigValue,
  listConfigEntries,
  seedDefaultConfigEntries,
  upsertConfigEntry,
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
});
