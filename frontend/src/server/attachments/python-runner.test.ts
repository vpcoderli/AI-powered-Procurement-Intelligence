import { describe, expect, it } from "vitest";
import { ArchiveAttachmentsContractError, parseArchiveAttachmentsResponse } from "./python-runner";

const RESULT = {
  id: "il_bidbuy:27-444:attachment:1",
  archive_status: "archived",
  storage_path: "illinois_bidbuy/il_bidbuy_27-444/il_bidbuy_27-444_attachment_1.pdf",
  byte_size: 468205,
  content_type: "application/pdf",
  checksum_sha256: "deadbeef",
  archive_error: null,
  failure_kind: null,
  final_url: "https://portal/doc.pdf",
  fetched_at: "2026-09-16T03:00:00+00:00",
  method: "direct",
};

describe("parseArchiveAttachmentsResponse", () => {
  it("parses the C1 response document", () => {
    const response = parseArchiveAttachmentsResponse(
      JSON.stringify({ results: [RESULT], stats: { archived: 1, failed: 0, unavailable: 0, duration_ms: 1234 } }),
    );

    expect(response.results).toEqual([RESULT]);
    expect(response.stats).toEqual({ archived: 1, failed: 0, unavailable: 0, duration_ms: 1234 });
  });

  it("coerces numeric strings and blank optionals", () => {
    const response = parseArchiveAttachmentsResponse(
      JSON.stringify({
        results: [{ id: "a", archive_status: "failed", byte_size: "0", storage_path: "   ", failure_kind: "login_wall" }],
        stats: {},
      }),
    );

    expect(response.results[0]).toEqual({
      id: "a",
      archive_status: "failed",
      storage_path: null,
      byte_size: 0,
      content_type: null,
      checksum_sha256: null,
      archive_error: null,
      failure_kind: "login_wall",
      final_url: null,
      fetched_at: null,
      method: null,
    });
    expect(response.stats).toEqual({ archived: 0, failed: 0, unavailable: 0, duration_ms: 0 });
  });

  it("rejects anything that is not the contract shape", () => {
    expect(() => parseArchiveAttachmentsResponse("not json")).toThrow(ArchiveAttachmentsContractError);
    expect(() => parseArchiveAttachmentsResponse("[]")).toThrow("was not a JSON object");
    expect(() => parseArchiveAttachmentsResponse("{}")).toThrow("missing a results array");
    expect(() => parseArchiveAttachmentsResponse(JSON.stringify({ results: [1] }))).toThrow("was not a JSON object");
    expect(() => parseArchiveAttachmentsResponse(JSON.stringify({ results: [{ archive_status: "archived" }] }))).toThrow(
      "missing an id",
    );
    expect(() =>
      parseArchiveAttachmentsResponse(JSON.stringify({ results: [{ id: "a", archive_status: "partial" }] })),
    ).toThrow("unsupported archive_status");
  });
});
