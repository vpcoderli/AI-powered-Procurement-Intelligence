import { readFileSync } from "node:fs";
import { createDatabase, type AppDatabase } from "../src/server/db/client";
import { closeResolvedMysqlPool, isMysqlDatabaseUrlConfigured, resolveMysqlPool } from "../src/server/db/mysql";
import { mysqlExecute } from "../src/server/db/mysql-runtime";
import { runMigrations } from "../src/server/db/migrate";
import { dataSources } from "../src/server/db/schema";

export interface SourceCandidate {
  id: string;
  label: string;
  issuerType: string;
  stateCode: string;
  baseUrl: string;
  jurisdictionLevel: string;
  jurisdictionName: string;
  fipsCode: string;
  providerFamily: string | null;
  cadence: string;
  fetchConfig: Record<string, unknown>;
}

const VALID_JURISDICTION_LEVELS = new Set(["federal", "state", "county", "city", "special_district"]);
const VALID_CADENCES = new Set(["hourly", "daily", "weekly", "manual"]);

export function validateCandidate(c: SourceCandidate): string[] {
  const errors: string[] = [];
  if (!c.id?.trim()) errors.push("id is required");
  if (!c.label?.trim()) errors.push("label is required");
  if (!c.stateCode?.trim()) errors.push("stateCode is required");
  if (!VALID_JURISDICTION_LEVELS.has(c.jurisdictionLevel))
    errors.push(`jurisdictionLevel must be one of ${[...VALID_JURISDICTION_LEVELS].join(", ")}`);
  if (!VALID_CADENCES.has(c.cadence))
    errors.push(`cadence must be one of ${[...VALID_CADENCES].join(", ")}`);
  return errors;
}

interface RegisterResult {
  inserted: number;
  errors: Array<{ id: string; errors: string[] }>;
}

/**
 * Bulk-upsert candidate sources into `data_sources`, keyed on `id`. Only the
 * machine-derivable columns below are ever written; governance columns (approval_status,
 * legal_review_status, approved_for_ingestion, every compliance_* column, live_health_*, etc.)
 * are never referenced in either the insert values or the conflict update set, so they default
 * to NULL for brand-new rows and are left completely untouched for existing rows -- human
 * sign-off recorded through the admin console must survive an arbitrary number of re-registration
 * runs. See source-registry.ts's listCrawlableSources: a county/city row with a NULL
 * approval_status stays excluded from crawling until an admin explicitly approves it.
 */
export function registerSources(db: AppDatabase, candidates: SourceCandidate[], now: string): RegisterResult {
  let inserted = 0;
  const errors: RegisterResult["errors"] = [];

  for (const c of candidates) {
    const validationErrors = validateCandidate(c);
    if (validationErrors.length > 0) {
      errors.push({ id: c.id || "(empty)", errors: validationErrors });
      continue;
    }

    db.insert(dataSources)
      .values({
        id: c.id,
        label: c.label,
        issuerType: c.issuerType,
        stateCode: c.stateCode,
        baseUrl: c.baseUrl,
        jurisdictionLevel: c.jurisdictionLevel,
        jurisdictionName: c.jurisdictionName,
        fipsCode: c.fipsCode,
        providerFamily: c.providerFamily,
        cadence: c.cadence,
        fetchConfig: JSON.stringify(c.fetchConfig),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: dataSources.id,
        set: {
          label: c.label,
          issuerType: c.issuerType,
          stateCode: c.stateCode,
          baseUrl: c.baseUrl,
          jurisdictionLevel: c.jurisdictionLevel,
          jurisdictionName: c.jurisdictionName,
          fipsCode: c.fipsCode,
          providerFamily: c.providerFamily,
          cadence: c.cadence,
          fetchConfig: JSON.stringify(c.fetchConfig),
          updatedAt: now,
        },
      })
      .run();

    inserted++;
  }

  return { inserted, errors };
}

/** MySQL twin of registerSources above -- see its doc comment for the governance-preservation contract. */
export async function registerSourcesInMysql(
  pool: ReturnType<typeof resolveMysqlPool>,
  candidates: SourceCandidate[],
  now: string,
): Promise<RegisterResult> {
  let inserted = 0;
  const errors: RegisterResult["errors"] = [];

  for (const c of candidates) {
    const validationErrors = validateCandidate(c);
    if (validationErrors.length > 0) {
      errors.push({ id: c.id || "(empty)", errors: validationErrors });
      continue;
    }

    await mysqlExecute(
      pool,
      `INSERT INTO data_sources
         (id, label, issuer_type, state_code, base_url, jurisdiction_level, jurisdiction_name,
          fips_code, provider_family, cadence, fetch_config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         label = VALUES(label),
         issuer_type = VALUES(issuer_type),
         state_code = VALUES(state_code),
         base_url = VALUES(base_url),
         jurisdiction_level = VALUES(jurisdiction_level),
         jurisdiction_name = VALUES(jurisdiction_name),
         fips_code = VALUES(fips_code),
         provider_family = VALUES(provider_family),
         cadence = VALUES(cadence),
         fetch_config = VALUES(fetch_config),
         updated_at = VALUES(updated_at)`,
      [
        c.id, c.label, c.issuerType, c.stateCode, c.baseUrl,
        c.jurisdictionLevel, c.jurisdictionName, c.fipsCode,
        c.providerFamily, c.cadence, JSON.stringify(c.fetchConfig), now, now,
      ] as never[],
    );

    inserted++;
  }

  return { inserted, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf("--file");
  if (fileIndex === -1 || !args[fileIndex + 1]) {
    console.error("Usage: npx tsx scripts/register-sources.ts --file candidates.json [--dry-run]");
    process.exitCode = 1;
    return;
  }

  const filePath = args[fileIndex + 1];
  const dryRun = args.includes("--dry-run");

  const candidates: SourceCandidate[] = JSON.parse(readFileSync(filePath, "utf-8"));

  if (dryRun) {
    console.log(`Dry run: ${candidates.length} candidates`);
    for (const c of candidates) {
      const errors = validateCandidate(c);
      console.log(`  ${c.id}: ${errors.length === 0 ? "OK" : errors.join(", ")}`);
    }
    return;
  }

  const now = new Date().toISOString();

  if (isMysqlDatabaseUrlConfigured()) {
    const result = await registerSourcesInMysql(resolveMysqlPool(), candidates, now);
    await closeResolvedMysqlPool();
    console.log(`Registered ${result.inserted} sources (MySQL), ${result.errors.length} errors`);
  } else {
    const db = createDatabase();
    runMigrations(db);
    const result = registerSources(db, candidates, now);
    db.$client.close();
    console.log(`Registered ${result.inserted} sources (SQLite), ${result.errors.length} errors`);
  }
}

if (process.argv[1]?.endsWith("register-sources.ts")) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
