import { NextResponse } from "next/server";
import type { AppDatabase } from "@/server/db/client";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  recordMarketingFunnelEvent,
  recordMarketingFunnelEventFromMysql,
} from "@/server/marketing/funnel";

type MarketingIntent = "demo" | "start_free";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function trimString(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  return trimmed.slice(0, maxLength);
}

function parseMarketingIntent(value: unknown): MarketingIntent | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "demo" || value === "start_free") return value;

  return null;
}

function parseLanguage(value: unknown): "en" | "zh" | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

function parseSignupStartInput(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const marketingIntent = parseMarketingIntent(record.marketingIntent);
  if (marketingIntent === null) return null;

  const leadEventId = trimString(record.leadEventId, 160);
  const sourcePath = trimString(record.sourcePath, 160) ?? "/register";

  return {
    marketingIntent,
    leadEventId,
    language: parseLanguage(record.language),
    sourcePath,
  };
}

export function createMarketingSignupStartPost(database?: AppDatabase) {
  return async function POST(request: Request) {
    const body = await readBody(request);
    const input = parseSignupStartInput(body);

    if (!input) {
      return errorResponse("INVALID_REQUEST", "Signup start body is invalid.", 400);
    }

    try {
      const eventInput = {
        eventName: "marketing.start_signup" as const,
        targetType: "marketing_lead",
        targetId: input.leadEventId ?? null,
        source: "marketing.signup-start",
        idempotencyKey: input.leadEventId ? `marketing:start_signup:${input.leadEventId}` : null,
        metadata: {
          marketingIntent: input.marketingIntent ?? "start_free",
          leadEventId: input.leadEventId ?? null,
          language: input.language ?? "en",
          sourcePath: input.sourcePath,
        },
      };
      const event = isMysqlDatabaseUrlConfigured() && !database
        ? await recordMarketingFunnelEventFromMysql(resolveMysqlPool(), eventInput)
        : recordMarketingFunnelEvent(database ?? db, eventInput);

      return NextResponse.json({ event: { id: event.id } }, { status: 201 });
    } catch {
      return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
    }
  };
}

export const POST = createMarketingSignupStartPost();
