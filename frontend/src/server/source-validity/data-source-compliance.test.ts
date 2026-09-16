import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import {
  applyRobotsComplianceToDataSources,
  applyRobotsComplianceToDataSourcesFromMysql,
  listDataSourceComplianceInputs,
  listDataSourceComplianceInputsFromMysql,
} from "./data-source-compliance";
import type { SourceComplianceReport, SourceComplianceResult } from "./robots-compliance-scan";

const NOW = "2026-09-16T10:00:00.000Z";

function result(overrides: Partial<SourceComplianceResult>): SourceComplianceResult {
  return {
    stateCode: "NY",
    sourceId: "bidnet_ny_erie",
    label: "Erie County, NY (BidNet)",
    baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
    robotsTxtUrl: "https://www.bidnetdirect.com/robots.txt",
    status: "clear",
    httpStatus: 200,
    robotsTxtHash: "hash-1",
    disallowsCrawledPaths: false,
    flagged: false,
    flagReason: null,
    matchedDisallowRules: [],
    checkedAt: NOW,
    errorMessage: null,
    ...overrides,
  };
}

function report(results: SourceComplianceResult[]): SourceComplianceReport {
  return {
    ok: results.every((entry) => !entry.flagged),
    checkedAt: NOW,
    summary: {
      total: results.length,
      clear: results.filter((entry) => !entry.flagged).length,
      flagged: results.filter((entry) => entry.flagged).length,
      unreachable: 0,
    },
    results,
  };
}

describe("data source compliance inputs", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values([
        {
          id: "bidnet_ny_erie",
          label: "Erie County, NY (BidNet)",
          issuerType: "county",
          stateCode: "NY",
          baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
          isEnabled: 1,
          cadence: "daily",
          jurisdictionLevel: "county",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "bidnet_oh_city_columbus",
          label: "Columbus, OH (BidNet)",
          issuerType: "city",
          stateCode: "OH",
          baseUrl: "https://www.bidnetdirect.com/ohio/columbus/solicitations/open-bids",
          isEnabled: 1,
          cadence: "daily",
          jurisdictionLevel: "city",
          createdAt: NOW,
          updatedAt: NOW,
        },
        {
          id: "texas_smartbuy",
          label: "Texas SmartBuy (placeholder)",
          issuerType: "state",
          stateCode: "TX",
          baseUrl: null,
          isEnabled: 0,
          cadence: "daily",
          createdAt: NOW,
          updatedAt: NOW,
        },
      ])
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  it("covers every enabled source including county and city, and skips disabled rows", () => {
    expect(listDataSourceComplianceInputs(testDb.db)).toEqual([
      {
        id: "bidnet_ny_erie",
        stateCode: "NY",
        label: "Erie County, NY (BidNet)",
        baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids",
      },
      {
        id: "bidnet_oh_city_columbus",
        stateCode: "OH",
        label: "Columbus, OH (BidNet)",
        baseUrl: "https://www.bidnetdirect.com/ohio/columbus/solicitations/open-bids",
      },
    ]);
  });

  it("reads the same population through MySQL", async () => {
    const queries: string[] = [];
    const mysql = {
      query: async (sql: string) => {
        queries.push(sql);
        return [[{ id: "bidnet_ny_erie", stateCode: "NY", label: "Erie", baseUrl: null }]];
      },
      execute: async () => [{}],
    };

    expect(await listDataSourceComplianceInputsFromMysql(mysql as never)).toEqual([
      { id: "bidnet_ny_erie", stateCode: "NY", label: "Erie", baseUrl: null },
    ]);
    expect(queries[0]).toContain("WHERE is_enabled = 1");
  });

  it("writes each robots verdict back onto its data_sources row", () => {
    const written = applyRobotsComplianceToDataSources(
      testDb.db,
      report([
        result({}),
        result({
          sourceId: "bidnet_oh_city_columbus",
          status: "disallow_all",
          flagged: true,
          flagReason: "Disallow: /",
          disallowsCrawledPaths: true,
          robotsTxtHash: "hash-2",
        }),
        // Present in a state-definition scan but not a data_sources id: skipped, not fatal.
        result({ sourceId: "ca_caleprocure" }),
      ]),
    );

    expect(written).toBe(2);
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_ny_erie")).get()).toMatchObject({
      robotsTxtStatus: "clear",
      robotsTxtHash: "hash-1",
      robotsTxtDisallowsCrawledPaths: 0,
      robotsTxtFlagReason: null,
    });
    expect(testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_oh_city_columbus")).get()).toMatchObject(
      {
        robotsTxtStatus: "disallow_all",
        robotsTxtHash: "hash-2",
        robotsTxtDisallowsCrawledPaths: 1,
        robotsTxtFlagReason: "Disallow: /",
      },
    );
  });

  it("writes robots verdicts back through MySQL", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const mysql = {
      query: async () => [[{ id: "bidnet_ny_erie" }]],
      execute: async (sql: string, values: unknown[] = []) => {
        executed.push({ sql, values });
        return [{ affectedRows: 1 }];
      },
    };

    expect(await applyRobotsComplianceToDataSourcesFromMysql(mysql as never, report([result({})]))).toBe(1);
    expect(executed[0].sql).toContain("robots_txt_status = ?");
    expect(executed[0].sql).not.toContain("live_health_disposition");
  });
});
