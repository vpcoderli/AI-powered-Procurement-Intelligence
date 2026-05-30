import { beforeEach, describe, expect, it, vi } from "vitest";
import * as adminAuth from "@/server/admin/auth";
import * as bidQaRepository from "@/server/admin/bid-qa-repository";
import { createAdminBidQaBatchPost } from "./route";

vi.mock("@/server/admin/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/auth")>();
  return { ...actual, requireAdminAccess: vi.fn() };
});
vi.mock("@/server/admin/bid-qa-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/admin/bid-qa-repository")>();
  return { ...actual, batchUpdateAdminBidQaItems: vi.fn() };
});

describe("POST /api/admin/bids/qa/batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(adminAuth.requireAdminAccess).mockResolvedValue({ kind: "admin", role: "operator", userId: "operator_1" });
  });

  it("batch updates selected QA items", async () => {
    vi.mocked(bidQaRepository.batchUpdateAdminBidQaItems).mockResolvedValueOnce({
      updatedCount: 2,
      items: [
        { id: "bid_1", adminReviewStatus: "reviewed" } as never,
        { id: "bid_2", adminReviewStatus: "reviewed" } as never,
      ],
    });

    const POST = createAdminBidQaBatchPost({} as never);
    const response = await POST(
      new Request("http://localhost/api/admin/bids/qa/batch", {
        method: "POST",
        body: JSON.stringify({ bidIds: ["bid_1", "bid_2"], reviewStatus: "reviewed", note: "Batch reviewed" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updatedCount).toBe(2);
    expect(adminAuth.requireAdminAccess).toHaveBeenCalledWith(expect.anything(), expect.any(Request), {
      roles: ["admin", "operator"],
    });
    expect(bidQaRepository.batchUpdateAdminBidQaItems).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bidIds: ["bid_1", "bid_2"],
        reviewStatus: "reviewed",
        note: "Batch reviewed",
        reviewerId: "operator_1",
      }),
    );
  });

  it("rejects mixed review and display actions", async () => {
    const POST = createAdminBidQaBatchPost({} as never);
    const response = await POST(
      new Request("http://localhost/api/admin/bids/qa/batch", {
        method: "POST",
        body: JSON.stringify({ bidIds: ["bid_1"], reviewStatus: "reviewed", displayStatus: "suppressed" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(bidQaRepository.batchUpdateAdminBidQaItems).not.toHaveBeenCalled();
  });
});
