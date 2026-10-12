import { NextResponse } from "next/server";
import { AdminAuthError, requireAdminAccess } from "@/server/admin/auth";
import type { AppDatabase } from "@/server/db/client";
import { isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "@/server/db/mysql";
import { createSourceDataQualityReport, createSourceDataQualityReportFromMysql, type MysqlSourceDataQualityReader } from "@/server/source-validity/source-data-quality";

export function createAdminSourceDataQualityGet(dependencies: { database?: AppDatabase; mysql?: MysqlSourceDataQualityReader } = {}) {
  return async function GET(request: Request) {
    try {
      const mysql = dependencies.mysql ?? (isMysqlDatabaseUrlConfigured() ? resolveMysqlPool() : undefined);
      const database = dependencies.database ?? (mysql ? {} as AppDatabase : (await import("@/server/db/client")).db);
      await requireAdminAccess(database, request, { roles: ["admin", "operator", "support"] });
      const report = mysql ? await createSourceDataQualityReportFromMysql(mysql) : await createSourceDataQualityReport(database);
      return NextResponse.json({ report });
    } catch (error) {
      return error instanceof AdminAuthError
        ? NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
        : NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 });
    }
  };
}
export const GET = createAdminSourceDataQualityGet();
