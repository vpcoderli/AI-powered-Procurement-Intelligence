import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildDemoBrowserEvidenceTargets,
  DEMO_BROWSER_EVIDENCE_VIEWPORTS,
  formatDemoBrowserEvidenceReport,
  parseDemoBrowserEvidenceArgs,
  runDemoBrowserEvidence,
  type DemoBrowserEvidenceCollector,
} from "./demo-browser-evidence";
import type { DemoSmokeCredentials } from "./demo-smoke";

type MockFetchHandler = (input: string, init?: RequestInit) => Response | Promise<Response>;

const origin = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200, setCookie?: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(setCookie ? { "Set-Cookie": setCookie } : {}),
    },
  });
}

function htmlResponse(title = "WinBids", heading = "WinBids") {
  return new Response(
    `<!doctype html><html><head><title>${title}</title></head><body><h1>${heading}</h1></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function cookieHeader(init?: RequestInit) {
  return new Headers(init?.headers).get("cookie") ?? "";
}

function jsonBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

function createMockFetch(routes: Record<string, MockFetchHandler>) {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const route = routes[`${method} ${url.pathname}`] ?? routes[`${method} ${url.pathname}${url.search}`];

    if (!route) {
      throw new Error(`Unexpected request: ${method} ${url.pathname}${url.search}`);
    }

    return route(url.toString(), init);
  });
}

function createMockCollector() {
  return vi.fn<DemoBrowserEvidenceCollector>(async (input) => {
    const text = input.target.role === "free-user" && input.route === "/admin"
      ? "Admin access denied"
      : `${input.target.role} ${input.route}`;
    const hasAdminSignal = input.target.role === "admin" || input.route === "/admin";
    const hasUpgradeSignal = input.target.role === "free-user" || input.route === "/search";

    return {
      collector: "mock" as const,
      finalUrl: input.url,
      title: `${input.target.role} ${input.route}`,
      headings: [text],
      pageHorizontalOverflow: false,
      layout: {
        clientWidth: input.viewport.width,
        scrollWidth: input.viewport.width,
      },
      authSignals: {
        hasLoginEntry: input.target.role === "anonymous",
        hasRegisterEntry: input.target.role === "anonymous",
        hasAdminSignal,
        hasUpgradeSignal,
        hasLockedSignal: hasUpgradeSignal,
      },
      expectedSignals: input.target.expectedSignals,
      screenshotPath: input.context.screenshotDir
        ? `${input.context.screenshotDir}/${input.target.role}-${input.viewport.name}.png`
        : null,
      notes: [],
    };
  });
}

function createFullMockFetch(overrides: Record<string, MockFetchHandler> = {}) {
  return createMockFetch({
    "GET /": () => htmlResponse("Home", "Home"),
    "GET /login": () => htmlResponse("Login", "Login"),
    "GET /register": () => htmlResponse("Register", "Register"),
    "GET /request-demo": () => htmlResponse("Request Demo", "Request Demo"),
    "GET /search": () => htmlResponse("Search", "Search"),
    "GET /bids/1": () => htmlResponse("Bid", "Bid"),
    "GET /settings": () => htmlResponse("Settings", "Settings"),
    "GET /admin": () => htmlResponse("Admin", "Admin"),
    "GET /intents/intent_paid": (_input, init) => {
      expect(cookieHeader(init)).toContain("session=business");
      return htmlResponse("Intent", "Intent");
    },
    "POST /api/auth/register": (_input, init) => {
      const body = jsonBody(init);
      expect(body.email).toMatch(/^demo-browser-/);
      expect(String(body.password)).not.toContain("AdminSecret");

      return jsonResponse(
        {
          user: {
            id: "user_normal",
            email: body.email,
            role: "user",
            tier: "free",
            features: ["bid_search", "intent_workspace"],
          },
        },
        201,
        "session=free; Path=/; HttpOnly",
      );
    },
    "POST /api/auth/login": (_input, init) => {
      const body = jsonBody(init);

      if (body.email === "admin@example.test") {
        expect(body.password).toBe("AdminSecret-Unit!");

        return jsonResponse(
          {
            user: {
              id: "user_admin",
              email: body.email,
              role: "admin",
              tier: "enterprise",
              features: ["admin_console"],
            },
          },
          200,
          "session=admin; Path=/; HttpOnly",
        );
      }

      expect(body.email).toBe("business@example.test");
      expect(body.password).toBe("BusinessSecret-Unit!");

      return jsonResponse(
        {
          user: {
            id: "user_business",
            email: body.email,
            role: "user",
            tier: "business",
            features: ["response.workspace.create"],
          },
        },
        200,
        "session=business; Path=/; HttpOnly",
      );
    },
    "POST /api/admin/users": (_input, init) => {
      expect(cookieHeader(init)).toContain("session=admin");
      const body = jsonBody(init);
      expect(body.tier).toBe("business");

      return jsonResponse({
        user: {
          id: "user_business",
          email: "business@example.test",
          role: "user",
          tier: "business",
        },
        temporaryPassword: "BusinessSecret-Unit!",
      }, 201);
    },
    "POST /api/bids/1/intent": (_input, init) => {
      expect(cookieHeader(init)).toContain("session=business");
      return jsonResponse({ intent: { id: "intent_paid" } });
    },
    ...overrides,
  });
}

describe("demo browser evidence script", () => {
  it("defines the anonymous, free, admin, and generated intent route matrix", () => {
    expect(DEMO_BROWSER_EVIDENCE_VIEWPORTS.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "tablet",
      "mobile",
    ]);
    expect(buildDemoBrowserEvidenceTargets("/intents/intent_paid").map((target) => `${target.role}:${target.route}`))
      .toEqual([
        "anonymous:/",
        "anonymous:/request-demo",
        "anonymous:/search",
        "anonymous:/bids/1",
        "anonymous:/settings",
        "free-user:/",
        "free-user:/settings",
        "free-user:/admin",
        "admin:/admin",
        "business-user:/intents/intent_paid",
      ]);
  });

  it("collects sanitized schema evidence for both viewports and role states", async () => {
    const collector = createMockCollector();
    const resetAdmin = vi.fn<() => Promise<DemoSmokeCredentials>>(async () => ({
      email: "admin@example.test",
      password: "AdminSecret-Unit!",
    }));

    const report = await runDemoBrowserEvidence({
      browser: "static",
      collector,
      fetchImpl: createFullMockFetch(),
      format: "json",
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      origin,
      outputPath: "/tmp/winbids-demo-browser-evidence-test.json",
      randomId: () => "unit",
      resetAdmin,
      screenshots: true,
      timeoutMs: 1000,
    });
    const formatted = formatDemoBrowserEvidenceReport(report, "json");
    const serialized = JSON.stringify(report) + formatted;

    expect(report.ok).toBe(true);
    expect(report.collector).toBe("mock");
    expect(report).toMatchObject({
      routes: [
        "/",
        "/request-demo",
        "/search",
        "/bids/1",
        "/settings",
        "/admin",
        "/intents/intent_paid",
      ],
      viewports: ["desktop", "tablet", "mobile"],
      overflowFailures: [],
      ctaFailures: [],
    });
    expect(report.summary).toMatchObject({
      failedEntries: 0,
      overflowFailures: 0,
      routes: 10,
      totalEntries: 30,
      viewports: 3,
    });
    expect(report.summary.roles).toEqual(["anonymous", "free-user", "admin", "business-user"]);
    expect(report.entries.map((entry) => `${entry.role}:${entry.route}:${entry.viewport.name}`)).toEqual([
      "anonymous:/:desktop",
      "anonymous:/:tablet",
      "anonymous:/:mobile",
      "anonymous:/request-demo:desktop",
      "anonymous:/request-demo:tablet",
      "anonymous:/request-demo:mobile",
      "anonymous:/search:desktop",
      "anonymous:/search:tablet",
      "anonymous:/search:mobile",
      "anonymous:/bids/1:desktop",
      "anonymous:/bids/1:tablet",
      "anonymous:/bids/1:mobile",
      "anonymous:/settings:desktop",
      "anonymous:/settings:tablet",
      "anonymous:/settings:mobile",
      "free-user:/:desktop",
      "free-user:/:tablet",
      "free-user:/:mobile",
      "free-user:/settings:desktop",
      "free-user:/settings:tablet",
      "free-user:/settings:mobile",
      "free-user:/admin:desktop",
      "free-user:/admin:tablet",
      "free-user:/admin:mobile",
      "admin:/admin:desktop",
      "admin:/admin:tablet",
      "admin:/admin:mobile",
      "business-user:/intents/intent_paid:desktop",
      "business-user:/intents/intent_paid:tablet",
      "business-user:/intents/intent_paid:mobile",
    ]);

    expect(report.entries[0]).toMatchObject({
      route: "/",
      viewport: { name: "desktop", width: 1440, height: 1100 },
      role: "anonymous",
      sessionState: "anonymous",
      pageHorizontalOverflow: false,
      layout: { clientWidth: 1440, scrollWidth: 1440 },
      screenshotPath: "/tmp/screenshots/anonymous-desktop.png",
      status: "pass",
    });
    const writtenReport = JSON.parse(readFileSync(report.outputPath, "utf8")) as Record<string, unknown>;
    expect(writtenReport).toMatchObject({
      ok: true,
      outputPath: report.outputPath,
      ctaFailures: [],
      overflowFailures: [],
    });
    expect(report.entries.flatMap((entry) => entry.headings)).toContain("business-user /intents/intent_paid");
    expect(report.entries.some((entry) => entry.authSignals.hasLoginEntry)).toBe(true);
    expect(report.entries.some((entry) => entry.authSignals.hasAdminSignal)).toBe(true);
    expect(report.entries.some((entry) => entry.authSignals.hasUpgradeSignal)).toBe(true);
    expect(serialized).not.toContain("AdminSecret-Unit!");
    expect(serialized).not.toContain("BusinessSecret-Unit!");
    expect(serialized).not.toContain("session=");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("password");
  });

  it("marks 4xx page routes as failed evidence instead of accepting missing pages", async () => {
    const report = await runDemoBrowserEvidence({
      collector: createMockCollector(),
      fetchImpl: createMockFetch({
        ...{},
        "GET /": () => htmlResponse("Home", "Home"),
        "GET /request-demo": () => htmlResponse("Request Demo", "Request Demo"),
        "GET /search": () => htmlResponse("Search", "Search"),
        "GET /bids/1": () => new Response("not found", { status: 404 }),
        "GET /settings": () => htmlResponse("Settings", "Settings"),
        "GET /admin": () => htmlResponse("Admin", "Admin"),
        "GET /intents/intent_paid": () => htmlResponse("Intent", "Intent"),
        "POST /api/auth/register": () =>
          jsonResponse({ user: { id: "user_normal", role: "user", tier: "free", features: [] } }, 201, "session=free"),
        "POST /api/auth/login": () =>
          jsonResponse({ user: { id: "user_admin", role: "admin", tier: "enterprise", features: [] } }, 200, "session=admin"),
        "POST /api/admin/users": () =>
          jsonResponse({ user: { email: "business@example.test" }, temporaryPassword: "BusinessSecret-Unit!" }, 201),
        "POST /api/bids/1/intent": () => jsonResponse({ intent: { id: "intent_paid" } }),
      }),
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      origin,
      outputPath: "/tmp/winbids-demo-browser-evidence-404-test.json",
      resetAdmin: async () => ({ email: "admin@example.test", password: "AdminSecret-Unit!" }),
    });

    expect(report.ok).toBe(false);
    expect(report.entries.filter((entry) => entry.route === "/bids/1").every((entry) => entry.status === "fail"))
      .toBe(true);
  });

  it("marks entries failed when expected signals are missing from page evidence", async () => {
    const collector = vi.fn<DemoBrowserEvidenceCollector>(async (input) => ({
      collector: "mock" as const,
      finalUrl: input.url,
      title: input.route === "/admin" ? "Admin" : `${input.target.role} ${input.route}`,
      headings: [input.route === "/admin" ? "Admin" : `${input.target.role} ${input.route}`],
      pageHorizontalOverflow: false,
      layout: {
        clientWidth: input.viewport.width,
        scrollWidth: input.viewport.width,
      },
      authSignals: {
        hasLoginEntry: false,
        hasRegisterEntry: false,
        hasAdminSignal: input.route === "/admin",
        hasUpgradeSignal: false,
        hasLockedSignal: false,
      },
      screenshotPath: null,
      notes: [],
    }));

    const report = await runDemoBrowserEvidence({
      collector,
      fetchImpl: createFullMockFetch(),
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      origin,
      outputPath: "/tmp/winbids-demo-browser-evidence-signal-test.json",
      resetAdmin: async () => ({ email: "admin@example.test", password: "AdminSecret-Unit!" }),
    });
    const freeAdminEntry = report.entries.find((entry) =>
      entry.role === "free-user" && entry.route === "/admin" && entry.viewport.name === "desktop"
    );

    expect(report.ok).toBe(false);
    expect(freeAdminEntry).toMatchObject({
      status: "fail",
      expectedSignals: ["admin-denied"],
    });
    expect(freeAdminEntry?.notes).toContain("Expected signal missing: admin-denied.");
    expect(JSON.parse(readFileSync(report.outputPath, "utf8"))).toMatchObject({
      ok: false,
      entries: expect.arrayContaining([
        expect.objectContaining({
          role: "free-user",
          route: "/admin",
          status: "fail",
          notes: expect.arrayContaining(["Expected signal missing: admin-denied."]),
        }),
      ]),
    });
  });

  it("marks failed homepage CTA routes without misreporting the evidence as ok", async () => {
    const report = await runDemoBrowserEvidence({
      collector: createMockCollector(),
      fetchImpl: createFullMockFetch({
        "GET /register": () => new Response("missing", { status: 404 }),
      }),
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      origin,
      outputPath: "/tmp/winbids-demo-browser-evidence-cta-test.json",
      resetAdmin: async () => ({ email: "admin@example.test", password: "AdminSecret-Unit!" }),
    });

    expect(report.ok).toBe(false);
    expect(report.ctaFailures).toEqual([
      {
        href: "/register",
        label: "Start Free",
        httpStatus: 404,
      },
    ]);
    expect(JSON.parse(readFileSync(report.outputPath, "utf8"))).toMatchObject({
      ok: false,
      ctaFailures: report.ctaFailures,
    });
  });

  it("writes a failed evidence report when authenticated demo fixtures cannot be created", async () => {
    const report = await runDemoBrowserEvidence({
      collector: createMockCollector(),
      fetchImpl: createFullMockFetch({
        "POST /api/auth/register": () =>
          jsonResponse({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500),
      }),
      now: () => new Date("2026-06-12T10:00:00.000Z"),
      origin,
      outputPath: "/tmp/winbids-demo-browser-evidence-fixture-failure-test.json",
      resetAdmin: async () => ({ email: "admin@example.test", password: "AdminSecret-Unit!" }),
    });

    expect(report.ok).toBe(false);
    expect(report.setupWarnings).toContain(
      "free-user session setup failed: free user register failed: POST /api/auth/register returned HTTP 500 (INTERNAL_ERROR).",
    );
    expect(report.entries.filter((entry) => entry.role === "anonymous").every((entry) => entry.status === "pass"))
      .toBe(true);
    expect(report.entries.filter((entry) => entry.role === "free-user").every((entry) => entry.status === "fail"))
      .toBe(true);
    expect(report.entries.find((entry) => entry.role === "free-user")).toMatchObject({
      httpStatus: 0,
      screenshotPath: null,
      notes: [
        "free-user session setup failed: free user register failed: POST /api/auth/register returned HTTP 500 (INTERNAL_ERROR).",
      ],
    });
    expect(JSON.parse(readFileSync(report.outputPath, "utf8"))).toMatchObject({
      ok: false,
      summary: { failedEntries: 9 },
    });
  });

  it("uses a stable default JSON output path so operators can find the latest evidence", async () => {
    const common = {
      browser: "static" as const,
      collector: createMockCollector(),
      fetchImpl: createFullMockFetch(),
      format: "json" as const,
      origin,
      randomId: () => "unit",
      resetAdmin: async () => ({ email: "admin@example.test", password: "AdminSecret-Unit!" }),
      screenshots: false,
      timeoutMs: 1000,
    };
    const first = await runDemoBrowserEvidence({
      ...common,
      now: () => new Date("2026-06-12T10:00:00.000Z"),
    });
    const second = await runDemoBrowserEvidence({
      ...common,
      now: () => new Date("2026-06-12T11:30:00.000Z"),
    });

    expect(first.outputPath).toBe(second.outputPath);
    expect(first.outputPath).toMatch(/demo-browser-evidence-latest\.json$/);
  });

  it("fails clearly when the local dev server is down", async () => {
    await expect(runDemoBrowserEvidence({
      collector: createMockCollector(),
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      origin,
      resetAdmin: async () => ({ email: "admin@example.test", password: "secret" }),
    })).rejects.toThrow(
      "Local demo app is not reachable at http://localhost:3000. Start it with npm run dev -- --port 3000 before running npm run demo:browser-evidence.",
    );
  });

  it("parses CLI arguments for origin, output, browser, format, screenshots, and timeout", () => {
    expect(parseDemoBrowserEvidenceArgs([])).toEqual({
      browser: "auto",
      format: "json",
      origin: "http://localhost:3000",
      outputPath: null,
      screenshots: true,
      timeoutMs: 30000,
    });
    expect(parseDemoBrowserEvidenceArgs([
      "--origin=http://127.0.0.1:3020",
      "--output=/tmp/proof.md",
      "--format=markdown",
      "--browser=static",
      "--no-screenshots",
      "--timeout-ms=1234",
    ])).toEqual({
      browser: "static",
      format: "markdown",
      origin: "http://127.0.0.1:3020",
      outputPath: "/tmp/proof.md",
      screenshots: false,
      timeoutMs: 1234,
    });
    expect(() => parseDemoBrowserEvidenceArgs(["--format=html"])).toThrow("--format must be json or markdown.");
    expect(() => parseDemoBrowserEvidenceArgs(["--browser=firefox"])).toThrow("--browser must be auto, chrome, or static.");
    expect(() => parseDemoBrowserEvidenceArgs(["--origin"])).toThrow("--origin requires a URL.");
  });

  it("wires the repeatable browser evidence runner into npm scripts", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["demo:browser-evidence"]).toBe("tsx scripts/demo-browser-evidence.ts");
  });
});
