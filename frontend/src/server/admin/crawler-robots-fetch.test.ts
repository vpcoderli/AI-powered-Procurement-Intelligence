import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { CrawlerRobotsFetchError, createCrawlerBackedRobotsFetch, parseFetchRobotsResponse } from "./crawler-robots-fetch";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
const mockedExecFile = vi.mocked(execFile);

type Callback = (error: Error | null, stdout: string, stderr: string) => void;

function answerWith(stdout: string, error: Error | null = null) {
  mockedExecFile.mockImplementationOnce(((_cmd: string, _args: string[], _opts: unknown, callback: Callback) => {
    callback(error, stdout, "");
    return { stdin: { end: vi.fn() } } as never;
  }) as never);
}

afterEach(() => vi.clearAllMocks());

describe("createCrawlerBackedRobotsFetch", () => {
  it("asks the Python crawler for robots.txt and exposes the answer as a Response", async () => {
    answerWith(JSON.stringify({ robots_url: "https://www.bidnetdirect.com/robots.txt", status: 200, final_url: "https://www.bidnetdirect.com/robots.txt", content_type: "text/plain", body: "User-agent: *\nDisallow: /private/\n", truncated: false, error: null }));
    const fetchImpl = createCrawlerBackedRobotsFetch();
    const response = await fetchImpl("https://www.bidnetdirect.com/robots.txt");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Disallow: /private/");
    expect(mockedExecFile).toHaveBeenCalledWith(expect.any(String), ["-m", "apsi_crawler.cli", "fetch-robots"], expect.objectContaining({ timeout: 30_000 }), expect.any(Function));
  });

  it("rejects like a network error when the crawler could not reach the host", async () => {
    answerWith(JSON.stringify({ robots_url: "https://x.gov/robots.txt", status: 0, final_url: null, body: "", error: "connection refused" }));
    await expect(createCrawlerBackedRobotsFetch()("https://x.gov/robots.txt")).rejects.toBeInstanceOf(CrawlerRobotsFetchError);
  });

  it("rejects when the subprocess fails or prints no JSON", async () => {
    answerWith("", new Error("spawn python3 ENOENT"));
    await expect(createCrawlerBackedRobotsFetch()("https://x.gov/robots.txt")).rejects.toThrow(/exited abnormally/);
    expect(() => parseFetchRobotsResponse("not json")).toThrow(CrawlerRobotsFetchError);
    expect(() => parseFetchRobotsResponse(JSON.stringify({ error: { code: "INVALID_REQUEST", message: "bad" } }))).toThrow(/INVALID_REQUEST/);
  });
});
