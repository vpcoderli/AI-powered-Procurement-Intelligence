import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAttachmentRepairCandidates } from "@/server/attachments/repository";
import { bidAttachments } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { mergePersistedAttachments } from "./persistence-merge";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";

// Every SAM.gov run re-sends each resourceLink of its 30-day window exactly like this.
const LINK = "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/f1/download?api_key=null&token=";
const REOBSERVED = { name: "SOW.pdf", url: LINK, original_url: LINK, archive_status: "not_archived" };
const NOW = "2026-10-12T00:00:00.000Z";

function priorAttachment(repairState: Record<string, unknown>) {
  return {
    id: "sam_gov:abc123:attachment:1", bid_id: "sam_gov:abc123", name: "SOW.pdf", url: LINK, original_url: LINK,
    storage_path: null, byte_size: null, content_type: null, checksum_sha256: null, fetched_at: null,
    archive_status: "not_archived", archive_error: null, failure_kind: null, repair_attempts: 0, next_repair_at: null,
    verified_at: null, created_at: "2026-10-01T00:00:00.000Z", ...repairState,
  };
}

const FAILED = {
  archive_status: "failed", archive_error: "HTTP 503", failure_kind: "http_5xx", repair_attempts: 1,
  next_repair_at: "2026-10-12T02:00:00.000Z",
};
const PARKED = {
  archive_status: "unavailable", archive_error: "Portal returned an HTML page", failure_kind: "html_response",
  repair_attempts: 2, next_repair_at: "2026-10-11T00:00:00.000Z",
};

describe("mergePersistedAttachments — a re-observed link keeps its repair state", () => {
  it.each([["failed", FAILED], ["unavailable", PARKED]])("keeps a %s link's status, failure kind and next attempt", (_, state) => {
    const [row] = mergePersistedAttachments([priorAttachment(state)], [REOBSERVED], "sam_gov:abc123");

    expect(row).toMatchObject(state);
  });

  it("keeps the repair state when the crawler sends no archive status at all", () => {
    const withoutStatus = { name: "SOW.pdf", url: LINK, original_url: LINK };

    const [row] = mergePersistedAttachments([priorAttachment(PARKED)], [withoutStatus], "sam_gov:abc123");

    expect(row).toMatchObject(PARKED);
  });

  it("still lets a freshly archived file replace a failed link", () => {
    const archived = {
      ...REOBSERVED, archive_status: "archived", storage_path: "sam_gov/f1.pdf", byte_size: 2048,
      content_type: "application/pdf", checksum_sha256: "a".repeat(64), fetched_at: NOW,
    };

    const [row] = mergePersistedAttachments([priorAttachment(FAILED)], [archived], "sam_gov:abc123");

    expect(row).toMatchObject({ archive_status: "archived", storage_path: "sam_gov/f1.pdf", checksum_sha256: "a".repeat(64) });
  });
});

describe("SQLite import of a re-sent SAM.gov link", () => {
  let testDb: TestDatabase;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: false });
  });

  afterEach(async () => {
    await testDb.cleanup();
  });

  function importRun(runId: string) {
    return importCrawlerJsonRunIntoSqlite(testDb.db, {
      source: "sam_gov", runId, status: "success", startedAt: NOW, finishedAt: NOW, durationMs: 5, metadata: {},
      errorCode: null, errorMessage: null, errorStack: null,
      bids: [{
        id: "sam_gov:abc123", source: "SAM.gov", source_bid_id: "abc123", dedupe_key: "sam_gov:abc123",
        title: "Trail maintenance services", issuer_name: "Department of the Interior", issuer_type: "federal",
        state_code: "US", source_url: "https://sam.gov/opp/abc123/view", attachments: [REOBSERVED],
      }],
    });
  }

  function storedAttachment() {
    return testDb.db.select().from(bidAttachments).where(eq(bidAttachments.bidId, "sam_gov:abc123")).get();
  }

  function setRepairState(state: typeof FAILED) {
    testDb.db.update(bidAttachments).set({
      archiveStatus: state.archive_status, archiveError: state.archive_error, failureKind: state.failure_kind,
      repairAttempts: state.repair_attempts, nextRepairAt: state.next_repair_at,
    }).where(eq(bidAttachments.bidId, "sam_gov:abc123")).run();
  }

  it("leaves a parked link parked, so the repair worker does not fetch it again before its 30 days", () => {
    expect(importRun("run-1").insertedCount).toBe(1);
    setRepairState(PARKED);

    importRun("run-2");

    expect(storedAttachment()).toMatchObject({
      archiveStatus: "unavailable", archiveError: "Portal returned an HTML page", failureKind: "html_response",
      repairAttempts: 2, nextRepairAt: "2026-10-11T00:00:00.000Z",
    });
    expect(listAttachmentRepairCandidates(testDb.db, { now: new Date("2026-10-12T06:00:00.000Z") })).toEqual([]);
  });

  it("leaves a failed link in its backoff", () => {
    importRun("run-1");
    setRepairState(FAILED);

    importRun("run-2");

    expect(storedAttachment()).toMatchObject({
      archiveStatus: "failed", archiveError: "HTTP 503", failureKind: "http_5xx", repairAttempts: 1,
      nextRepairAt: "2026-10-12T02:00:00.000Z",
    });
  });
});
