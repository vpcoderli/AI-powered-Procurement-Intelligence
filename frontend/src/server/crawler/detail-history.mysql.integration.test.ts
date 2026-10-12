import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { loadDetailBackfillCandidates, loadDetailHistory } from "./detail-history";

const NOW = "2026-10-08T00:00:00.000Z";

describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("bounded detail history on real MySQL", () => {
  const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof createMysqlPool>;
  let mysql: ReturnType<typeof createMysqlPool>;

  beforeAll(async () => {
    // Always a new isolated schema; never migrate or clear the supplied database.
    const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
    url.pathname = "/";
    admin = createMysqlPool(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = `/${databaseName}`;
    mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
    await runMysqlMigrations(mysql);
  }, 60_000);

  afterAll(async () => {
    if (mysql) await mysql.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
  });

  const insert = (id: string, values: { description?: string; firstSeenAt?: string; lastSeenAt?: string; rawPayload?: string | null } = {}) => {
    const sourceBidId = id.slice(id.indexOf(":") + 1);
    return mysql.query(
      "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, raw_payload, first_seen_at, last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, "SAM.gov", sourceBidId, id, "Trail maintenance", values.description ?? "", "Department of the Interior", "federal", "US",
        `https://sam.gov/opp/${sourceBidId}/view`, values.rawPayload ?? null, values.firstSeenAt ?? NOW, values.lastSeenAt ?? NOW, NOW, NOW],
    );
  };
  const attempt = (attemptedAt: string | null, nextRetryAt: string | null) =>
    JSON.stringify({ enrichment: { outcome: { attempted_at: attemptedAt, next_retry_at: nextRetryAt } } });

  it("selects due body-less rows in attempt order and bounds list history by the newest sighting", async () => {
    await insert("sam_gov:never", { firstSeenAt: "2026-09-01T00:00:00.000Z", rawPayload: "not json" });
    await insert("sam_gov:nullattempt", { firstSeenAt: "2026-09-10T00:00:00.000Z", rawPayload: attempt(null, null) });
    await insert("sam_gov:retried", { firstSeenAt: "2026-08-01T00:00:00.000Z", rawPayload: attempt("2026-09-15T00:00:00+00:00", "2026-09-15T01:00:00+00:00") });
    await insert("sam_gov:link", { firstSeenAt: "2026-09-20T00:00:00.000Z", description: "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=link" });
    await insert("sam_gov:echo", { firstSeenAt: "2026-09-25T00:00:00.000Z", description: "Trail Maintenance" });
    await insert("sam_gov:cooling", { rawPayload: attempt("2026-10-07T23:00:00+00:00", "2026-10-08T23:00:00+00:00") });
    await insert("sam_gov:complete", { description: "Clear brush and repair twelve miles of trail tread." });
    await insert("sam_gov:stale", { lastSeenAt: "2026-09-01T00:00:00.000Z", description: "Clear brush on the north loop." });
    await insert("sam_gov_extra:1");

    const candidates = await loadDetailBackfillCandidates({ mysql }, "sam_gov", undefined, { limit: 10, now: new Date(NOW) });
    expect(candidates.map((row) => row.id)).toEqual(["sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried", "sam_gov:link", "sam_gov:echo"]);

    const history = await loadDetailHistory({ mysql }, "sam_gov");
    expect(history.map((row) => row.id).sort()).toEqual([
      "sam_gov:complete", "sam_gov:cooling", "sam_gov:echo", "sam_gov:link", "sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried",
    ]);
  });
});
