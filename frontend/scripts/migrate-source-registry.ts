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

/**
 * 官方门户不可靠/不可机读的州,爬虫改用 BidNet Direct 聚合页面抓取——但
 * data_sources.base_url 记录的仍是官方门户地址(例如 al_state_procurement 是
 * purchasing.alabama.gov,不是 bidnetdirect.com),所以不能靠 URL 正则判断,
 * 必须按 source_id 对照这份名单。
 *
 * 原样复制自 src/lib/state-crawler-sources.ts 的 BIDNET_FALLBACK_SOURCE_IDS
 * (19 项),而非 import——那里是 module-private,且下一个任务会删除该文件的
 * 大部分内容。本脚本是一次性数据迁移工具,输入数据必须自包含,否则未来重跑
 * 会因符号消失而编译失败。
 */
const BIDNET_FALLBACK_SOURCE_IDS = new Set([
  "al_state_procurement",
  "ak_state_procurement",
  "az_state_procurement",
  "co_state_procurement",
  "id_state_procurement",
  "ky_state_procurement",
  "la_state_procurement",
  "md_state_procurement",
  "mi_state_procurement",
  "mn_state_procurement",
  "nc_state_procurement",
  "nd_state_procurement",
  "ne_state_procurement",
  "nh_state_procurement",
  "oh_state_procurement",
  "sc_state_procurement",
  "vt_state_procurement",
  "wi_state_procurement",
  "wv_state_procurement",
]);

/** 有专用适配器的源不设 provider_family——解析链(resolve_adapter)先查 source_id,
 * 命中 DEDICATED_ADAPTERS 就直接返回,不看 provider_family。此处仍显式优先判断
 * dedicated,是为了这份名单本身保持正确即便未来两个集合出现重叠。 */
const DEDICATED_SOURCE_IDS = new Set([
  "ca_caleprocure",
  "tx_esbd",
  "ny_contract_reporter",
  "fl_mfmp",
  "il_bidbuy",
]);

function providerFamilyFor(id: string): string | null {
  if (DEDICATED_SOURCE_IDS.has(id)) return null;
  if (BIDNET_FALLBACK_SOURCE_IDS.has(id)) return "bidnet";
  return "generic";
}

/**
 * fetch_bidnet_platform(crawler/apsi_crawler/adapters/registry.py)读取
 * fetch_config.base_url 作为它抓取的 BidNet Direct 聚合页面地址——不是
 * data_sources.base_url(那一列记录官方门户,用于展示/合规,两者刻意不同)。
 * 这 19 个 URL 逐字复制自 Python 侧权威常量,而非 import(脚本必须自包含,
 * 理由同上面 BIDNET_FALLBACK_SOURCE_IDS 的注释):
 *   - 17 项来自 crawler/apsi_crawler/spiders/state_bidnet.py 的 BIDNET_STATE_URLS
 *   - co_state_procurement 来自 spiders/co_bidnet.py 的 CO_BIDNET_URL
 *   - wv_state_procurement 来自 spiders/wv_bidnet.py 的 WV_BIDNET_URL
 */
const BIDNET_AGGREGATOR_URLS: Record<string, string> = {
  al_state_procurement: "https://www.bidnetdirect.com/alabama/solicitations/open-bids",
  ak_state_procurement: "https://www.bidnetdirect.com/alaska/solicitations/open-bids",
  az_state_procurement: "https://www.bidnetdirect.com/arizona/solicitations/open-bids",
  co_state_procurement: "https://www.bidnetdirect.com/colorado/solicitations/open-bids?selectedContent=BUYER",
  id_state_procurement: "https://www.bidnetdirect.com/idaho/solicitations/open-bids",
  ky_state_procurement: "https://www.bidnetdirect.com/kentucky/solicitations/open-bids",
  la_state_procurement: "https://www.bidnetdirect.com/louisiana/solicitations/open-bids",
  md_state_procurement: "https://www.bidnetdirect.com/maryland/solicitations/open-bids",
  mi_state_procurement: "https://www.bidnetdirect.com/mitn/solicitations/open-bids",
  mn_state_procurement: "https://www.bidnetdirect.com/minnesota/solicitations/open-bids",
  nc_state_procurement: "https://www.bidnetdirect.com/north-carolina/solicitations/open-bids",
  nd_state_procurement: "https://www.bidnetdirect.com/north-dakota/solicitations/open-bids",
  ne_state_procurement: "https://www.bidnetdirect.com/nebraska/solicitations/open-bids",
  nh_state_procurement: "https://www.bidnetdirect.com/new-hampshire/solicitations/open-bids",
  oh_state_procurement: "https://www.bidnetdirect.com/ohio/solicitations/open-bids",
  sc_state_procurement: "https://www.bidnetdirect.com/south-carolina/solicitations/open-bids",
  vt_state_procurement: "https://www.bidnetdirect.com/vermont/solicitations/open-bids",
  wi_state_procurement: "https://www.bidnetdirect.com/wisconsin/solicitations/open-bids",
  wv_state_procurement: "https://www.bidnetdirect.com/west-virginia/solicitations/open-bids",
};

export function buildSourceRegistryRows(): SourceRegistryRow[] {
  return STATE_CRAWLER_SOURCE_DEFINITIONS.map((source) => {
    const fips = fipsForStateCode(source.stateCode);
    if (!fips) {
      throw new Error(`No FIPS code for state ${source.stateCode} (source ${source.id})`);
    }

    // Bidnet-family sources fetch through the BidNet Direct aggregator, not the official
    // portal recorded in `baseUrl`/the `base_url` column below — see BIDNET_AGGREGATOR_URLS.
    const fetchBaseUrl = BIDNET_AGGREGATOR_URLS[source.id] ?? source.baseUrl;

    return {
      id: source.id,
      label: source.label,
      issuerType: "state",
      stateCode: source.stateCode,
      baseUrl: source.baseUrl,
      jurisdictionLevel: "state",
      jurisdictionName: source.label,
      fipsCode: fips,
      fetchConfig: JSON.stringify({ base_url: fetchBaseUrl }),
      providerFamily: providerFamilyFor(source.id),
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
