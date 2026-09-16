import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import {
  DISCOVER_TENANT_TIMEOUT_MS,
  TenantDiscoveryError,
  parseDiscoverTenantResponse,
  runDiscoverTenant,
} from "./tenant-discovery";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const mockedExecFile = vi.mocked(execFile);

const RESPONSE = {
  candidates: [
    {
      url: "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids",
      status: 200,
      title: "Franklin County, OH",
      label_match: true,
      rows: 4,
      empty_state: false,
    },
  ],
  suggested_base_url: "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids",
  reason: "label_match_with_rows",
};

describe("parseDiscoverTenantResponse", () => {
  it("normalises the C4 document to camelCase", () => {
    expect(parseDiscoverTenantResponse(JSON.stringify(RESPONSE))).toEqual({
      candidates: [
        {
          url: "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids",
          status: 200,
          title: "Franklin County, OH",
          labelMatch: true,
          rows: 4,
          emptyState: false,
        },
      ],
      suggestedBaseUrl: "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids",
      reason: "label_match_with_rows",
    });
  });

  it("defaults missing fields and drops candidates without a URL", () => {
    expect(
      parseDiscoverTenantResponse(
        JSON.stringify({ candidates: [{ status: 404 }, { url: "https://x", rows: "2" }], reason: "waf_challenge" }),
      ),
    ).toEqual({
      candidates: [{ url: "https://x", status: null, title: null, labelMatch: false, rows: 2, emptyState: false }],
      suggestedBaseUrl: null,
      reason: "waf_challenge",
    });
  });

  it("rejects non-JSON and non-object documents", () => {
    expect(() => parseDiscoverTenantResponse("not json")).toThrow(TenantDiscoveryError);
    expect(() => parseDiscoverTenantResponse("[]")).toThrow(/not a JSON object/);
  });
});

describe("runDiscoverTenant", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function stubChild(error: Error | null, stdout: string, stderr = "") {
    const stdin = { end: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedExecFile.mockImplementation(((_bin: string, _args: string[], _options: unknown, callback: any) => {
      callback(error, stdout, stderr);
      return { stdin } as never;
    }) as never);
    return stdin;
  }

  it("feeds the request on stdin and parses stdout", async () => {
    const stdin = stubChild(null, JSON.stringify(RESPONSE));

    const result = await runDiscoverTenant({
      base_url: "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids",
      label: "Franklin County, OH (BidNet)",
      state_code: "OH",
      provider_family: "bidnet",
      max_requests: 6,
      min_interval_seconds: 3,
    });

    expect(result.suggestedBaseUrl).toBe(RESPONSE.suggested_base_url);
    expect(stdin.end).toHaveBeenCalledWith(expect.stringContaining('"provider_family":"bidnet"'));

    const [bin, args, options] = mockedExecFile.mock.calls[0];
    expect(bin).toBe("python3");
    expect(args).toEqual(["-m", "apsi_crawler.cli", "discover-tenant"]);
    expect(options).toMatchObject({ timeout: DISCOVER_TENANT_TIMEOUT_MS });
  });

  it("reports an abnormal exit and an unparseable document as TenantDiscoveryError", async () => {
    stubChild(new Error("boom"), "", "traceback");
    await expect(
      runDiscoverTenant({ base_url: "https://x", label: "x", state_code: "OH", provider_family: null, max_requests: 1, min_interval_seconds: 0 }),
    ).rejects.toThrow(/exited abnormally: boom \(traceback\)/);

    stubChild(null, "<html>");
    await expect(
      runDiscoverTenant({ base_url: "https://x", label: "x", state_code: "OH", provider_family: null, max_requests: 1, min_interval_seconds: 0 }),
    ).rejects.toThrow(/did not write a JSON document/);
  });
});
