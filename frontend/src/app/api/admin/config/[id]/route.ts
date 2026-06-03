import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  ConfigRegistryNotFoundError,
  ConfigRegistryValidationError,
  getConfigEntryById,
  getConfigEntryByIdFromMysql,
  upsertConfigEntry,
  upsertConfigEntryFromMysql,
  type ConfigStatus,
} from "@/server/config/registry";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { writeAuditEvent, writeAuditEventFromMysql } from "@/server/events/event-log";
import { createRequestContext } from "@/server/http/request-context";

interface RouteContext {
  params: Promise<{ id: string }>;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function routeError(error: unknown) {
  if (error instanceof AdminAuthError) {
    return errorResponse(error.code, error.message, error.status);
  }

  if (error instanceof ConfigRegistryValidationError) {
    return errorResponse(error.code, error.message, 400);
  }

  if (error instanceof ConfigRegistryNotFoundError) {
    return errorResponse(error.code, error.message, 404);
  }

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

function parseStatus(value: unknown): ConfigStatus | undefined | null {
  if (value === undefined) return undefined;
  if (value === "active" || value === "inactive" || value === "draft") return value;
  return null;
}

function actorUserId(principal: Awaited<ReturnType<typeof requireAdminAccess>>) {
  return principal.kind === "admin" ? principal.userId : null;
}

function actorType(principal: Awaited<ReturnType<typeof requireAdminAccess>>) {
  return principal.kind === "admin" ? "admin" : "system";
}

function actorRole(principal: Awaited<ReturnType<typeof requireAdminAccess>>) {
  return principal.kind === "admin" ? principal.role : "local-bypass";
}

async function requireAdminConfigAccess(db: AppDatabase, request: Request, targetId: string) {
  try {
    return await requireAdminAccess(db, request, { roles: ["admin"] });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      const auditInput = {
        eventName: "admin.config.access_denied",
        actorType: "system" as const,
        actorRole: "anonymous",
        targetType: "config",
        targetId,
        source: "admin.config",
        outcome: "denied" as const,
        severity: "warning" as const,
        requestContext: createRequestContext(request),
        metadata: {
          method: request.method,
          path: new URL(request.url).pathname,
        },
      };

      if (isMysqlDatabaseUrlConfigured()) {
        await writeAuditEventFromMysql(resolveMysqlPool(), auditInput);
      } else {
        writeAuditEvent(db, auditInput);
      }
    }

    throw error;
  }
}

async function parsePatchBody(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.changeReason !== "string") return null;
  const status = parseStatus(body.status);
  if (status === null) return null;

  return {
    hasConfigValue: Object.hasOwn(body, "configValue"),
    configValue: body.configValue,
    status,
    effectiveFrom: typeof body.effectiveFrom === "string" ? body.effectiveFrom : undefined,
    effectiveTo: typeof body.effectiveTo === "string" ? body.effectiveTo : undefined,
    changeReason: body.changeReason,
  };
}

export function createAdminConfigPatch(database?: AppDatabase) {
  const shouldUseMysqlRuntime = () => !database && isMysqlDatabaseUrlConfigured();

  return async function PATCH(request: Request, context: RouteContext) {
    try {
      const resolvedDb = await resolveDatabase(database);
      const { id } = await context.params;
      const principal = await requireAdminConfigAccess(resolvedDb, request, id);

      const input = await parsePatchBody(request);
      if (!input) {
        return errorResponse("INVALID_REQUEST", "Config patch body is invalid.", 400);
      }

      if (shouldUseMysqlRuntime()) {
        const mysql = resolveMysqlPool();
        const existing = await getConfigEntryByIdFromMysql(mysql, id);
        if (!existing) {
          throw new ConfigRegistryNotFoundError();
        }

        const entry = await upsertConfigEntryFromMysql(mysql, {
          scopeType: existing.scopeType,
          scopeId: existing.scopeId,
          module: existing.module,
          configKey: existing.configKey,
          configValue: input.hasConfigValue ? input.configValue : existing.configValue,
          schemaVersion: existing.schemaVersion,
          status: input.status ?? existing.status,
          effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
          effectiveTo: input.effectiveTo ?? existing.effectiveTo,
          actorUserId: actorUserId(principal),
          changeReason: input.changeReason,
          auditEventId: existing.auditEventId,
        });
        const event = await writeAuditEventFromMysql(mysql, {
          eventName: "admin.config.updated",
          actorType: actorType(principal),
          actorId: actorUserId(principal),
          actorRole: actorRole(principal),
          targetType: "config",
          targetId: entry.id,
          outcome: "success",
          severity: "info",
          requestContext: createRequestContext(request),
          metadata: {
            module: entry.module,
            configKey: entry.configKey,
            scopeType: entry.scopeType,
            scopeId: entry.scopeId,
            status: entry.status,
          },
          beforeAfter: {
            before: {
              configValue: existing.configValue,
              status: existing.status,
              effectiveFrom: existing.effectiveFrom,
              effectiveTo: existing.effectiveTo,
            },
            after: {
              configValue: entry.configValue,
              status: entry.status,
              effectiveFrom: entry.effectiveFrom,
              effectiveTo: entry.effectiveTo,
            },
          },
        });

        const linkedEntry = await upsertConfigEntryFromMysql(mysql, {
          scopeType: existing.scopeType,
          scopeId: existing.scopeId,
          module: existing.module,
          configKey: existing.configKey,
          configValue: entry.configValue,
          schemaVersion: existing.schemaVersion,
          status: entry.status,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
          actorUserId: actorUserId(principal),
          changeReason: entry.changeReason,
          auditEventId: event.id,
        });

        return NextResponse.json({ entry: linkedEntry });
      }

      const linkedEntry = resolvedDb.$client.transaction(() => {
        const existing = getConfigEntryById(resolvedDb, id);
        if (!existing) {
          throw new ConfigRegistryNotFoundError();
        }

        const entry = upsertConfigEntry(resolvedDb, {
          scopeType: existing.scopeType,
          scopeId: existing.scopeId,
          module: existing.module,
          configKey: existing.configKey,
          configValue: input.hasConfigValue ? input.configValue : existing.configValue,
          schemaVersion: existing.schemaVersion,
          status: input.status ?? existing.status,
          effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
          effectiveTo: input.effectiveTo ?? existing.effectiveTo,
          actorUserId: actorUserId(principal),
          changeReason: input.changeReason,
          auditEventId: existing.auditEventId,
        });
        const event = writeAuditEvent(resolvedDb, {
          eventName: "admin.config.updated",
          actorType: actorType(principal),
          actorId: actorUserId(principal),
          actorRole: actorRole(principal),
          targetType: "config",
          targetId: entry.id,
          outcome: "success",
          severity: "info",
          requestContext: createRequestContext(request),
          metadata: {
            module: entry.module,
            configKey: entry.configKey,
            scopeType: entry.scopeType,
            scopeId: entry.scopeId,
            status: entry.status,
          },
          beforeAfter: {
            before: {
              configValue: existing.configValue,
              status: existing.status,
              effectiveFrom: existing.effectiveFrom,
              effectiveTo: existing.effectiveTo,
            },
            after: {
              configValue: entry.configValue,
              status: entry.status,
              effectiveFrom: entry.effectiveFrom,
              effectiveTo: entry.effectiveTo,
            },
          },
        });

        return upsertConfigEntry(resolvedDb, {
          scopeType: existing.scopeType,
          scopeId: existing.scopeId,
          module: existing.module,
          configKey: existing.configKey,
          configValue: entry.configValue,
          schemaVersion: existing.schemaVersion,
          status: entry.status,
          effectiveFrom: entry.effectiveFrom,
          effectiveTo: entry.effectiveTo,
          actorUserId: actorUserId(principal),
          changeReason: entry.changeReason,
          auditEventId: event.id,
        });
      })();

      return NextResponse.json({ entry: linkedEntry });
    } catch (error) {
      return routeError(error);
    }
  };
}

export const PATCH = createAdminConfigPatch();
