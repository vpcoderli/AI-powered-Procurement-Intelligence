import { afterEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import {
  CrawlerRobotsFetchError,
  createCachedRobotsFetch,
  createCrawlerBackedRobotsFetch,
  parseFetchRobotsResponse,
} from "./crawler-robots-fetch";

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

describe("createCachedRobotsFetch", () => {
  it("fetches each robots URL once per instance and replays the body", async () => {
    const inner = vi.fn(async (input: RequestInfo | URL) =>
      new Response(`body for ${String(input)}`, { status: 200, headers: { "content-type": "text/plain" } }));
    const cached = createCachedRobotsFetch(inner as unknown as typeof fetch);

    const first = await cached("https://www.bidnetdirect.com/robots.txt");
    const second = await cached("https://www.bidnetdirect.com/robots.txt");
    const other = await cached("https://bonfirehub.com/robots.txt");

    expect(inner).toHaveBeenCalledTimes(2);
    expect(await first.text()).toBe("body for https://www.bidnetdirect.com/robots.txt");
    expect(await second.text()).toBe("body for https://www.bidnetdirect.com/robots.txt");
    expect(second.headers.get("content-type")).toBe("text/plain");
    expect(await other.text()).toContain("bonfirehub");
    expect(cached.hits()).toBe(1);
    expect(cached.misses()).toBe(2);
  });

  it("replays the status of a non-200 answer and hands every caller a fresh, unread Response", async () => {
    const inner = vi.fn(async () => new Response("nope", { status: 403 }));
    const cached = createCachedRobotsFetch(inner as unknown as typeof fetch);

    const first = await cached("https://x.gov/robots.txt");
    expect(await first.text()).toBe("nope");
    const second = await cached("https://x.gov/robots.txt");

    expect(second.status).toBe(403);
    expect(second.bodyUsed).toBe(false);
    expect(await second.text()).toBe("nope");
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("remembers a failure for the rest of the tick instead of asking an unreachable host again", async () => {
    const inner = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const cached = createCachedRobotsFetch(inner as unknown as typeof fetch);

    await expect(cached("https://down.gov/robots.txt")).rejects.toThrow("connection refused");
    await expect(cached("https://down.gov/robots.txt")).rejects.toThrow("connection refused");

    expect(inner).toHaveBeenCalledTimes(1);
    expect(cached.misses()).toBe(1);
    expect(cached.hits()).toBe(1);
  });

  it("keys the cache by URL for string, URL and Request inputs alike and forwards the init to the inner fetch", async () => {
    const inner = vi.fn(async () => new Response("ok"));
    const cached = createCachedRobotsFetch(inner as unknown as typeof fetch);
    const signal = new AbortController().signal;

    await cached("https://x.gov/robots.txt", { signal });
    await cached(new URL("https://x.gov/robots.txt"));
    await cached(new Request("https://x.gov/robots.txt"));

    expect(inner).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledWith("https://x.gov/robots.txt", { signal });
    expect(cached.hits()).toBe(2);
  });
});
