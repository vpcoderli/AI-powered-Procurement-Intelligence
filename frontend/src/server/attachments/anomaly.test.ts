import { describe, expect, it } from "vitest";
import {
  attachmentSourceUrl,
  classifyArchivedFile,
  classifyAttachment,
  isDueForRepair,
  isRepairableAttachmentUrl,
  isTerminalFailure,
  isUnavailableReeligible,
  MISSING_ARCHIVE_PROBE,
  nextRepairAt,
  resolveRepairOutcome,
  type ArchiveFileProbe,
} from "./anomaly";
import type { AttachmentRepairRow } from "./types";

const NOW = new Date("2026-09-16T00:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function row(overrides: Partial<AttachmentRepairRow> = {}): AttachmentRepairRow {
  return {
    id: "il_bidbuy:27-444:attachment:1",
    bidId: "il_bidbuy:27-444",
    name: "Solicitation.pdf",
    url: "https://bidbuy.illinois.gov/download?n=1",
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
    bidSourceUrl: "https://bidbuy.illinois.gov/bidDetail.sdo?docId=27-444",
    bidSourceBidId: "27-444DHS-P",
    sourceId: "il_bidbuy",
    sourceLabel: "Illinois BidBuy",
    fetchConfig: null,
    ...overrides,
  };
}

function probe(overrides: Partial<ArchiveFileProbe> = {}): ArchiveFileProbe {
  return {
    resolvedPath: "/srv/data/attachments/illinois/a.pdf",
    byteSize: 1024,
    checksumSha256: "abc",
    looksLikeHtml: false,
    storagePathIsAbsolute: false,
    relativePath: "illinois/a.pdf",
    ...overrides,
  };
}

describe("url helpers", () => {
  it("only treats public http(s) links as repairable", () => {
    expect(isRepairableAttachmentUrl("https://example.gov/a.pdf")).toBe(true);
    expect(isRepairableAttachmentUrl("http://example.gov/a.pdf")).toBe(true);
    expect(isRepairableAttachmentUrl("/api/bids/demo-1/attachments/demo-1-a")).toBe(false);
    expect(isRepairableAttachmentUrl("file:///tmp/a.pdf")).toBe(false);
    expect(isRepairableAttachmentUrl(null)).toBe(false);
  });

  it("prefers the portal's original url", () => {
    expect(attachmentSourceUrl(row({ originalUrl: "https://portal/original.pdf" }))).toBe(
      "https://portal/original.pdf",
    );
    expect(attachmentSourceUrl(row({ originalUrl: "   " }))).toBe("https://bidbuy.illinois.gov/download?n=1");
  });
});

describe("backoff math", () => {
  it("doubles from one hour and caps at seven days", () => {
    expect(nextRepairAt(0, NOW).getTime() - NOW.getTime()).toBe(HOUR);
    expect(nextRepairAt(1, NOW).getTime() - NOW.getTime()).toBe(2 * HOUR);
    expect(nextRepairAt(3, NOW).getTime() - NOW.getTime()).toBe(8 * HOUR);
    expect(nextRepairAt(6, NOW).getTime() - NOW.getTime()).toBe(64 * HOUR);
    expect(nextRepairAt(20, NOW).getTime() - NOW.getTime()).toBe(7 * 24 * HOUR);
  });

  it("treats a due date in the past (or absent) as due now", () => {
    expect(isDueForRepair({ nextRepairAt: null }, NOW)).toBe(true);
    expect(isDueForRepair({ nextRepairAt: "2026-09-15T00:00:00.000Z" }, NOW)).toBe(true);
    expect(isDueForRepair({ nextRepairAt: "2026-09-17T00:00:00.000Z" }, NOW)).toBe(false);
    expect(isDueForRepair({ nextRepairAt: "not-a-date" }, NOW)).toBe(true);
  });

  it("re-queues a parked row 30 days after it was parked", () => {
    expect(isUnavailableReeligible("2026-09-15T00:00:00.000Z", NOW)).toBe(false);
    expect(isUnavailableReeligible("2026-08-20T00:00:00.000Z", NOW)).toBe(false);
    expect(isUnavailableReeligible("2026-08-17T00:00:00.000Z", NOW)).toBe(true);
    expect(isUnavailableReeligible(null, NOW)).toBe(false);
  });
});

describe("terminal rules", () => {
  it("stops after six attempts", () => {
    expect(isTerminalFailure({ attempts: 5, previousKind: "network", currentKind: "timeout" })).toBe(false);
    expect(isTerminalFailure({ attempts: 6, previousKind: "network", currentKind: "timeout" })).toBe(true);
  });

  it("stops after two structural failures in a row", () => {
    expect(isTerminalFailure({ attempts: 2, previousKind: "login_wall", currentKind: "html_response" })).toBe(true);
    expect(isTerminalFailure({ attempts: 2, previousKind: "html_response", currentKind: "html_response" })).toBe(true);
    expect(isTerminalFailure({ attempts: 2, previousKind: null, currentKind: "login_wall" })).toBe(false);
    expect(isTerminalFailure({ attempts: 2, previousKind: "network", currentKind: "login_wall" })).toBe(false);
  });
});

describe("classifyArchivedFile", () => {
  it("flags a missing file", () => {
    expect(classifyArchivedFile(row({ checksumSha256: "abc" }), MISSING_ARCHIVE_PROBE)).toBe("archive_missing");
  });

  it("flags zero bytes, checksum drift and unexpected HTML", () => {
    const archived = row({ checksumSha256: "abc", contentType: "application/pdf" });
    expect(classifyArchivedFile(archived, probe({ byteSize: 0 }))).toBe("archive_corrupt");
    expect(classifyArchivedFile(archived, probe({ checksumSha256: "zzz" }))).toBe("archive_corrupt");
    expect(classifyArchivedFile(archived, probe({ looksLikeHtml: true }))).toBe("archive_corrupt");
  });

  it("accepts HTML bytes when the row says the attachment is HTML", () => {
    expect(
      classifyArchivedFile(row({ checksumSha256: "abc", contentType: "text/html; charset=utf-8" }), probe({ looksLikeHtml: true })),
    ).toBe("healthy");
  });

  it("treats an archived row without a checksum as unverifiable", () => {
    expect(classifyArchivedFile(row({ checksumSha256: null }), probe())).toBe("archive_corrupt");
  });

  it("flags an absolute storage path that still resolves under a root", () => {
    expect(
      classifyArchivedFile(row({ checksumSha256: "abc" }), probe({ storagePathIsAbsolute: true })),
    ).toBe("path_not_portable");
  });

  it("passes a healthy file", () => {
    expect(classifyArchivedFile(row({ checksumSha256: "abc" }), probe())).toBe("healthy");
  });
});

describe("classifyAttachment", () => {
  it("classifies never-archived, failed and parked rows", () => {
    expect(classifyAttachment(row(), { now: NOW })).toBe("never_archived");
    expect(classifyAttachment(row({ archiveStatus: "failed" }), { now: NOW })).toBe("archive_failed");
    expect(
      classifyAttachment(row({ archiveStatus: "unavailable", nextRepairAt: "2026-09-15T00:00:00.000Z" }), { now: NOW }),
    ).toBe("unavailable");
    expect(
      classifyAttachment(row({ archiveStatus: "unavailable", nextRepairAt: "2026-07-01T00:00:00.000Z" }), { now: NOW }),
    ).toBe("archive_failed");
  });

  it("marks seed/demo relative links unavailable regardless of status", () => {
    const seed = row({ url: "/api/bids/demo-1/attachments/demo-1-a", originalUrl: null });
    expect(classifyAttachment(seed, { now: NOW })).toBe("unavailable");
    expect(classifyAttachment({ ...seed, archiveStatus: "failed" }, { now: NOW })).toBe("unavailable");
  });

  it("delegates archived rows to the file probe", () => {
    const archived = row({ archiveStatus: "archived", checksumSha256: "abc" });
    expect(classifyAttachment(archived, { now: NOW, probe: probe() })).toBe("healthy");
    expect(classifyAttachment(archived, { now: NOW })).toBe("archive_missing");
  });
});

describe("resolveRepairOutcome", () => {
  it("clears bookkeeping on success", () => {
    expect(
      resolveRepairOutcome({ row: row({ repairAttempts: 3, failureKind: "timeout" }), archiveStatus: "archived", failureKind: null, now: NOW }),
    ).toEqual({ archiveStatus: "archived", failureKind: null, repairAttempts: 0, nextRepairAt: null });
  });

  it("increments attempts and schedules the next try", () => {
    expect(
      resolveRepairOutcome({ row: row({ repairAttempts: 0 }), archiveStatus: "failed", failureKind: "timeout", now: NOW }),
    ).toEqual({
      archiveStatus: "failed",
      failureKind: "timeout",
      repairAttempts: 1,
      nextRepairAt: new Date(NOW.getTime() + HOUR).toISOString(),
    });

    expect(
      resolveRepairOutcome({ row: row({ repairAttempts: 2 }), archiveStatus: "failed", failureKind: "http_5xx", now: NOW }).nextRepairAt,
    ).toBe(new Date(NOW.getTime() + 4 * HOUR).toISOString());
  });

  it("parks a row after the sixth attempt", () => {
    const outcome = resolveRepairOutcome({
      row: row({ repairAttempts: 5, failureKind: "network" }),
      archiveStatus: "failed",
      failureKind: "network",
      now: NOW,
    });

    expect(outcome).toEqual({
      archiveStatus: "unavailable",
      failureKind: "network",
      repairAttempts: 6,
      nextRepairAt: NOW.toISOString(),
    });
  });

  it("parks a row after two structural failures in a row", () => {
    expect(
      resolveRepairOutcome({
        row: row({ repairAttempts: 1, failureKind: "login_wall" }),
        archiveStatus: "failed",
        failureKind: "html_response",
        now: NOW,
      }),
    ).toEqual({
      archiveStatus: "unavailable",
      failureKind: "html_response",
      repairAttempts: 2,
      nextRepairAt: NOW.toISOString(),
    });
  });

  it("honours an `unavailable` verdict from the downloader immediately", () => {
    expect(
      resolveRepairOutcome({ row: row(), archiveStatus: "unavailable", failureKind: null, now: NOW }),
    ).toEqual({
      archiveStatus: "unavailable",
      failureKind: "unavailable",
      repairAttempts: 1,
      nextRepairAt: NOW.toISOString(),
    });
  });
});
