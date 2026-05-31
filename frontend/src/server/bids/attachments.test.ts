import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "@/server/db/test-utils";
import { bidAttachments } from "@/server/db/schema";
import { getLocalBidAttachment } from "./attachments";

describe("bid attachment files", () => {
  let testDb: TestDatabase;
  let previousAttachmentDir: string | undefined;

  beforeEach(async () => {
    testDb = await createTestDatabase({ seed: true });
    previousAttachmentDir = process.env.CRAWLER_ATTACHMENT_DIR;
  });

  afterEach(async () => {
    if (previousAttachmentDir === undefined) {
      delete process.env.CRAWLER_ATTACHMENT_DIR;
    } else {
      process.env.CRAWLER_ATTACHMENT_DIR = previousAttachmentDir;
    }
    await testDb.cleanup();
  });

  it("resolves a local attachment inside an allowed directory", async () => {
    const attachmentDir = path.join(path.dirname(testDb.databasePath), "attachments");
    const attachmentPath = path.join(attachmentDir, "notice.pdf");
    process.env.CRAWLER_ATTACHMENT_DIR = attachmentDir;
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "contract notice");
    testDb.db.insert(bidAttachments)
      .values({
        id: "notice_pdf",
        bidId: "1",
        name: "Notice.pdf",
        url: attachmentPath,
        sizeLabel: "15 bytes",
        mimeType: "application/pdf",
        sortOrder: 100,
        createdAt: "2026-05-28T00:00:00.000Z",
      })
      .run();

    const attachment = await getLocalBidAttachment(testDb.db, "1", "notice_pdf");

    expect(attachment).toMatchObject({
      kind: "local",
      filePath: await realpath(attachmentPath),
      filename: "Notice.pdf",
      mimeType: "application/pdf",
      archiveStatus: "not_archived",
    });
  });

  it("resolves file URLs inside an allowed directory", async () => {
    const attachmentDir = path.join(path.dirname(testDb.databasePath), "attachments");
    const attachmentPath = path.join(attachmentDir, "addendum.pdf");
    process.env.CRAWLER_ATTACHMENT_DIR = attachmentDir;
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(attachmentPath, "addendum");
    testDb.db.insert(bidAttachments)
      .values({
        id: "addendum_pdf",
        bidId: "1",
        name: "Addendum.pdf",
        url: pathToFileURL(attachmentPath).toString(),
        sizeLabel: "8 bytes",
        sortOrder: 100,
        createdAt: "2026-05-28T00:00:00.000Z",
      })
      .run();

    const attachment = await getLocalBidAttachment(testDb.db, "1", "addendum_pdf");

    expect(attachment?.filePath).toBe(await realpath(attachmentPath));
  });

  it("resolves relative storage paths inside a configured attachment directory", async () => {
    const attachmentDir = path.join(path.dirname(testDb.databasePath), "configured-attachments");
    const attachmentPath = path.join(attachmentDir, "archive", "notice.pdf");
    process.env.CRAWLER_ATTACHMENT_DIR = attachmentDir;
    await mkdir(path.dirname(attachmentPath), { recursive: true });
    await writeFile(attachmentPath, "archived notice");
    testDb.db.insert(bidAttachments)
      .values({
        id: "storage_path_pdf",
        bidId: "1",
        name: "Storage Path.pdf",
        url: "https://example.gov/files/notice.pdf",
        storagePath: "archive/notice.pdf",
        contentType: "application/pdf",
        archiveStatus: "archived",
        sizeLabel: "15 bytes",
        sortOrder: 100,
        createdAt: "2026-05-28T00:00:00.000Z",
      })
      .run();

    const attachment = await getLocalBidAttachment(testDb.db, "1", "storage_path_pdf");

    expect(attachment).toMatchObject({
      kind: "local",
      filePath: await realpath(attachmentPath),
      filename: "Storage Path.pdf",
      mimeType: "application/pdf",
      originalUrl: "https://example.gov/files/notice.pdf",
      archiveStatus: "archived",
    });
  });

  it("returns undefined for external URLs and paths outside allowed directories", async () => {
    const attachmentDir = path.join(path.dirname(testDb.databasePath), "attachments");
    const outsidePath = path.join(path.dirname(testDb.databasePath), "secret.pdf");
    process.env.CRAWLER_ATTACHMENT_DIR = attachmentDir;
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(outsidePath, "secret");
    testDb.db.insert(bidAttachments)
      .values([
        {
          id: "external_pdf",
          bidId: "1",
          name: "External.pdf",
          url: "https://example.gov/external.pdf",
          sizeLabel: "1 MB",
          sortOrder: 100,
          createdAt: "2026-05-28T00:00:00.000Z",
        },
        {
          id: "outside_pdf",
          bidId: "1",
          name: "Outside.pdf",
          url: outsidePath,
          sizeLabel: "1 MB",
          sortOrder: 101,
          createdAt: "2026-05-28T00:00:00.000Z",
        },
      ])
      .run();

    await expect(getLocalBidAttachment(testDb.db, "1", "external_pdf")).resolves.toBeUndefined();
    await expect(getLocalBidAttachment(testDb.db, "1", "outside_pdf")).resolves.toBeUndefined();
  });

  it("rejects traversal paths that escape an allowed directory", async () => {
    const rootDir = path.dirname(testDb.databasePath);
    const attachmentDir = path.join(rootDir, "attachments");
    const secretPath = path.join(rootDir, "secret.pdf");
    process.env.CRAWLER_ATTACHMENT_DIR = attachmentDir;
    await mkdir(attachmentDir, { recursive: true });
    await writeFile(secretPath, "secret");
    testDb.db.insert(bidAttachments)
      .values({
        id: "traversal_pdf",
        bidId: "1",
        name: "Traversal.pdf",
        url: path.join(attachmentDir, "..", "secret.pdf"),
        sizeLabel: "6 bytes",
        sortOrder: 100,
        createdAt: "2026-05-28T00:00:00.000Z",
      })
      .run();

    await expect(getLocalBidAttachment(testDb.db, "1", "traversal_pdf")).resolves.toBeUndefined();
  });
});
