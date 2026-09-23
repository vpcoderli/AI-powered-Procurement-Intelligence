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

/** The only `stats.stopped_reason` that means the directory walk ran off its last page. */
const COMPLETE_DISCOVERY_RUN = "exhausted";

export interface CandidateFile {
  candidates: SourceCandidate[];
  /**
   * Set when the file is `discover-sources` output (`{candidates, review, existingMatches,
   * stats}`); null for a bare candidate array such as `data/seed-sources/*.json`.
   */
  discovery: {
    pages: number | null;
    agencies: number | null;
    review: number | null;
    stoppedReason: string | null;
  } | null;
}

export class CandidateFileError extends Error {}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Accepts both shapes a candidate file comes in: the `discover-sources` document as that
 * command writes it (docs/operations/source-discovery.md §3), and a bare `SourceCandidate[]`.
 * Anything else is refused before a single row is validated or written.
 */
export function parseCandidateFile(value: unknown): CandidateFile {
  let candidates: unknown;
  let discovery: CandidateFile["discovery"] = null;

  if (Array.isArray(value)) {
    candidates = value;
  } else if (value !== null && typeof value === "object" && Array.isArray((value as { candidates?: unknown }).candidates)) {
    const document = value as { candidates: unknown[]; review?: unknown; stats?: unknown };
    const stats = (document.stats !== null && typeof document.stats === "object" ? document.stats : {}) as Record<string, unknown>;
    candidates = document.candidates;
    discovery = {
      pages: numberOrNull(stats.pages),
      agencies: numberOrNull(stats.agencies),
      review: Array.isArray(document.review) ? document.review.length : null,
      stoppedReason: typeof stats.stopped_reason === "string" ? stats.stopped_reason : null,
    };
  } else {
    throw new CandidateFileError(
      "expected the discover-sources output ({ \"candidates\": [...], \"stats\": {...}, ... }) or a bare array of candidates",
    );
  }

  const list = candidates as unknown[];
  const notAnObject = list.findIndex((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry));
  if (notAnObject !== -1) {
    throw new CandidateFileError(`candidates[${notAnObject}] is not a JSON object`);
  }
  return { candidates: list as SourceCandidate[], discovery };
}

/**
 * A partial discovery run (WAF challenge, page budget, fetch failure, looping pages) still
 * yields valid candidates -- but registering it as if it were the whole directory is how
 * agencies go missing without anyone noticing. Returns the refusal message, or null.
 */
export function partialDiscoveryRefusal(file: CandidateFile, allowPartial: boolean): string | null {
  const reason = file.discovery?.stoppedReason;
  if (!reason || reason === COMPLETE_DISCOVERY_RUN || allowPartial) return null;
  return (
    `discover-sources stopped early (stats.stopped_reason = "${reason}", ${file.discovery?.pages ?? "?"} pages): ` +
    "these candidates are not the whole directory. Re-run discovery, or pass --allow-partial " +
    "to register this subset knowingly."
  );
}

/** One line for the operator saying what the file is before anything is validated. */
export function describeCandidateFile(file: CandidateFile): string {
  if (!file.discovery) return `Candidate array: ${file.candidates.length} candidates`;
  const { pages, agencies, review, stoppedReason } = file.discovery;
  return (
    `discover-sources output: ${pages ?? "?"} pages, ${agencies ?? "?"} agencies, ` +
    `stopped_reason=${stoppedReason ?? "unknown"}; ${file.candidates.length} candidates, ${review ?? "?"} in review`
  );
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
    console.error("Usage: npx tsx scripts/register-sources.ts --file candidates.json [--dry-run] [--allow-partial]");
    process.exitCode = 1;
    return;
  }

  const filePath = args[fileIndex + 1];
  const dryRun = args.includes("--dry-run");
  const allowPartial = args.includes("--allow-partial");

  let file: CandidateFile;
  try {
    file = parseCandidateFile(JSON.parse(readFileSync(filePath, "utf-8")));
  } catch (error) {
    console.error(`Cannot use ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }
  const { candidates } = file;
  console.log(describeCandidateFile(file));
  if (file.discovery && !file.discovery.stoppedReason) {
    console.warn("Warning: the file carries no stats.stopped_reason, so nothing says the directory walk finished.");
  }
  // Decided once, up front: a dry run must answer exactly what the real run would.
  const refusal = partialDiscoveryRefusal(file, allowPartial);

  if (dryRun) {
    console.log(`Dry run: ${candidates.length} candidates`);
    let invalid = 0;
    for (const c of candidates) {
      const errors = validateCandidate(c);
      if (errors.length > 0) invalid++;
      console.log(`  ${c.id}: ${errors.length === 0 ? "OK" : errors.join(", ")}`);
    }
    console.log(`Dry run: ${candidates.length - invalid} valid, ${invalid} invalid`);
    if (refusal) {
      console.error(`A real run would refuse this file: ${refusal}`);
      process.exitCode = 1;
    }
    return;
  }

  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
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
