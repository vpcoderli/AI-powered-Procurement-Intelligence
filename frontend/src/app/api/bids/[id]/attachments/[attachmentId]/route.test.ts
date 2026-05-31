import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as attachmentService from "@/server/bids/attachments";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/bids/attachments", () => ({
  getBidAttachmentDownload: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const getBidAttachmentDownload = vi.mocked(attachmentService.getBidAttachmentDownload);
const mockedReadFile = vi.mocked(readFile);

describe("GET /api/bids/[id]/attachments/[attachmentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    });
    mockedReadFile.mockResolvedValueOnce(Buffer.from("contract notice"));

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/notice_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "notice_pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="Notice.pdf"');
    expect(await response.text()).toBe("contract notice");
    expect(getBidAttachmentDownload).toHaveBeenCalledWith(expect.anything(), "1", "notice_pdf");
  });

  it("returns 404 when the attachment row is missing", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce(undefined);

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/missing"),
      { params: Promise.resolve({ id: "1", attachmentId: "missing" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "ATTACHMENT_NOT_FOUND", message: "Attachment not found" },
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
    });
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/missing_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "missing_pdf" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toContain("Original URL: https://agency.example.gov/missing.pdf");
  });

  it("returns a non-empty download note for unarchived external attachments", async () => {
    getBidAttachmentDownload.mockResolvedValueOnce({
      kind: "fallback",
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
    expect(await response.text()).toContain("Original URL: https://sam.gov/opp/12345/sow.pdf");
  });
});
