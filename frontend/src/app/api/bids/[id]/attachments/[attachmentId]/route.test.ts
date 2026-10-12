import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as attachmentService from "@/server/bids/attachments";
import * as bidService from "@/server/bids/service";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/bids/service", () => ({ getBidById: vi.fn() }));
vi.mock("@/server/bids/attachments", () => ({
  getBidAttachmentDownload: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const getBidAttachmentDownload = vi.mocked(attachmentService.getBidAttachmentDownload);
const mockedReadFile = vi.mocked(readFile);
const getBidById = vi.mocked(bidService.getBidById);

describe("GET /api/bids/[id]/attachments/[attachmentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getBidById.mockResolvedValue({ id: "1" } as Awaited<ReturnType<typeof bidService.getBidById>>);
  });

  it("withholds attachment bytes for a quarantined parent opportunity", async () => {
    getBidById.mockResolvedValueOnce(undefined);
    const response = await GET(new Request("http://localhost/api/bids/1/attachments/notice_pdf"), { params: Promise.resolve({ id: "1", attachmentId: "notice_pdf" }) });
    expect(response.status).toBe(404);
    expect(getBidAttachmentDownload).not.toHaveBeenCalled();
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["HTML masquerading as a PDF", Buffer.from("<!doctype html><html>Sign in</html>"), null, null, "application/pdf"],
    ["changed checksum", Buffer.from("%PDF-1.7 changed"), "a".repeat(64), null, "application/pdf"],
    ["a truncated file", Buffer.from("%PDF-1.7"), null, 40, "application/pdf"],
    ["a mismatched PDF signature", Buffer.from("not a PDF"), null, null, "application/pdf"],
    ["a mismatched office signature", Buffer.from("not an office file"), null, null, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ] as const)("returns an archive failure note for %s", async (_label, bytes, checksum, byteSize, mimeType) => {
    getBidAttachmentDownload.mockResolvedValueOnce({
      kind: "local", filePath: "/allowed/notice.pdf", filename: "Notice.pdf", mimeType,
      originalUrl: "https://example.gov/notice.pdf", archiveStatus: "archived", archiveError: null,
      availability: "archived_openable", downloadKind: "archived_file", storagePath: "archive/notice.pdf",
      checksumSha256: checksum ?? createHash("sha256").update(bytes).digest("hex"), byteSize: byteSize ?? bytes.length,
    });
    mockedReadFile.mockResolvedValueOnce(bytes);
    const response = await GET(new Request("http://localhost/api/bids/1/attachments/notice_pdf"), { params: Promise.resolve({ id: "1", attachmentId: "notice_pdf" }) });
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("X-WinBids-Attachment-Availability")).toBe("archive_failed");
    expect(await response.text()).not.toContain(bytes.toString());
  });

  it("returns a local attachment file from the bid attachment lookup", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce({
      kind: "local",
      filePath: "/allowed/notice.pdf",
      filename: "Notice.pdf",
      mimeType: "application/pdf",
      originalUrl: "https://example.gov/notice.pdf",
      archiveStatus: "archived",
      archiveError: null,
      availability: "archived_openable",
      downloadKind: "archived_file",
      storagePath: "archive/notice.pdf",
      checksumSha256: createHash("sha256").update("%PDF-1.7 contract notice").digest("hex"),
      byteSize: Buffer.byteLength("%PDF-1.7 contract notice"),
    });
    mockedReadFile.mockResolvedValueOnce(Buffer.from("%PDF-1.7 contract notice"));

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/notice_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "notice_pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Notice.pdf"');
    expect(response.headers.get("X-WinBids-Attachment-Availability")).toBe("archived_openable");
    expect(response.headers.get("X-WinBids-Download-Kind")).toBe("archived_file");
    expect(await response.text()).toBe("%PDF-1.7 contract notice");
    expect(getBidAttachmentDownload).toHaveBeenCalledWith(expect.anything(), "1", "notice_pdf");
  });

  it("returns 404 when the attachment row is missing", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce(undefined);

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/missing"),
      { params: Promise.resolve({ id: "1", attachmentId: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("X-WinBids-Attachment-Availability")).toBe("missing");
    expect(await response.json()).toEqual({
      error: {
        code: "ATTACHMENT_NOT_FOUND",
        message: "Attachment record not found; no archived file or source download note is available.",
      },
    });
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it("returns a non-empty download note when the resolved local file no longer exists", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce({
      kind: "local",
      filePath: "/allowed/missing.pdf",
      filename: "Missing.pdf",
      mimeType: null,
      originalUrl: "https://agency.example.gov/missing.pdf",
      archiveStatus: "archived",
      archiveError: null,
      availability: "archived_openable",
      downloadKind: "archived_file",
      storagePath: "archive/missing.pdf",
      checksumSha256: "sha256-missing",
    });
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/missing_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "missing_pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(response.headers.get("X-WinBids-Attachment-Availability")).toBe("archive_missing");
    expect(response.headers.get("X-WinBids-Download-Kind")).toBe("archive_status_note");
    const text = await response.text();
    expect(text).toContain("Archived file unavailable");
    expect(text).toContain("Original URL: https://agency.example.gov/missing.pdf");
  });

  it("returns a source download note for unarchived external attachments without calling it a local file", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce({
      kind: "fallback",
      availability: "source_download_note",
      noteKind: "source_download_note",
      filename: "Statement_of_Work_v2.pdf",
      mimeType: "text/plain; charset=utf-8",
      originalUrl: "https://sam.gov/opp/12345/sow.pdf",
      archiveStatus: "not_archived",
      archiveError: null,
      reason: "Attachment is not archived locally.",
    });

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/sow_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "sow_pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Statement_of_Work_v2-download-note.txt"',
    );
    expect(response.headers.get("X-WinBids-Attachment-Availability")).toBe("source_download_note");
    expect(response.headers.get("X-WinBids-Download-Kind")).toBe("source_download_note");
    const text = await response.text();
    expect(text).toContain("WinBids source attachment download note");
    expect(text).toContain("This is a source download note, not an archived local file.");
    expect(text).toContain("External source availability is not guaranteed.");
    expect(text).toContain("Original URL: https://sam.gov/opp/12345/sow.pdf");
    expect(text).not.toContain("Archived locally");
  });
});
