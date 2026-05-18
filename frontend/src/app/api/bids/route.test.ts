import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetBidRepositoryForTests } from "@/server/bids/repository";
import * as bidService from "@/server/bids/service";
import { GET } from "./route";

describe("GET /api/bids", () => {
  beforeEach(() => {
    resetBidRepositoryForTests();
    vi.restoreAllMocks();
  });

  it("returns filtered bids and normalized filters", async () => {
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
  });

  it("parses comma-delimited and repeated states", async () => {
    const querySpy = vi.spyOn(bidService, "queryBids");

    const response = await GET(new Request("http://localhost/api/bids?states=sam,ca&states=tx"));

    expect(response.status).toBe(200);
    expect(querySpy).toHaveBeenCalledWith(
      expect.objectContaining({ states: ["sam", "ca", "tx"] }),
    );
  });

  it("returns INTERNAL_ERROR when querying bids fails", async () => {
    vi.spyOn(bidService, "queryBids").mockImplementationOnce(() => {
      throw new Error("database unavailable");
    });

    const response = await GET(new Request("http://localhost/api/bids"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toEqual({
      code: "INTERNAL_ERROR",
      message: "database unavailable",
    });
  });
});
