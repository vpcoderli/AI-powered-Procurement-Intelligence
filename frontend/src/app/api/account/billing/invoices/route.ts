import { NextResponse } from "next/server";
import { readSessionToken } from "@/server/auth/session";
import { getSessionUser } from "@/server/auth/service";
import { getMysqlSessionUser } from "@/server/auth/mysql-service";
import {
  InvalidSubscriptionInputError,
  isBillingInvoiceStatus,
  listAccountInvoices,
} from "@/server/billing/subscriptions";
import { listMysqlAccountInvoices } from "@/server/billing/mysql-subscriptions";
import { db } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function GET(request: Request) {
  const sessionToken = readSessionToken(request);

  if (!sessionToken) {
    return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
  }

  try {
    const mysql = isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : null;
    const sessionUser = mysql
      ? await getMysqlSessionUser(mysql, sessionToken)
      : await getSessionUser(db, sessionToken);

    if (!sessionUser) {
      return errorResponse("AUTH_REQUIRED", "Authentication is required", 401);
    }

    const status = new URL(request.url).searchParams.get("status");

    if (status && !isBillingInvoiceStatus(status)) {
      return errorResponse("INVALID_REQUEST", "Invalid invoice status filter", 400);
    }

    return NextResponse.json(
      mysql
        ? await listMysqlAccountInvoices(mysql, sessionUser.id, status && isBillingInvoiceStatus(status) ? { status } : {})
        : listAccountInvoices(db, sessionUser.id, status && isBillingInvoiceStatus(status) ? { status } : {}),
    );
  } catch (error) {
    if (error instanceof InvalidSubscriptionInputError) {
      return errorResponse("INVALID_REQUEST", error.message, 400);
    }

    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
}
