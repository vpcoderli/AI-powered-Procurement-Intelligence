import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AdminApiError,
  listAdminCrawlerLogs,
  listAdminDataSources,
  runSamGovCrawlerNow,
  updateAdminDataSource,
} from "./admin";

const mockFetch = vi.fn<typeof fetch>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
    ...init,
  });
}

describe("admin API client", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists admin data sources", async () => {
    const body = {
      summary: { totalSources: 1, enabledSources: 1, healthySources: 0, failingSources: 0 },
      sources: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminDataSources()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources");
  });

  it("updates data source enablement", async () => {
    const body = { source: { id: "sam_gov", isEnabled: false } };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(updateAdminDataSource("sam gov", { isEnabled: false })).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/data-sources/sam%20gov", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: false }),
    });
  });

  it("lists crawler logs", async () => {
    const body = { logs: [{ id: "log_1" }] };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(listAdminCrawlerLogs()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/admin/crawler-logs");
  });

  it("runs SAM.gov crawler now", async () => {
    const body = { status: "success", source: "SAM.gov" };
    mockFetch.mockResolvedValueOnce(jsonResponse(body));

    await expect(runSamGovCrawlerNow()).resolves.toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith("/api/crawler/sam-gov/run", { method: "POST" });
  });

  it("throws sanitized API errors", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "FORBIDDEN", message: "Admin access is required." } }, { status: 403 }),
    );

    const promise = listAdminDataSources();

    await expect(promise).rejects.toMatchObject({
      name: "AdminApiError",
      status: 403,
      code: "FORBIDDEN",
      message: "Admin access is required.",
    });
    await expect(promise).rejects.toBeInstanceOf(AdminApiError);
  });
});
