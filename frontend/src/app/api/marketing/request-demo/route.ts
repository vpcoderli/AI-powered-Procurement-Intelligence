import { NextResponse } from "next/server";
import type { AppDatabase } from "@/server/db/client";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import {
  recordRequestDemoLead,
  recordRequestDemoLeadFromMysql,
  type RequestDemoLeadInput,
} from "@/server/marketing/funnel";
import { queueRequestDemoLeadOperations, queueRequestDemoLeadOperationsFromMysql } from "@/server/marketing/ops";

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

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseServiceStates(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 20);
}

function parseLanguage(value: unknown): "en" | "zh" | undefined {
  return value === "en" || value === "zh" ? value : undefined;
}

function hasHoneypotSignal(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const input = body as Record<string, unknown>;
  return ["websiteUrl", "homepageUrl", "contactUrl"].some((key) => typeof input[key] === "string" && input[key].trim());
}

function parseLeadInput(body: unknown, request: Request): RequestDemoLeadInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }

  const input = body as Record<string, unknown>;
  const email = trimString(input.email, 254);
  const companyName = trimString(input.companyName, 160);

  if (!email || !isValidEmail(email) || !companyName) {
    return null;
  }

  return {
    email,
    companyName,
    fullName: trimString(input.fullName, 120),
    role: trimString(input.role, 80),
    serviceStates: parseServiceStates(input.serviceStates),
    notes: trimString(input.notes, 1000),
    language: parseLanguage(input.language),
    sourcePath: new URL(request.url).pathname,
  };
}

export function createMarketingRequestDemoPost(database?: AppDatabase) {
  return async function POST(request: Request) {
    const body = await readBody(request);

    if (hasHoneypotSignal(body)) {
      return errorResponse("SPAM_REJECTED", "Request demo submission was rejected.", 400);
    }

    const input = parseLeadInput(body, request);

    if (!input) {
      return errorResponse("INVALID_REQUEST", "Request demo body must include a valid email and company name.", 400);
    }

    try {
      let lead;
      if (isMysqlDatabaseUrlConfigured() && !database) {
        const mysql = resolveMysqlPool();
        lead = await recordRequestDemoLeadFromMysql(mysql, input);
        await queueRequestDemoLeadOperationsFromMysql(mysql, { lead, leadInput: input });
      } else {
        const runtimeDb = database ?? db;
        lead = recordRequestDemoLead(runtimeDb, input);
        queueRequestDemoLeadOperations(runtimeDb, { lead, leadInput: input });
      }

      return NextResponse.json({ lead }, { status: 201 });
    } catch {
      return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
    }
  };
}

export const POST = createMarketingRequestDemoPost();
