import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "@/server/db/client";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import type { RunCrawlerSourceOnceResult } from "./orchestrator";
import { isVerifiedEmptyRun, recordSourceHealthOutcome } from "./source-health-outcome";

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

/** A failed run whose crawler printed an HtmlPageError document (what runCrawlTask now reports with the document's own code). */
function htmlPageFailure(message: string): RunCrawlerSourceOnceResult {
  return {
    ok: false,
    source: "bidnet_ny_erie",
    status: "failure",
    runner: {
      ok: false,
      source: "bidnet_ny_erie",
      status: "failure",
      stdout: "",
      stderr: "",
      errorCode: "HtmlPageError",
      fetchedCount: 0,
      payload: { errorMessage: message, metadata: {} },
    },
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
        approvalStatus: "approved",
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

  describe("an HtmlPageError from the crawler's HTML fetcher", () => {
    // One exception class covers very different failures (public_page.py). An approved source must not be sent to
    // review at the first transient failure, but must be at once when the page itself came back wrong.
    it.each([
      { what: "a transport failure", message: "HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Read timed out. (read timeout=30)" },
      { what: "a 503 answer", message: "HTML request failed with status 503: Service Unavailable" },
      { what: "a 429 answer", message: "HTML request failed with status 429: slow down" },
      { what: "a 403 answer", message: "HTML request failed with status 403: Forbidden" },
      { what: "a 202 challenge answer", message: "HTML request failed with status 202: " },
    ])("counts $what as an ordinary failure and keeps the source approved", async ({ message }) => {
      await recordSourceHealthOutcome({ database: testDb.db }, "bidnet_ny_erie", htmlPageFailure(message), LATER);

      expect(readSource()).toMatchObject({ lastFailureAt: LATER, consecutiveFailures: 4, approvalStatus: "approved" });
    });

    it.each([
      { what: "missing table headers", message: "HTML table was missing required headers: title" },
      { what: "a 404 answer", message: "HTML request failed with status 404: Not Found" },
      { what: "a non-HTML content type", message: "HTML response content type was not HTML: application/json" },
      { what: "an empty body", message: "HTML response was empty" },
    ])("sends the source to review at once for $what", async ({ message }) => {
      await recordSourceHealthOutcome({ database: testDb.db }, "bidnet_ny_erie", htmlPageFailure(message), LATER);

      expect(readSource()).toMatchObject({ lastFailureAt: LATER, consecutiveFailures: 4, approvalStatus: "needs_review" });
    });

    it("still sends the source to review once transient failures reach the default threshold of five", async () => {
      const transport = htmlPageFailure("HTML request failed: connection reset");

      await recordSourceHealthOutcome({ database: testDb.db }, "bidnet_ny_erie", transport, LATER); // 3 -> 4
      expect(readSource()).toMatchObject({ consecutiveFailures: 4, approvalStatus: "approved" });
      await recordSourceHealthOutcome({ database: testDb.db }, "bidnet_ny_erie", transport, LATER); // 4 -> 5
      expect(readSource()).toMatchObject({ consecutiveFailures: 5, approvalStatus: "needs_review" });
    });
  });
});

describe("recordSourceHealthOutcome on the MySQL path", () => {
  // Same classification, other dialect: the statement's bound parameters are [at, forceDegrade, threshold, at, id],
  // and forceDegrade is what sends a source to review at the first failure (see source-health-repository.test.ts).
  async function bindingsFor(message: string) {
    const execute = vi.fn(async () => [{ affectedRows: 1, insertId: 0 }] as [unknown, unknown?]);
    const mysql = { query: vi.fn(async () => [[]] as [unknown[], unknown?]), execute };

    await recordSourceHealthOutcome({ database: {} as AppDatabase, mysql }, "bidnet_ny_erie", htmlPageFailure(message), LATER);

    expect(execute).toHaveBeenCalledTimes(1);
    return (execute.mock.calls[0] as unknown as [string, unknown[]])[1];
  }

  it("does not force a review for a transport failure or a throttling status", async () => {
    expect(await bindingsFor("HTML request failed: HTTPSConnectionPool(host='www.bidnetdirect.com', port=443): Read timed out.")).toEqual([LATER, 0, 5, LATER, "bidnet_ny_erie"]);
    expect(await bindingsFor("HTML request failed with status 429: slow down")).toEqual([LATER, 0, 5, LATER, "bidnet_ny_erie"]);
    expect(await bindingsFor("HTML request failed with status 202: ")).toEqual([LATER, 0, 5, LATER, "bidnet_ny_erie"]);
  });

  it("forces a review at once when the page came back wrong", async () => {
    expect(await bindingsFor("HTML table was missing required headers: title")).toEqual([LATER, 1, 5, LATER, "bidnet_ny_erie"]);
    expect(await bindingsFor("HTML request failed with status 404: Not Found")).toEqual([LATER, 1, 5, LATER, "bidnet_ny_erie"]);
  });
});

describe("isVerifiedEmptyRun", () => {
  const base = { ok: true as const, source: "s", status: "success" as const, alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 }, notification: { queued: 0, sent: 0, skipped: 0, failed: 0 } };
  it("is true only for a zero-row success that carries a verified empty state", () => {
    expect(isVerifiedEmptyRun({ ...base, runner: { ok: true, source: "s", status: "success", stdout: "", stderr: "", fetchedCount: 0, payload: { metadata: { emptyState: { verified: true } } } } })).toBe(true);
    expect(isVerifiedEmptyRun({ ...base, runner: { ok: true, source: "s", status: "success", stdout: "", stderr: "", fetchedCount: 3, payload: { metadata: {} } } })).toBe(false);
    expect(isVerifiedEmptyRun({ ok: false, source: "s", status: "blocked", reason: "x" } as never)).toBe(false);
  });
});
