import { expandMysqlInClause, mysqlExecute, mysqlSelectOne } from "@/server/db/mysql-runtime";
import type { BidMatchResult } from "@/server/match/types";
import type { GeneratedIntentContent } from "@/server/intents/types";

interface MysqlQualificationStore {
  query: (sql: string, values?: unknown[]) => Promise<[unknown[], unknown?]>;
  execute: (sql: string, values?: never[]) => Promise<[unknown, unknown?]>;
}

export interface MysqlIntentQualificationSnapshot {
  id: string;
  bidId: string;
  evidenceCitationsJson: string;
  aiBidBrief: string;
  keyDatesJson: string;
  initialChecklistJson: string;
  riskFlagsJson: string;
  matchScoreSnapshotJson: string;
  updatedAt: string;
}

function snapshotSelectSql(userIds: string[]) {
  const clause = expandMysqlInClause(userIds);

  return {
    sql: `
      SELECT
        id,
        bid_id AS bidId,
        evidence_citations_json AS evidenceCitationsJson,
        ai_bid_brief AS aiBidBrief,
        key_dates_json AS keyDatesJson,
        initial_checklist_json AS initialChecklistJson,
        risk_flags_json AS riskFlagsJson,
        match_score_snapshot_json AS matchScoreSnapshotJson,
        updated_at AS updatedAt
      FROM intent_to_bid
      WHERE user_id IN (${clause.placeholders}) AND id = ?
      LIMIT 1
    `,
    values: clause.values,
  };
}

export async function findIntentQualificationSnapshotFromMysql(
  mysql: MysqlQualificationStore,
  userIds: string[],
  intentId: string,
) {
  const select = snapshotSelectSql(userIds);

  return mysqlSelectOne<MysqlIntentQualificationSnapshot>(
    mysql,
    select.sql,
    [...select.values, intentId],
  );
}

export async function updateIntentEvidenceCitationsForUsersFromMysql(
  mysql: MysqlQualificationStore,
  userIds: string[],
  intentId: string,
  citationsJson: string,
  timestamp: string,
) {
  const clause = expandMysqlInClause(userIds);
  await mysqlExecute(
    mysql,
    `
      UPDATE intent_to_bid
      SET evidence_citations_json = ?, updated_at = ?
      WHERE user_id IN (${clause.placeholders}) AND id = ?
    `,
    [citationsJson, timestamp, ...clause.values, intentId],
  );

  return findIntentQualificationSnapshotFromMysql(mysql, userIds, intentId);
}

export async function updateIntentQualificationSnapshotForUsersFromMysql(
  mysql: MysqlQualificationStore,
  userIds: string[],
  intentId: string,
  input: {
    generated: GeneratedIntentContent;
    match: BidMatchResult;
    citationsJson: string;
    timestamp: string;
  },
) {
  const clause = expandMysqlInClause(userIds);
  await mysqlExecute(
    mysql,
    `
      UPDATE intent_to_bid
      SET ai_bid_brief = ?,
          key_dates_json = ?,
          initial_checklist_json = ?,
          risk_flags_json = ?,
          match_score_snapshot_json = ?,
          evidence_citations_json = ?,
          updated_at = ?
      WHERE user_id IN (${clause.placeholders}) AND id = ?
    `,
    [
      input.generated.aiBidBrief,
      JSON.stringify(input.generated.keyDates),
      JSON.stringify(input.generated.initialChecklist),
      JSON.stringify(input.generated.riskFlags),
      JSON.stringify(input.match),
      input.citationsJson,
      input.timestamp,
      ...clause.values,
      intentId,
    ],
  );

  return findIntentQualificationSnapshotFromMysql(mysql, userIds, intentId);
}
