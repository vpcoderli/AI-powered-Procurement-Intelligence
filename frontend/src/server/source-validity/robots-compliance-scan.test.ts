import { describe, expect, it } from "vitest";
import { ROBOTS_FETCH_USER_AGENT, scanSourceCompliance } from "./robots-compliance-scan";

describe("scanSourceCompliance robots.txt fetch", () => {
  it("identifies itself with the crawler's browser user agent so WAF-fronted portals answer", async () => {
    // BidNet Direct (AWS WAF) answered 403 to the previous "APSI Source Compliance Scan" agent
    // even for robots.txt, which made every county source look "unreachable" (2026-09-16).
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)) });
      return new Response("User-agent: *\nDisallow: /private/\n", { status: 200, headers: { "content-type": "text/plain" } });
    }) as typeof fetch;

    const report = await scanSourceCompliance(
      [{ id: "bidnet_ny_erie", label: "Erie County, NY (BidNet)", baseUrl: "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids" }],
      { fetchImpl, now: new Date("2026-09-16T00:00:00.000Z") },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://www.bidnetdirect.com/robots.txt");
    expect(seen[0].headers["user-agent"]).toBe(ROBOTS_FETCH_USER_AGENT);
    expect(ROBOTS_FETCH_USER_AGENT).toMatch(/^Mozilla\/5\.0 /);
    expect(report.results[0]).toMatchObject({ status: "clear", flagged: false });
  });
});
