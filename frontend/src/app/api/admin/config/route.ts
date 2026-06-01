import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import {
  ConfigRegistryValidationError,
  listConfigEntries,
  upsertConfigEntry,
  type ConfigModule,
  type ConfigScopeType,
  type ConfigStatus,
} from "@/server/config/registry";
import type { AppDatabase } from "@/server/db/client";
import { writeAuditEvent } from "@/server/events/event-log";
import { createRequestContext } from "@/server/http/request-context";

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

  return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
}

async function resolveDatabase(database?: AppDatabase) {
  if (database) return database;

  const client = await import("@/server/db/client");
  return client.db;
}

function parseScopeType(value: string | null): ConfigScopeType | undefined | null {
  if (!value) return undefined;
  if (value === "global" || value === "organization") return value;
  return null;
}

function parseModule(value: string | null): ConfigModule | undefined {
  if (
    value === "feature" ||
    value === "plan" ||
    value === "workflow" ||
    value === "source" ||
    value === "notification" ||
    value === "ai" ||
    value === "ux_state" ||
    value === "dashboard"
  ) {
    return value;
  }

  return undefined;
}

function parseStatus(value: string | null): ConfigStatus | undefined | null {
  if (!value) return undefined;
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

async function requireAdminConfigAccess(db: AppDatabase, request: Request) {
  try {
    return await requireAdminAccess(db, request, { roles: ["admin"] });
  } catch (error) {
    if (error instanceof AdminAuthError) {
      writeAuditEvent(db, {
        eventName: "admin.config.access_denied",
        actorType: "system",
        actorRole: "anonymous",
        targetType: "config",
        source: "admin.config",
        outcome: "denied",
        severity: "warning",
        requestContext: createRequestContext(request),
        metadata: {
          method: request.method,
          path: new URL(request.url).pathname,
        },
      });
    }

    throw error;
  }
}

async function parsePostBody(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  if (typeof body.module !== "string" || typeof body.configKey !== "string") return null;
  if (!Object.hasOwn(body, "configValue") || typeof body.changeReason !== "string") return null;

  const configModule = parseModule(body.module);
  const status = typeof body.status === "string" ? parseStatus(body.status) : undefined;
  const scopeType = typeof body.scopeType === "string" ? parseScopeType(body.scopeType) : undefined;
  if (!configModule || status === null || scopeType === null) return null;

  return {
    scopeType,
    scopeId: typeof body.scopeId === "string" ? body.scopeId : null,
    module: configModule,
    configKey: body.configKey,
    configValue: body.configValue,
    schemaVersion: typeof body.schemaVersion === "number" ? body.schemaVersion : undefined,
    status,
    effectiveFrom: typeof body.effectiveFrom === "string" ? body.effectiveFrom : null,
    effectiveTo: typeof body.effectiveTo === "string" ? body.effectiveTo : null,
    changeReason: body.changeReason,
  };
}

export function createAdminConfigHandlers(database?: AppDatabase) {
  return {
    GET: async function GET(request: Request) {
      try {
        const resolvedDb = await resolveDatabase(database);
        await requireAdminConfigAccess(resolvedDb, request);

        const params = new URL(request.url).searchParams;
        const scopeType = parseScopeType(params.get("scopeType"));
        const configModule = parseModule(params.get("module"));
        const status = parseStatus(params.get("status"));
        if (scopeType === null || status === null || (params.get("module") && !configModule)) {
          return errorResponse("INVALID_REQUEST", "Config filters are invalid.", 400);
        }

        return NextResponse.json({
          entries: listConfigEntries(resolvedDb, {
            scopeType,
            scopeId: params.has("scopeId") ? params.get("scopeId") : undefined,
            module: configModule,
            configKey: params.get("configKey") ?? undefined,
            status,
          }),
        });
      } catch (error) {
        return routeError(error);
      }
    },
    POST: async function POST(request: Request) {
      try {
        const resolvedDb = await resolveDatabase(database);
        const principal = await requireAdminConfigAccess(resolvedDb, request);
        const input = await parsePostBody(request);
        if (!input) {
          return errorResponse("INVALID_REQUEST", "Config request body is invalid.", 400);
        }

        const linkedEntry = resolvedDb.$client.transaction(() => {
          const entry = upsertConfigEntry(resolvedDb, {
            ...input,
            actorUserId: actorUserId(principal),
          });
          const event = writeAuditEvent(resolvedDb, {
            eventName: "admin.config.upserted",
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
          });

          return upsertConfigEntry(resolvedDb, {
            ...input,
            actorUserId: actorUserId(principal),
            auditEventId: event.id,
          });
        })();

        return NextResponse.json({
          entry: linkedEntry,
        });
      } catch (error) {
        return routeError(error);
      }
    },
  };
}

const handlers = createAdminConfigHandlers();

export const GET = handlers.GET;
export const POST = handlers.POST;
