import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { dataSources } from "@/server/db/schema";
import { recordSourceFailure, recordSourceSuccess } from "./source-health-repository";

const NOW = "2026-07-29T00:00:00.000Z";
const LATER = "2026-07-30T00:00:00.000Z";

describe("source health repository", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
    testDb.db
      .insert(dataSources)
      .values({
        id: "src",
        label: "Source",
        issuerType: "state",
        stateCode: "CA",
        isEnabled: 1,
        cadence: "daily",
        consecutiveFailures: 3,
        approvalStatus: "approved",
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function read() {
    return testDb.db.select().from(dataSources).where(eq(dataSources.id, "src")).get();
  }

  it("resets the failure counter on success", () => {
    recordSourceSuccess(testDb.db, "src", LATER);
    const row = read();
    expect(row?.lastSuccessAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(0);
  });

  it("increments the failure counter on failure", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.lastFailureAt).toBe(LATER);
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("approved");
  });

  it("degrades the source to needs_review once the threshold is crossed", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "network" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(5);
    expect(row?.approvalStatus).toBe("needs_review");
  });

  it("degrades immediately on a parse failure regardless of the counter", () => {
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "parse" });
    expect(read()?.approvalStatus).toBe("needs_review");
  });

  it("degrades silent-empty sources at the lower three-round threshold", () => {
    // Starting counter is 3; one empty result reaches the empty threshold.
    recordSourceFailure(testDb.db, { sourceId: "src", at: LATER, kind: "empty" });
    const row = read();
    expect(row?.consecutiveFailures).toBe(4);
    expect(row?.approvalStatus).toBe("needs_review");
  });
});
