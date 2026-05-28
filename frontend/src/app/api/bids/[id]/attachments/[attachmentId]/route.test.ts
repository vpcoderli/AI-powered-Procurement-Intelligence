import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as attachmentService from "@/server/bids/attachments";
import { GET } from "./route";

vi.mock("@/server/db/client", () => ({ db: {} }));
vi.mock("@/server/bids/attachments", () => ({
  getLocalBidAttachment: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

const getLocalBidAttachment = vi.mocked(attachmentService.getLocalBidAttachment);
const mockedReadFile = vi.mocked(readFile);

describe("GET /api/bids/[id]/attachments/[attachmentId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a local attachment file from the bid attachment lookup", async () => {
    getLocalBidAttachment.mockResolvedValueOnce({
      filePath: "/allowed/notice.pdf",
      filename: "Notice.pdf",
      mimeType: "application/pdf",
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
    expect(getLocalBidAttachment).toHaveBeenCalledWith(expect.anything(), "1", "notice_pdf");
  });

  it("returns 404 when the attachment is missing, external, unsafe, or not on disk", async () => {
    getLocalBidAttachment.mockResolvedValueOnce(undefined);

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

  it("returns 404 when the resolved local file no longer exists", async () => {
    getLocalBidAttachment.mockResolvedValueOnce({
      filePath: "/allowed/missing.pdf",
      filename: "Missing.pdf",
      mimeType: null,
    });
    mockedReadFile.mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ENOENT" }));

    const response = await GET(
      new Request("http://localhost/api/bids/1/attachments/missing_pdf"),
      { params: Promise.resolve({ id: "1", attachmentId: "missing_pdf" }) },
    );

    expect(response.status).toBe(404);
  });
});
