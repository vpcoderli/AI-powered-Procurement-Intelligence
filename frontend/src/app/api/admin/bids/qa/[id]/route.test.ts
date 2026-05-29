import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import * as bidQaRepository from "@/server/admin/bid-qa-repository";
import { createAdminBidQaPatch } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});
vi.mock("@/server/admin/bid-qa-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/bid-qa-repository")>();
  return { ...actual, updateAdminBidQaReview: vi.fn() };
});

describe("PATCH /api/admin/bids/qa/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "operator", userId: "operator_1" });
  });

  it("updates review status and note for admin/operator roles", async () => {
    vi.mocked(bidQaRepository.updateAdminBidQaReview).mockResolvedValueOnce({
      id: "bid_1",
      title: "Reviewed bid",
      source: "SAM.gov",
      sourceBidId: "SAM-1",
      issuerName: "Agency",
      stateCode: "US",
      deadlineDate: null,
      sourceConfidence: "medium",
      qualityFlags: [],
      qualityScore: 90,
      adminReviewStatus: "reviewed",
      adminReviewNote: "Looks good",
      adminReviewedAt: "2026-05-30T01:00:00.000Z",
      adminReviewedBy: "operator_1",
      detailArchiveStatus: "not_archived",
      detailArchiveError: null,
      attachmentCount: 0,
      archiveIssueCount: 0,
      archiveFailedCount: 0,
      archiveUnavailableCount: 0,
      updatedAt: "2026-05-30T01:00:00.000Z",
    });

    const PATCH = createAdminBidQaPatch({} as never);
    const response = await PATCH(
      new Request("http://localhost/api/admin/bids/qa/bid_1", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "reviewed", note: "Looks good" }),
      }),
      { params: Promise.resolve({ id: "bid_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.item).toEqual(expect.objectContaining({ id: "bid_1", adminReviewStatus: "reviewed" }));
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      roles: ["admin", "operator"],
    });
    expect(bidQaRepository.updateAdminBidQaReview).toHaveBeenCalledWith(
      expect.anything(),
      "bid_1",
      expect.objectContaining({
        reviewStatus: "reviewed",
        note: "Looks good",
        reviewerId: "operator_1",
      }),
    );
  });

  it("returns INVALID_REQUEST for unknown review status", async () => {
    const PATCH = createAdminBidQaPatch({} as never);
    const response = await PATCH(
      new Request("http://localhost/api/admin/bids/qa/bid_1", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "done" }),
      }),
      { params: Promise.resolve({ id: "bid_1" }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(bidQaRepository.updateAdminBidQaReview).not.toHaveBeenCalled();
  });

  it("uses local bypass as reviewer when local bypass is enabled", async () => {
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValueOnce({ kind: "local-bypass" });
    vi.mocked(bidQaRepository.updateAdminBidQaReview).mockResolvedValueOnce({
      id: "bid_1",
      title: "Reviewed bid",
      source: "SAM.gov",
      sourceBidId: "SAM-1",
      issuerName: "Agency",
      stateCode: "US",
      deadlineDate: null,
      sourceConfidence: "medium",
      qualityFlags: [],
      qualityScore: 90,
      adminReviewStatus: "needs_review",
      adminReviewNote: null,
      adminReviewedAt: "2026-05-30T01:00:00.000Z",
      adminReviewedBy: "local-bypass",
      detailArchiveStatus: "not_archived",
      detailArchiveError: null,
      attachmentCount: 0,
      archiveIssueCount: 0,
      archiveFailedCount: 0,
      archiveUnavailableCount: 0,
      updatedAt: "2026-05-30T01:00:00.000Z",
    });

    const PATCH = createAdminBidQaPatch({} as never);
    await PATCH(
      new Request("http://localhost/api/admin/bids/qa/bid_1", {
        method: "PATCH",
        body: JSON.stringify({ reviewStatus: "needs_review" }),
      }),
      { params: Promise.resolve({ id: "bid_1" }) },
    );

    expect(bidQaRepository.updateAdminBidQaReview).toHaveBeenCalledWith(
      expect.anything(),
      "bid_1",
      expect.objectContaining({ reviewerId: "local-bypass" }),
    );
  });
});
