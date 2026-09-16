import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { recordSourceHealthOutcome } from "./source-health-outcome";

const NOW = "2026-09-16T00:00:00.000Z";
const LATER = "2026-09-16T06:00:00.000Z";

function successResult(metadata: Record<string, unknown>): RunCrawlerSourceOnceResult {
  return {
    ok: true,
    source: "bidnet_ny_erie",
    status: "success",
    runner: {
      ok: true,
      source: "bidnet_ny_erie",
      status: "success",
      stdout: "",
      stderr: "",
      fetchedCount: 0,
      payload: { errorMessage: null, metadata },
    },
    alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0, matches: [] },
    notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
  };
}

describe("recordSourceHealthOutcome", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "bidnet_ny_erie",
        label: "Erie County, NY (BidNet)",
        issuerType: "county",
        stateCode: "NY",
        isEnabled: 1,
        cadence: "daily",
        providerFamily: "bidnet",
        jurisdictionLevel: "county",
        consecutiveFailures: 3,
        lastFailureAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function readSource() {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_ny_erie")).get();
  }

  it("records a verified empty-state run as a success and resets the failure streak", async () => {
    await recordSourceHealthOutcome(
      { database: testDb.db },
      "bidnet_ny_erie",
      successResult({
        emptyState: { verified: true, tenant_confirmed: true, marker: "There are no open bids at this time." },
      }),
      LATER,
    );

    expect(readSource()).toMatchObject({ lastSuccessAt: LATER, consecutiveFailures: 0 });
  });

  it("ignores a platform deferral entirely — no success, no failure", async () => {
    await recordSourceHealthOutcome(
      { database: testDb.db },
      "bidnet_ny_erie",
      { ok: false, source: "bidnet_ny_erie", status: "deferred", reason: "platform_throttled:bidnet_co_denver" },
      LATER,
    );

    expect(readSource()).toMatchObject({ lastSuccessAt: null, lastFailureAt: NOW, consecutiveFailures: 3 });
  });

  it("still records real failures", async () => {
    await recordSourceHealthOutcome(
      { database: testDb.db },
      "bidnet_ny_erie",
      {
        ok: false,
        source: "bidnet_ny_erie",
        status: "failure",
        runner: { ok: false, source: "bidnet_ny_erie", status: "failure", stdout: "", stderr: "boom", errorCode: "HtmlPageError" },
      },
      LATER,
    );

    expect(readSource()).toMatchObject({ lastFailureAt: LATER, consecutiveFailures: 4 });
  });
});
