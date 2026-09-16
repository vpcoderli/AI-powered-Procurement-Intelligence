/**
 * robots.txt compliance over the *runtime* source registry (`data_sources`), not the two
 * hardcoded state-definition files.
 *
 * The state definitions only ever covered the 50 state portals; every county/city source
 * registered since the 2026-07-31 expansion was invisible to `source:compliance:scan`, which is
 * exactly the population the local-source approval workflow needs robots evidence for. This
 * module builds the scan input from `data_sources` on both dialects and writes each verdict
 * back onto the row (`robots_txt_*`) so the admin console and the compliance ledger can read it.
 */

import { eq } from "drizzle-orm";
import { recordSourcePrecheck, recordSourcePrecheckFromMysql } from "@/server/admin/data-sources-repository";
import type { MysqlDataSourcesStore } from "@/server/admin/data-sources-repository";
import type { AppDatabase } from "@/server/db/client";
import { mysqlSelectMany } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import type { SourceComplianceInput, SourceComplianceReport } from "./robots-compliance-scan";

interface DataSourceComplianceRow {
  id: string;
  stateCode: string;
  label: string;
  baseUrl: string | null;
}

function toComplianceInput(row: DataSourceComplianceRow): SourceComplianceInput {
  return {
    id: row.id,
    stateCode: row.stateCode,
    label: row.label,
    baseUrl: row.baseUrl ?? null,
  };
}

/** Every enabled source — state, county, city and special district alike. */
export function listDataSourceComplianceInputs(db: AppDatabase): SourceComplianceInput[] {
  return db
    .select({
      id: dataSources.id,
      stateCode: dataSources.stateCode,
      label: dataSources.label,
      baseUrl: dataSources.baseUrl,
    })
    .from(dataSources)
    .where(eq(dataSources.isEnabled, 1))
    .orderBy(dataSources.id)
    .all()
    .map(toComplianceInput);
}

export async function listDataSourceComplianceInputsFromMysql(
  mysql: MysqlDataSourcesStore,
): Promise<SourceComplianceInput[]> {
  const rows = await mysqlSelectMany<DataSourceComplianceRow>(
    mysql,
    `
      SELECT
        id,
        state_code AS stateCode,
        label,
        base_url AS baseUrl
      FROM data_sources
      WHERE is_enabled = 1
      ORDER BY id
    `,
  );

  return rows.map(toComplianceInput);
}

function robotsWriteBack(result: SourceComplianceReport["results"][number]) {
  return {
    robots: {
      status: result.status,
      checkedAt: result.checkedAt,
      hash: result.robotsTxtHash,
      disallowsCrawledPaths: result.disallowsCrawledPaths,
      flagReason: result.flagReason,
    },
  };
}

/**
 * Writes each scanned source's robots verdict onto its `data_sources` row. Results whose
 * `sourceId` is not a `data_sources` id (e.g. a scan of the state definition registry) are
 * skipped rather than failing the run — the scan itself is still reported in full.
 */
export function applyRobotsComplianceToDataSources(db: AppDatabase, report: SourceComplianceReport): number {
  let written = 0;

  for (const result of report.results) {
    try {
      recordSourcePrecheck(db, result.sourceId, robotsWriteBack(result));
      written += 1;
    } catch {
      // Unknown id: nothing to write back to.
    }
  }

  return written;
}

export async function applyRobotsComplianceToDataSourcesFromMysql(
  mysql: MysqlDataSourcesStore,
  report: SourceComplianceReport,
): Promise<number> {
  let written = 0;

  for (const result of report.results) {
    try {
      await recordSourcePrecheckFromMysql(mysql, result.sourceId, robotsWriteBack(result));
      written += 1;
    } catch {
      // Unknown id: nothing to write back to.
    }
  }

  return written;
}
