import type { AppDatabase } from "@/server/db/client";
import { configRegistry } from "@/server/db/schema";

export type ConfigScopeType = "global" | "organization";
export type ConfigStatus = "active" | "inactive" | "draft";
export type ConfigModule =
  | "feature"
  | "plan"
  | "workflow"
  | "source"
  | "notification"
  | "ai"
  | "ux_state"
  | "dashboard";

export interface ConfigRegistryEntry {
  id: string;
  scopeType: ConfigScopeType;
  scopeId: string | null;
  module: ConfigModule;
  configKey: string;
  configValue: unknown;
  schemaVersion: number;
  status: ConfigStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  changeReason: string;
  auditEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListConfigEntriesOptions {
  scopeType?: ConfigScopeType;
  scopeId?: string | null;
  module?: ConfigModule;
  configKey?: string;
  status?: ConfigStatus;
}

export interface UpsertConfigEntryInput {
  scopeType?: ConfigScopeType;
  scopeId?: string | null;
  module: ConfigModule;
  configKey: string;
  configValue: unknown;
  schemaVersion?: number;
  status?: ConfigStatus;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  actorUserId?: string | null;
  changeReason: string;
  auditEventId?: string | null;
  now?: string;
}

export class ConfigRegistryNotFoundError extends Error {
  code = "CONFIG_NOT_FOUND" as const;

  constructor(message = "Config entry was not found.") {
    super(message);
    this.name = "ConfigRegistryNotFoundError";
  }
}

export class ConfigRegistryValidationError extends Error {
  code = "INVALID_CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConfigRegistryValidationError";
  }
}

const allowedKeysByModule: Record<ConfigModule, ReadonlySet<string>> = {
  feature: new Set(["entitlements", "quota_limits", "feature_flags"]),
  plan: new Set(["catalog", "credit_allowances", "checkout_visibility"]),
  workflow: new Set(["intent_statuses", "response_item_statuses", "submission_readiness"]),
  source: new Set(["approval_defaults", "health_statuses", "crawler_schedule"]),
  notification: new Set(["digest_defaults", "deadline_reminders", "provider_policy"]),
  ai: new Set(["confidence_thresholds", "fallback_policy", "prompt_guardrails"]),
  ux_state: new Set(["copy_library", "coverage_matrix", "severity_map"]),
  dashboard: new Set(["admin_summary", "user_home", "risk_check_visibility"]),
};

export const defaultConfigEntries: UpsertConfigEntryInput[] = [
  {
    module: "source",
    configKey: "approval_defaults",
    configValue: {
      approvedForIngestion: false,
      approvalStatus: "needs_review",
      legalReviewStatus: "not_reviewed",
    },
    changeReason: "Seed safe default source approval policy.",
  },
  {
    module: "ux_state",
    configKey: "severity_map",
    configValue: {
      loading: "info",
      empty: "info",
      error: "error",
      permission_denied: "blocking",
      ai_unavailable: "warning",
      low_confidence: "warning",
      upload_failed: "error",
      source_unavailable: "warning",
      duplicate_opportunity: "warning",
      expired_deadline: "blocking",
      plan_limit: "blocking",
    },
    changeReason: "Seed universal UX state severity defaults.",
  },
  {
    module: "notification",
    configKey: "deadline_reminders",
    configValue: {
      enabled: true,
      offsetsHours: [168, 72, 24],
    },
    changeReason: "Seed default deadline reminder offsets.",
  },
];

function assertValidScope(scopeType: ConfigScopeType, scopeId: string | null | undefined) {
  if (scopeType === "global" && scopeId) {
    throw new ConfigRegistryValidationError("Global config entries must not include scopeId.");
  }

  if (scopeType === "organization" && !scopeId) {
    throw new ConfigRegistryValidationError("Organization config entries require scopeId.");
  }
}

function assertValidModuleKey(module: ConfigModule, configKey: string) {
  if (!Object.hasOwn(allowedKeysByModule, module)) {
    throw new ConfigRegistryValidationError("Config module is not supported.");
  }

  if (!allowedKeysByModule[module].has(configKey)) {
    throw new ConfigRegistryValidationError("Config key is not supported for this module.");
  }
}

function assertValidStatus(status: ConfigStatus) {
  if (status !== "active" && status !== "inactive" && status !== "draft") {
    throw new ConfigRegistryValidationError("Config status is not supported.");
  }
}

function parseEntry(row: Record<string, unknown>): ConfigRegistryEntry {
  return {
    id: String(row.id),
    scopeType: row.scope_type as ConfigScopeType,
    scopeId: (row.scope_id as string | null) ?? null,
    module: row.module as ConfigModule,
    configKey: String(row.config_key),
    configValue: JSON.parse(String(row.config_value_json || "{}")),
    schemaVersion: Number(row.schema_version ?? 1),
    status: row.status as ConfigStatus,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    effectiveTo: (row.effective_to as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    updatedBy: (row.updated_by as string | null) ?? null,
    changeReason: String(row.change_reason ?? ""),
    auditEventId: (row.audit_event_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function getConfigEntryById(db: AppDatabase, id: string): ConfigRegistryEntry | null {
  const row = db.$client.prepare("SELECT * FROM config_registry WHERE id = ?").get(id);
  return row ? parseEntry(row as Record<string, unknown>) : null;
}

export function listConfigEntries(db: AppDatabase, options: ListConfigEntriesOptions = {}): ConfigRegistryEntry[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.scopeType) {
    clauses.push("scope_type = ?");
    params.push(options.scopeType);
  }

  if (options.scopeId !== undefined) {
    if (options.scopeId === null) {
      clauses.push("scope_id IS NULL");
    } else {
      clauses.push("scope_id = ?");
      params.push(options.scopeId);
    }
  }

  if (options.module) {
    clauses.push("module = ?");
    params.push(options.module);
  }

  if (options.configKey) {
    clauses.push("config_key = ?");
    params.push(options.configKey);
  }

  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.$client
    .prepare(`SELECT * FROM config_registry ${where} ORDER BY module, config_key, scope_type, scope_id, updated_at DESC`)
    .all(...params)
    .map((row) => parseEntry(row as Record<string, unknown>));
}

export function getEffectiveConfigValue(
  db: AppDatabase,
  input: {
    module: ConfigModule;
    configKey: string;
    organizationId?: string | null;
    now?: string;
  },
): ConfigRegistryEntry | null {
  assertValidModuleKey(input.module, input.configKey);
  const now = input.now ?? new Date().toISOString();
  const scopeClauses = input.organizationId
    ? "(scope_type = 'organization' AND scope_id = ?) OR (scope_type = 'global' AND scope_id IS NULL)"
    : "scope_type = 'global' AND scope_id IS NULL";
  const scopeParams = input.organizationId ? [input.organizationId] : [];

  const row = db.$client
    .prepare(`
      SELECT *
      FROM config_registry
      WHERE module = ?
        AND config_key = ?
        AND status = 'active'
        AND (${scopeClauses})
        AND (effective_from IS NULL OR effective_from <= ?)
        AND (effective_to IS NULL OR effective_to > ?)
      ORDER BY
        CASE scope_type WHEN 'organization' THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
    `)
    .get(input.module, input.configKey, ...scopeParams, now, now);

  return row ? parseEntry(row as Record<string, unknown>) : null;
}

export function upsertConfigEntry(db: AppDatabase, input: UpsertConfigEntryInput): ConfigRegistryEntry {
  const scopeType = input.scopeType ?? "global";
  const scopeId = input.scopeId ?? null;
  const status = input.status ?? "active";
  const now = input.now ?? new Date().toISOString();
  const changeReason = input.changeReason.trim();

  assertValidScope(scopeType, scopeId);
  assertValidModuleKey(input.module, input.configKey);
  assertValidStatus(status);

  if (!changeReason) {
    throw new ConfigRegistryValidationError("Config changes require a change reason.");
  }

  const existing = db.$client
    .prepare(`
      SELECT *
      FROM config_registry
      WHERE scope_type = ?
        AND COALESCE(scope_id, '') = COALESCE(?, '')
        AND module = ?
        AND config_key = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
    .get(scopeType, scopeId, input.module, input.configKey) as Record<string, unknown> | undefined;

  const id = existing ? String(existing.id) : `cfg_${crypto.randomUUID()}`;
  const createdAt = existing ? String(existing.created_at) : now;
  const createdBy = existing ? ((existing.created_by as string | null) ?? null) : (input.actorUserId ?? null);

  db.insert(configRegistry)
    .values({
      id,
      scopeType,
      scopeId,
      module: input.module,
      configKey: input.configKey,
      configValueJson: JSON.stringify(input.configValue),
      schemaVersion: input.schemaVersion ?? 1,
      status,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      createdBy,
      updatedBy: input.actorUserId ?? null,
      changeReason,
      auditEventId: input.auditEventId ?? null,
      createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: configRegistry.id,
      set: {
        scopeType,
        scopeId,
        module: input.module,
        configKey: input.configKey,
        configValueJson: JSON.stringify(input.configValue),
        schemaVersion: input.schemaVersion ?? 1,
        status,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveTo: input.effectiveTo ?? null,
        updatedBy: input.actorUserId ?? null,
        changeReason,
        auditEventId: input.auditEventId ?? null,
        updatedAt: now,
      },
    })
    .run();

  return listConfigEntries(db, { scopeType, scopeId, module: input.module, configKey: input.configKey })[0];
}

export function seedDefaultConfigEntries(db: AppDatabase, now = new Date().toISOString()) {
  for (const entry of defaultConfigEntries) {
    const existing = getEffectiveConfigValue(db, {
      module: entry.module,
      configKey: entry.configKey,
      now,
    });

    if (!existing) {
      upsertConfigEntry(db, { ...entry, now });
    }
  }
}
