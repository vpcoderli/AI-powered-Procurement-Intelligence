import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { mysqlExecute } from "@/server/db/mysql-runtime";
import { dataSources } from "@/server/db/schema";
import { degradeThresholdFor, shouldFlagForReview, type CrawlerFailureKind } from "./failure-classifier";

export interface SourceFailureInput {
  sourceId: string;
  at: string;
  kind: CrawlerFailureKind;
}

export interface MysqlHealthStore {
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export function recordSourceSuccess(db: AppDatabase, sourceId: string, at: string): void {
  db.update(dataSources)
    .set({ lastSuccessAt: at, consecutiveFailures: 0, updatedAt: at })
    .where(eq(dataSources.id, sourceId))
    .run();
}

export async function recordSourceSuccessInMysql(
  pool: MysqlHealthStore,
  sourceId: string,
  at: string,
): Promise<void> {
  await mysqlExecute(
    pool,
    `UPDATE data_sources
     SET last_success_at = ?, consecutive_failures = 0, updated_at = ?
     WHERE id = ?`,
    [at, at, sourceId] as never[],
  );
}

export function recordSourceFailure(db: AppDatabase, input: SourceFailureInput): void {
  const current = db
    .select({ consecutiveFailures: dataSources.consecutiveFailures })
    .from(dataSources)
    .where(eq(dataSources.id, input.sourceId))
    .get();

  const failures = (current?.consecutiveFailures ?? 0) + 1;
  const degrade = shouldFlagForReview(input.kind) || failures >= degradeThresholdFor(input.kind);

  db.update(dataSources)
    .set({
      lastFailureAt: input.at,
      consecutiveFailures: failures,
      updatedAt: input.at,
      ...(degrade ? { approvalStatus: "needs_review" } : {}),
    })
    .where(eq(dataSources.id, input.sourceId))
    .run();
}

export async function recordSourceFailureInMysql(
  pool: MysqlHealthStore,
  input: SourceFailureInput,
): Promise<void> {
  // A parse failure degrades immediately; otherwise degrade once the failure
  // kind's threshold is reached. Done as a single CASE-expression UPDATE to
  // avoid a read-modify-write race between concurrent workers.
  //
  // MySQL evaluates a single-table UPDATE's SET assignments left to right,
  // and a later assignment that references a column assigned earlier in the
  // same SET clause sees the *already-updated* value (this is a documented
  // MySQL deviation from standard SQL). So `approval_status` MUST be
  // assigned before `consecutive_failures` is reassigned, or the CASE would
  // read the post-increment counter and compare it against the threshold a
  // second time (an off-by-one that demotes sources one failure early).
  const forceDegrade = shouldFlagForReview(input.kind) ? 1 : 0;

  await mysqlExecute(
    pool,
    `UPDATE data_sources
     SET last_failure_at = ?,
         approval_status = CASE
           WHEN ? = 1 THEN 'needs_review'
           WHEN consecutive_failures + 1 >= ? THEN 'needs_review'
           ELSE approval_status
         END,
         consecutive_failures = consecutive_failures + 1,
         updated_at = ?
     WHERE id = ?`,
    [input.at, forceDegrade, degradeThresholdFor(input.kind), input.at, input.sourceId] as never[],
  );
}
