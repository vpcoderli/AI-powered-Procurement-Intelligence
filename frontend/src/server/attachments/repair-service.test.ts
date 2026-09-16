import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { bidAttachments, bids, crawlerLocks, crawlerLogs, dataSources } from "@/server/db/schema";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { attachmentLockSource } from "./lease";
import { serializeAttachmentPolicy, type AttachmentPolicy } from "./policy";
import { runAttachmentRepairOnce } from "./repair-service";
import type { ArchiveAttachmentsRequest, ArchiveAttachmentsResponse } from "./python-runner";

const NOW = new Date("2026-09-16T00:00:00.000Z");

let testDb: TestDatabase;
let archiveRoot: string;
const previousDir = process.env.CRAWLER_ATTACHMENT_DIR;
const previousMax = process.env.ATTACHMENT_REPAIR_MAX_PER_SOURCE;
const previousBrowser = process.env.BROWSER_DOWNLOADER_URL;

beforeEach(async () => {
  testDb = await createTestDatabase();
  archiveRoot = await mkdtemp(path.join(os.tmpdir(), "apsi-repair-"));
  process.env.CRAWLER_ATTACHMENT_DIR = archiveRoot;
  delete process.env.ATTACHMENT_REPAIR_MAX_PER_SOURCE;
  delete process.env.BROWSER_DOWNLOADER_URL;
});

afterEach(async () => {
  await testDb.cleanup();
  await rm(archiveRoot, { recursive: true, force: true });
  if (previousDir === undefined) delete process.env.CRAWLER_ATTACHMENT_DIR;
  else process.env.CRAWLER_ATTACHMENT_DIR = previousDir;
  if (previousMax === undefined) delete process.env.ATTACHMENT_REPAIR_MAX_PER_SOURCE;
  else process.env.ATTACHMENT_REPAIR_MAX_PER_SOURCE = previousMax;
  if (previousBrowser === undefined) delete process.env.BROWSER_DOWNLOADER_URL;
  else process.env.BROWSER_DOWNLOADER_URL = previousBrowser;
});

function insertSource(id: string, label: string, policy?: Partial<AttachmentPolicy>) {
  const fetchConfig = policy
    ? serializeAttachmentPolicy({
        archive: true,
        mode: "direct",
        maxPerRun: 50,
        minIntervalSeconds: 3,
        timeoutSeconds: 30,
        maxBytes: 52_428_800,
        browserLinkSelector: null,
        ...policy,
      })
    : null;

  testDb.db
    .insert(dataSources)
    .values({
      id,
      label,
      issuerType: "state",
      stateCode: "IL",
      fetchConfig: fetchConfig ? JSON.stringify(fetchConfig) : null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
}

function insertBid(id: string, source: string) {
  testDb.db
    .insert(bids)
    .values({
      id,
      source,
      sourceBidId: `${id}-ext`,
      dedupeKey: id,
      title: "Solicitation",
      description: "Description",
      issuerName: "Agency",
      issuerType: "state",
      stateCode: "IL",
      sourceUrl: `https://portal.example.gov/detail/${id}`,
      firstSeenAt: "2026-09-01T00:00:00.000Z",
      lastSeenAt: "2026-09-01T00:00:00.000Z",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    })
    .run();
}

function insertAttachment(values: Partial<typeof bidAttachments.$inferInsert> & { id: string; bidId: string }) {
  testDb.db
    .insert(bidAttachments)
    .values({
      name: "Solicitation.pdf",
      url: "https://portal.example.gov/download/1",
      archiveStatus: "not_archived",
      createdAt: "2026-09-01T00:00:00.000Z",
      ...values,
    })
    .run();
}

function attachment(id: string) {
  return testDb.db.select().from(bidAttachments).where(eq(bidAttachments.id, id)).get();
}

function runLogs() {
  return testDb.db.select().from(crawlerLogs).all();
}

async function writeArchived(relative: string, contents: string) {
  const absolute = path.join(archiveRoot, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, contents);
  return absolute;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function archivedResponse(ids: string[]): ArchiveAttachmentsResponse {
  return {
    results: ids.map((id, index) => ({
      id,
      archive_status: "archived" as const,
      storage_path: `illinois/${id}.pdf`,
      byte_size: 1024 + index,
      content_type: "application/pdf",
      checksum_sha256: `checksum-${id}`,
      archive_error: null,
      failure_kind: null,
      final_url: "https://portal.example.gov/download/1",
      fetched_at: "2026-09-16T00:00:01.000Z",
      method: "direct",
    })),
    stats: { archived: ids.length, failed: 0, unavailable: 0, duration_ms: 12 },
  };
}

describe("runAttachmentRepairOnce — happy path", () => {
  it("archives candidates, writes the rows and exactly one crawler_logs row", async () => {
    insertSource("il_bidbuy", "Illinois BidBuy", { mode: "browser", minIntervalSeconds: 5, browserLinkSelector: "a.dl" });
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({ id: "att-1", bidId: "bid-1" });
    insertAttachment({ id: "att-2", bidId: "bid-1", archiveStatus: "failed", repairAttempts: 1, failureKind: "timeout" });

    const requests: ArchiveAttachmentsRequest[] = [];
    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      browserDownloaderUrl: "http://127.0.0.1:8092",
      runner: async (request) => {
        requests.push(request);
        return archivedResponse(request.items.map((item) => item.id));
      },
    });

    expect(result.status).toBe("success");
    expect(result.candidates).toBe(2);
    expect(result.repaired).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.bySource).toEqual([
      { sourceId: "il_bidbuy", status: "success", attempted: 2, repaired: 2, failed: 0, unavailable: 0 },
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      archive_root: archiveRoot,
      browser_downloader_url: "http://127.0.0.1:8092",
      source: {
        id: "il_bidbuy",
        label: "Illinois BidBuy",
        mode: "browser",
        min_interval_seconds: 5,
        timeout_seconds: 30,
        max_bytes: 52_428_800,
        browser_link_selector: "a.dl",
      },
    });
    expect(requests[0].items[0]).toEqual({
      id: "att-1",
      bid_id: "bid-1",
      bid_source: "Illinois BidBuy",
      source_bid_id: "bid-1-ext",
      page_url: "https://portal.example.gov/detail/bid-1",
      url: "https://portal.example.gov/download/1",
      name: "Solicitation.pdf",
      expected_extension: ".pdf",
    });

    expect(attachment("att-1")).toMatchObject({
      archiveStatus: "archived",
      storagePath: "illinois/att-1.pdf",
      byteSize: 1024,
      contentType: "application/pdf",
      checksumSha256: "checksum-att-1",
      fetchedAt: "2026-09-16T00:00:01.000Z",
      repairAttempts: 0,
      nextRepairAt: null,
      failureKind: null,
      verifiedAt: NOW.toISOString(),
    });

    const logs = runLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      source: "attachment_repair",
      runId: result.runId,
      status: "success",
      fetchedCount: 2,
      insertedCount: 2,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
    });
    expect(JSON.parse(logs[0].metadata ?? "{}")).toMatchObject({ verified: 0, unavailable: 0 });

    // The lease is always released.
    expect(testDb.db.select().from(crawlerLocks).all()).toEqual([]);
  });

  it("reads the browser downloader url from the environment by default", async () => {
    process.env.BROWSER_DOWNLOADER_URL = "http://browser-downloader:8092";
    insertBid("bid-1", "Missouri");
    insertAttachment({ id: "att-1", bidId: "bid-1" });

    const requests: ArchiveAttachmentsRequest[] = [];
    await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => {
        requests.push(request);
        return archivedResponse(request.items.map((item) => item.id));
      },
    });

    expect(requests[0].browser_downloader_url).toBe("http://browser-downloader:8092");
  });
});

describe("runAttachmentRepairOnce — failures and backoff", () => {
  it("records the failure kind and the next attempt time", async () => {
    insertBid("bid-1", "Missouri");
    insertAttachment({ id: "att-1", bidId: "bid-1", repairAttempts: 1, failureKind: "network" });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({
        results: [
          {
            id: "att-1",
            archive_status: "failed" as const,
            storage_path: null,
            byte_size: null,
            content_type: null,
            checksum_sha256: null,
            archive_error: "HTTP 503",
            failure_kind: "http_5xx",
            final_url: null,
            fetched_at: null,
            method: "direct",
          },
        ],
        stats: { archived: 0, failed: 1, unavailable: 0, duration_ms: 3 },
      }),
    });

    expect(result.failed).toBe(1);
    expect(result.byKind).toEqual({ http_5xx: 1 });
    expect(attachment("att-1")).toMatchObject({
      archiveStatus: "failed",
      failureKind: "http_5xx",
      repairAttempts: 2,
      nextRepairAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      archiveError: "HTTP 503",
    });
  });

  it("parks a row after two structural failures in a row", async () => {
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({ id: "att-1", bidId: "bid-1", archiveStatus: "failed", repairAttempts: 1, failureKind: "login_wall" });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({
        results: [
          {
            id: "att-1",
            archive_status: "failed" as const,
            storage_path: null,
            byte_size: null,
            content_type: null,
            checksum_sha256: null,
            archive_error: "Portal returned an HTML page",
            failure_kind: "html_response",
            final_url: null,
            fetched_at: null,
            method: "direct",
          },
        ],
        stats: { archived: 0, failed: 1, unavailable: 0, duration_ms: 3 },
      }),
    });

    expect(result.unavailable).toBe(1);
    expect(result.failed).toBe(0);
    expect(attachment("att-1")).toMatchObject({
      archiveStatus: "unavailable",
      failureKind: "html_response",
      repairAttempts: 2,
      nextRepairAt: NOW.toISOString(),
    });
  });

  it("logs a run failure and leaves the source's rows untouched when the runner throws", async () => {
    insertBid("bid-1", "Missouri");
    insertAttachment({ id: "att-1", bidId: "bid-1" });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => {
        throw new Error("python exited 1");
      },
    });

    expect(result.status).toBe("failure");
    expect(result.bySource[0]).toMatchObject({ status: "failure", error: "python exited 1", attempted: 0 });
    expect(attachment("att-1")).toMatchObject({
      archiveStatus: "not_archived",
      repairAttempts: 0,
      nextRepairAt: null,
      failureKind: null,
    });

    const logs = runLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "failure", errorMessage: "python exited 1" });
    expect(testDb.db.select().from(crawlerLocks).all()).toEqual([]);
  });

  it("counts an item the downloader dropped as one failed attempt", async () => {
    insertBid("bid-1", "Missouri");
    insertAttachment({ id: "att-1", bidId: "bid-1" });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({ results: [], stats: { archived: 0, failed: 0, unavailable: 0, duration_ms: 1 } }),
    });

    expect(result.failed).toBe(1);
    expect(attachment("att-1")).toMatchObject({ archiveStatus: "failed", failureKind: "network", repairAttempts: 1 });
  });
});

describe("runAttachmentRepairOnce — policy, limits and leases", () => {
  it("skips a source whose policy disables archiving without marking any row", async () => {
    insertSource("il_bidbuy", "Illinois BidBuy", { archive: false });
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({ id: "att-1", bidId: "bid-1" });

    const runner = vi.fn();
    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: runner as never,
    });

    expect(runner).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
    expect(result.bySource[0]).toMatchObject({ sourceId: "il_bidbuy", status: "skipped" });
    expect(attachment("att-1")).toMatchObject({ archiveStatus: "not_archived", failureKind: null, repairAttempts: 0 });
  });

  it("caps the batch at the per-source policy and at maxPerSource", async () => {
    insertSource("il_bidbuy", "Illinois BidBuy", { maxPerRun: 2 });
    insertBid("bid-1", "Illinois BidBuy");
    for (const id of ["att-1", "att-2", "att-3"]) insertAttachment({ id, bidId: "bid-1" });

    const byPolicy = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(byPolicy.bySource[0].attempted).toBe(2);
    expect(byPolicy.skipped).toBe(1);

    const requests: ArchiveAttachmentsRequest[] = [];
    await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      maxPerSource: 1,
      runner: async (request) => {
        requests.push(request);
        return archivedResponse(request.items.map((item) => item.id));
      },
    });

    expect(requests[0].items).toHaveLength(1);
  });

  it("skips a source another worker already holds", async () => {
    insertBid("bid-1", "Missouri");
    insertAttachment({ id: "att-1", bidId: "bid-1" });
    testDb.db
      .insert(crawlerLocks)
      .values({
        source: attachmentLockSource("Missouri"),
        owner: "worker-other:abc",
        acquiredAt: NOW.toISOString(),
        expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
      })
      .run();

    const runner = vi.fn();
    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: runner as never,
    });

    expect(runner).not.toHaveBeenCalled();
    expect(result.bySource[0]).toMatchObject({ sourceId: "Missouri", status: "locked" });
    expect(result.skipped).toBe(1);
    expect(result.status).toBe("success");
  });

  it("parks seed/demo relative links once, without calling the downloader", async () => {
    insertBid("bid-1", "Demo");
    insertAttachment({ id: "att-seed", bidId: "bid-1", url: "/api/bids/bid-1/attachments/att-seed" });

    const runner = vi.fn();
    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: runner as never,
    });

    expect(runner).not.toHaveBeenCalled();
    expect(result.unavailable).toBe(1);
    expect(result.byKind).toEqual({ unavailable: 1 });
    expect(attachment("att-seed")).toMatchObject({
      archiveStatus: "unavailable",
      failureKind: "unavailable",
      nextRepairAt: NOW.toISOString(),
    });

    // A second run finds nothing to do: the parked row is not re-queued for 30 days.
    const second = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: runner as never,
    });
    expect(second.candidates).toBe(0);
  });

  it("restricts the run to the requested sources", async () => {
    insertBid("bid-1", "Missouri");
    insertBid("bid-2", "Illinois BidBuy");
    insertAttachment({ id: "att-mo", bidId: "bid-1" });
    insertAttachment({ id: "att-il", bidId: "bid-2" });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      sourceIds: ["Missouri"],
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(result.bySource.map((source) => source.sourceId)).toEqual(["Missouri"]);
    expect(attachment("att-il")?.archiveStatus).toBe("not_archived");
  });
});

describe("runAttachmentRepairOnce — verify pass", () => {
  it("stamps verified_at on a healthy archive", async () => {
    await writeArchived("missouri/att-1.pdf", "%PDF-1.7 ok");
    insertBid("bid-1", "Missouri");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: "missouri/att-1.pdf",
      contentType: "application/pdf",
      checksumSha256: sha256("%PDF-1.7 ok"),
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({ results: [], stats: { archived: 0, failed: 0, unavailable: 0, duration_ms: 0 } }),
    });

    expect(result.verified).toBe(1);
    expect(result.candidates).toBe(0);
    expect(attachment("att-1")).toMatchObject({ archiveStatus: "archived", verifiedAt: NOW.toISOString() });
  });

  it("rewrites an absolute storage path to the portable relative form", async () => {
    const absolute = await writeArchived("missouri/att-1.pdf", "%PDF-1.7 ok");
    insertBid("bid-1", "Missouri");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: absolute,
      contentType: "application/pdf",
      checksumSha256: sha256("%PDF-1.7 ok"),
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({ results: [], stats: { archived: 0, failed: 0, unavailable: 0, duration_ms: 0 } }),
    });

    expect(result.metadataFixed).toBe(1);
    expect(result.verified).toBe(0);
    expect(attachment("att-1")).toMatchObject({
      archiveStatus: "archived",
      storagePath: "missouri/att-1.pdf",
      verifiedAt: NOW.toISOString(),
    });
    expect(runLogs()[0].updatedCount).toBe(1);
  });

  it("re-downloads a missing archive in the same run", async () => {
    insertBid("bid-1", "Missouri");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: "missouri/gone.pdf",
      checksumSha256: sha256("anything"),
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(result.byKind).toMatchObject({ archive_missing: 1 });
    expect(result.candidates).toBe(1);
    expect(result.repaired).toBe(1);
    expect(attachment("att-1")).toMatchObject({ archiveStatus: "archived", storagePath: "illinois/att-1.pdf" });
  });

  it("re-downloads an archive whose bytes are HTML", async () => {
    await writeArchived("illinois/att-1.pdf", "<!DOCTYPE html><html>ERROR IN ... session</html>");
    insertBid("bid-1", "Illinois BidBuy");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: "illinois/att-1.pdf",
      contentType: "application/pdf",
      checksumSha256: sha256("<!DOCTYPE html><html>ERROR IN ... session</html>"),
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(result.byKind).toMatchObject({ archive_corrupt: 1 });
    expect(result.repaired).toBe(1);
  });

  it("re-downloads an archive whose checksum drifted", async () => {
    await writeArchived("missouri/att-1.pdf", "%PDF-1.7 changed");
    insertBid("bid-1", "Missouri");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: "missouri/att-1.pdf",
      contentType: "application/pdf",
      checksumSha256: sha256("%PDF-1.7 original"),
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(result.byKind).toMatchObject({ archive_corrupt: 1 });
    expect(attachment("att-1")?.checksumSha256).toBe("checksum-att-1");
  });

  it("leaves a recently verified archive alone", async () => {
    await writeArchived("missouri/att-1.pdf", "%PDF-1.7 ok");
    insertBid("bid-1", "Missouri");
    insertAttachment({
      id: "att-1",
      bidId: "bid-1",
      archiveStatus: "archived",
      storagePath: "missouri/att-1.pdf",
      checksumSha256: sha256("%PDF-1.7 ok"),
      verifiedAt: "2026-09-15T00:00:00.000Z",
    });

    const result = await runAttachmentRepairOnce({
      database: testDb.db,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async () => ({ results: [], stats: { archived: 0, failed: 0, unavailable: 0, duration_ms: 0 } }),
    });

    expect(result.verified).toBe(0);
    expect(attachment("att-1")?.verifiedAt).toBe("2026-09-15T00:00:00.000Z");
  });
});

describe("runAttachmentRepairOnce — MySQL path", () => {
  it("never touches Drizzle and writes through the MySQL statements", async () => {
    const guard = new Proxy(
      {},
      {
        get(_target, property) {
          throw new Error(`MySQL is configured; db.${String(property)} must not be used.`);
        },
      },
    );

    const candidate = {
      id: "att-1",
      bidId: "bid-1",
      name: "Solicitation.pdf",
      url: "https://portal.example.gov/download/1",
      originalUrl: null,
      storagePath: null,
      byteSize: null,
      contentType: null,
      checksumSha256: null,
      archiveStatus: "not_archived",
      archiveError: null,
      failureKind: null,
      repairAttempts: 0,
      nextRepairAt: null,
      verifiedAt: null,
      bidSource: "Illinois BidBuy",
      bidSourceUrl: "https://portal.example.gov/detail/bid-1",
      bidSourceBidId: "27-444",
      sourceId: "il_bidbuy",
      sourceLabel: "Illinois BidBuy",
      fetchConfig: JSON.stringify(serializeAttachmentPolicy({
        archive: true,
        mode: "browser",
        maxPerRun: 5,
        minIntervalSeconds: 3,
        timeoutSeconds: 30,
        maxBytes: 52_428_800,
        browserLinkSelector: null,
      })),
    };

    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const held = { owner: "", expiresAt: "" };
    const connection = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        if (sql.includes("FROM bid_attachments a") && sql.includes("archive_status = 'archived'")) {
          return [[]] as [unknown[]];
        }
        if (sql.includes("FROM bid_attachments a")) return [[candidate]] as [unknown[]];
        if (sql.includes("FROM crawler_locks")) {
          return [[{ source: values[0], owner: held.owner, expiresAt: held.expiresAt }]] as [unknown[]];
        }
        return [[]] as [unknown[]];
      }),
      execute: vi.fn(async (sql: string, values: unknown[] = []) => {
        statements.push({ sql, values });
        if (sql.includes("INSERT INTO crawler_locks")) {
          held.owner = String(values[1]);
          held.expiresAt = String(values[3]);
        }
        return [{ affectedRows: 1 }] as [unknown];
      }),
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(),
    };
    const pool = { ...connection, getConnection: vi.fn(async () => connection) };

    const result = await runAttachmentRepairOnce({
      database: guard as never,
      mysql: pool as never,
      owner: "worker-1",
      now: () => NOW,
      archiveRoot,
      runner: async (request) => archivedResponse(request.items.map((item) => item.id)),
    });

    expect(result.status).toBe("success");
    expect(result.repaired).toBe(1);

    const update = statements.find((statement) => statement.sql.startsWith("UPDATE bid_attachments SET"));
    expect(update?.values).toEqual([
      "archived",
      "illinois/att-1.pdf",
      1024,
      "application/pdf",
      "checksum-att-1",
      "2026-09-16T00:00:01.000Z",
      null,
      null,
      0,
      null,
      NOW.toISOString(),
      "att-1",
    ]);

    const log = statements.find((statement) => statement.sql.includes("INSERT INTO crawler_logs"));
    expect(log?.values[1]).toBe("attachment_repair");
    expect(connection.commit).toHaveBeenCalled();
  });
});
