import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { mysqlExecute } from "../src/server/db/mysql-runtime";
import { runMigrations } from "../src/server/db/migrate";
import { dataSources } from "../src/server/db/schema";
import { fipsForStateCode } from "../src/lib/state-fips";
import { STATE_CRAWLER_SOURCE_DEFINITIONS } from "../src/lib/state-crawler-sources";

export interface SourceRegistryRow {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string;
  jurisdictionLevel: string;
  jurisdictionName: string;
  fipsCode: string;
  fetchConfig: string;
  providerFamily: string | null;
}

/** BidNet Direct 托管的州源,provider_family 归入 bidnet 共享适配器。 */
const BIDNET_HOSTED = /bidnetdirect\.com/i;

/** 有专用适配器的源不设 provider_family——解析链会优先命中 DEDICATED_ADAPTERS。 */
const DEDICATED_SOURCE_IDS = new Set([
  "ca_caleprocure",
  "tx_esbd",
  "ny_contract_reporter",
  "fl_mfmp",
  "il_bidbuy",
]);

function providerFamilyFor(id: string, baseUrl: string): string | null {
  if (DEDICATED_SOURCE_IDS.has(id)) return null;
  if (BIDNET_HOSTED.test(baseUrl)) return "bidnet";
  return "generic";
}

export function buildSourceRegistryRows(): SourceRegistryRow[] {
  return STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => {
    const fips = fipsForStateCode(source.stateCode);
    if (!fips) {
      throw new Error(`No FIPS code for state ${source.stateCode} (source ${source.id})`);
    }

    return {
      id: source.id,
      label: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      jurisdictionLevel: "state",
      jurisdictionName: source.label,
      fipsCode: fips,
      fetchConfig: JSON.stringify({ base_url: source.baseUrl }),
      providerFamily: providerFamilyFor(source.id, source.baseUrl),
    };
  });
}

/**
 * upsert 而非 insert:表中已有 seed 写入的行。
 * 只更新机器可推导的字段;approval_status / legal_review_status / compliance_* 由人工签核,绝不覆盖。
 */
export function upsertSourceRegistry(db: AppDatabase, rows: SourceRegistryRow[], now: string): void {
  for (const row of rows) {
    db.insert(dataSources)
      .values({
        id: row.id,
        label: row.label,
        issuerType: row.issuerType,
        stateCode: row.stateCode,
        baseUrl: row.baseUrl,
        jurisdictionLevel: row.jurisdictionLevel,
        jurisdictionName: row.jurisdictionName,
        fipsCode: row.fipsCode,
        fetchConfig: row.fetchConfig,
        providerFamily: row.providerFamily,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: row.label,
          issuerType: row.issuerType,
          stateCode: row.stateCode,
          baseUrl: row.baseUrl,
          jurisdictionLevel: row.jurisdictionLevel,
          jurisdictionName: row.jurisdictionName,
          fipsCode: row.fipsCode,
          fetchConfig: row.fetchConfig,
          providerFamily: row.providerFamily,
          updatedAt: now,
        },
      })
      .run();
  }
}

export async function upsertSourceRegistryInMysql(
  pool: ReturnType<typeof resolveMysqlPool>,
  rows: SourceRegistryRow[],
  now: string,
): Promise<void> {
  for (const row of rows) {
    await mysqlExecute(
      pool,
      `INSERT INTO data_sources
         (id, label, issuer_type, state_code, base_url, jurisdiction_level, jurisdiction_name,
          fips_code, fetch_config, provider_family, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         issuer_type = VALUES(issuer_type),
         state_code = VALUES(state_code),
         base_url = VALUES(base_url),
         jurisdiction_level = VALUES(jurisdiction_level),
         jurisdiction_name = VALUES(jurisdiction_name),
         fips_code = VALUES(fips_code),
         fetch_config = VALUES(fetch_config),
         provider_family = VALUES(provider_family),
         updated_at = VALUES(updated_at)`,
      [
        row.id, row.label, row.issuerType, row.stateCode, row.baseUrl,
        row.jurisdictionLevel, row.jurisdictionName, row.fipsCode,
        row.fetchConfig, row.providerFamily, now, now,
      ] as never[],
    );
  }
}

async function main() {
  const now = new Date().toISOString();
  const rows = buildSourceRegistryRows();

  if (isMysqlDatabaseUrlConfigured()) {
    await upsertSourceRegistryInMysql(resolveMysqlPool(), rows, now);
    await closeResolvedMysqlPool();
  } else {
    const db = createDatabase();
    runMigrations(db);
    upsertSourceRegistry(db, rows, now);
    db.$client.close();
  }

  console.log(`Source registry migrated: ${rows.length} sources upserted`);
}

if (process.argv[1]?.endsWith("migrate-source-registry.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
