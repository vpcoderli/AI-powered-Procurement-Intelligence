import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_BIDS } from "@/lib/mock-data";
import * as bidService from "@/server/bids/service";
import { GET } from "./route";

vi.mock("@/server/bids/service", () => ({
  queryBids: vi.fn(),
}));

const queryBids = vi.mocked(bidService.queryBids);

describe("GET /api/bids", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryBids.mockResolvedValue({
      bids: [],
      total: 0,
      filters: {
        q: "",
        states: [],
        issuerType: "all",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
    });
  });

  it("returns filtered bids and normalized filters", async () => {
    queryBids.mockResolvedValueOnce({
      bids: [{ ...MOCK_BIDS[0], attachments: [...MOCK_BIDS[0].attachments], tags: [...MOCK_BIDS[0].tags] }],
      total: 1,
      filters: {
        q: "cloud",
        states: [],
        issuerType: "federal",
        deadline: "any",
        published: "any",
        sort: "relevance",
      },
    });

    const response = await GET(
      new Request("http://localhost/api/bids?q=cloud&issuerType=federal"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.bids[0].title).toBe("Enterprise Cloud Migration Services");
    expect(body.filters.q).toBe("cloud");
  });

  it("falls back to defaults for invalid enum query values", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/bids?issuerType=bogus&deadline=last24&published=next7&sort=bogus",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.filters.issuerType).toBe("all");
    expect(body.filters.deadline).toBe("any");
    expect(body.filters.published).toBe("any");
    expect(body.filters.sort).toBe("relevance");
    expect(queryBids).toHaveBeenCalledWith(
      expect.objectContaining({
        issuerType: undefined,
        deadline: undefined,
        published: undefined,
        sort: undefined,
      }),
    );
  });

  it("parses comma-delimited and repeated states", async () => {
    const response = await GET(new Request("http://localhost/api/bids?states=sam,ca&states=tx"));

    expect(response.status).toBe(200);
    expect(queryBids).toHaveBeenCalledWith(
      expect.objectContaining({ states: ["sam", "ca", "tx"] }),
    );
  });

  it("returns INTERNAL_ERROR when querying bids fails", async () => {
    queryBids.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await GET(new Request("http://localhost/api/bids"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "database unavailable",
    });
  });
});
