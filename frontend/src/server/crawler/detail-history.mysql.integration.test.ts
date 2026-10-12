import { randomUUID } from "node:crypto";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { DETAIL_HISTORY_LIST_LIMIT, loadDetailBackfillCandidates, loadDetailHistory } from "./detail-history";
import type { CrawlableSource } from "./source-registry";

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

  type Values = { description?: string; firstSeenAt?: string; lastSeenAt?: string; rawPayload?: string | null; sourceUrl?: string };
  const insertRows = async (rows: unknown[][]) => {
    for (let start = 0; start < rows.length; start += 1000) {
      const chunk = rows.slice(start, start + 1000);
      await mysql.query(
        "INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type, state_code, source_url, raw_payload, first_seen_at, last_seen_at, created_at, updated_at) VALUES "
          + chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", "),
        chunk.flat(),
      );
    }
  };
  const samRow = (id: string, values: Values = {}) => {
    const sourceBidId = id.slice(id.indexOf(":") + 1);
    return [id, "SAM.gov", sourceBidId, id, "Trail maintenance", values.description ?? "", "Department of the Interior", "federal", "US",
      values.sourceUrl ?? `https://sam.gov/opp/${sourceBidId}/view`, values.rawPayload ?? null, values.firstSeenAt ?? NOW, values.lastSeenAt ?? NOW, NOW, NOW];
  };
  const cityRow = (id: string, values: Values = {}) => {
    const sourceBidId = id.slice(id.indexOf(":") + 1);
    return [id, "City Agency", sourceBidId, id, "Road repairs", values.description ?? "", "City Agency", "city", "CO",
      values.sourceUrl ?? `https://city.example.gov/bids/${sourceBidId}`, values.rawPayload ?? null, values.firstSeenAt ?? NOW, values.lastSeenAt ?? NOW, NOW, NOW];
  };
  const insert = (id: string, values: Values = {}) => insertRows([samRow(id, values)]);
  const attempt = (attemptedAt: string | null, nextRetryAt: string | null) =>
    JSON.stringify({ enrichment: { outcome: { attempted_at: attemptedAt, next_retry_at: nextRetryAt } } });

  it("selects due body-less rows in attempt order and bounds list history by the newest sighting", async () => {
    await insert("sam_gov:never", { firstSeenAt: "2026-09-01T00:00:00.000Z", rawPayload: "not json" });
    await insert("sam_gov:nullattempt", { firstSeenAt: "2026-09-10T00:00:00.000Z", rawPayload: attempt(null, null) });
    await insert("sam_gov:retried", { firstSeenAt: "2026-08-01T00:00:00.000Z", rawPayload: attempt("2026-09-15T00:00:00+00:00", "2026-09-15T01:00:00+00:00") });
    await insert("sam_gov:link", { firstSeenAt: "2026-09-20T00:00:00.000Z", description: "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=link" });
    await insert("sam_gov:echo", { firstSeenAt: "2026-09-25T00:00:00.000Z", description: "Trail Maintenance" });
    await insert("sam_gov:cooling", { rawPayload: attempt("2026-10-07T23:00:00+00:00", "2026-10-08T23:00:00+00:00") });
    // The crawler's backfill cooldown for an untrusted description link: never attempted, not due.
    await insert("sam_gov:untrusted", { firstSeenAt: "2026-07-01T00:00:00.000Z", rawPayload: JSON.stringify({ enrichment: { outcome: {
      status: "restricted", reason: "untrusted_description_url", attempted: false, attempted_at: null, next_retry_at: "2026-10-08T12:00:00+00:00" } } }) });
    await insert("sam_gov:complete", { description: "Clear brush and repair twelve miles of trail tread." });
    await insert("sam_gov:stale", { lastSeenAt: "2026-09-01T00:00:00.000Z", description: "Clear brush on the north loop." });
    await insert("sam_gov_extra:1");

    const candidates = await loadDetailBackfillCandidates({ mysql }, "sam_gov", undefined, { limit: 10, now: new Date(NOW) });
    expect(candidates.map((row) => row.id)).toEqual(["sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried", "sam_gov:link", "sam_gov:echo"]);

    const history = await loadDetailHistory({ mysql }, "sam_gov");
    expect(history.map((row) => row.id).sort()).toEqual([
      "sam_gov:complete", "sam_gov:cooling", "sam_gov:echo", "sam_gov:link", "sam_gov:never", "sam_gov:nullattempt", "sam_gov:retried", "sam_gov:untrusted",
    ]);
  });

  it("never spends a backfill slot on a row that points at the crawled list page or the portal page", async () => {
    const listPage = "https://www.bidnetdirect.com/colorado/solicitations/open-bids";
    const portal = "https://city.example.gov/open-bids";
    const older = { firstSeenAt: "2026-09-01T00:00:00.000Z" };
    await insertRows([
      cityRow("city_portal:list", { ...older, sourceUrl: listPage }),
      cityRow("city_portal:listslash", { ...older, sourceUrl: `${listPage}/` }),
      cityRow("city_portal:portal", { ...older, sourceUrl: portal }),
      cityRow("city_portal:portalslash", { ...older, sourceUrl: `${portal}/` }),
      cityRow("city_portal:detail", { firstSeenAt: "2026-09-20T00:00:00.000Z" }),
    ]);
    const source: CrawlableSource = { id: "city_portal", label: "City Agency", issuerType: "city", jurisdictionLevel: "city", stateCode: "CO",
      fipsCode: null, baseUrl: portal, cadence: "daily", providerFamily: "bidnet", jurisdictionName: "City",
      fetchConfig: { base_url: listPage }, lastSuccessAt: null, consecutiveFailures: 0 };

    const candidates = await loadDetailBackfillCandidates({ mysql }, "city_portal", source, { limit: 1, now: new Date(NOW) });
    expect(candidates.map((row) => row.id)).toEqual(["city_portal:detail"]);
  });

  it("reports a truncated list history only when a row past the cap exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await insertRows(Array.from({ length: DETAIL_HISTORY_LIST_LIMIT }, (_, index) => cityRow(`bulk_portal:b${String(index).padStart(4, "0")}`)));
      expect(await loadDetailHistory({ mysql }, "bulk_portal")).toHaveLength(DETAIL_HISTORY_LIST_LIMIT);
      expect(warn).not.toHaveBeenCalled();

      await insertRows([cityRow("bulk_portal:oldest", { lastSeenAt: "2026-10-01T00:00:00.000Z" })]);
      const capped = await loadDetailHistory({ mysql }, "bulk_portal");
      expect(capped).toHaveLength(DETAIL_HISTORY_LIST_LIMIT);
      expect(capped.map((row) => row.id)).not.toContain("bulk_portal:oldest");
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "crawler_detail_history_truncated", source: "bulk_portal", limit: DETAIL_HISTORY_LIST_LIMIT }));
    } finally {
      warn.mockRestore();
    }
  }, 60_000);
});
