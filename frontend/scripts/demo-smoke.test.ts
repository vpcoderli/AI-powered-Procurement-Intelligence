import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  formatDemoSmokeReport,
  parseDemoSmokeArgs,
  runDemoSmoke,
  type DemoSmokeCredentials,
} from "./demo-smoke";

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

function htmlResponse() {
  return new Response("<!doctype html><html><body>WinBids</body></html>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
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

describe("demo smoke script", () => {
  it("runs repeatable anonymous, ordinary user, admin, paid, bid, and attachment checks", async () => {
    const resetAdmin = vi.fn<() => Promise<DemoSmokeCredentials>>(async () => ({
      email: "admin@example.test",
      password: "AdminSecret-Unit!",
    }));
    const fetchImpl = createMockFetch({
      "GET /": () => htmlResponse(),
      "GET /search": () => htmlResponse(),
      "GET /bids/1": () => htmlResponse(),
      "GET /settings": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=normal");
        return htmlResponse();
      },
      "GET /api/intents/smoke-auth-required/response-workspace": () =>
        jsonResponse({ error: { code: "AUTH_REQUIRED", message: "Authentication is required" } }, 401),
      "GET /api/bids/1": () =>
        jsonResponse({
          bid: {
            id: "1",
            title: "Demo bid",
            attachments: [
              {
                name: "Statement of Work.pdf",
                url: "/api/bids/1/attachments/attachment_1",
                originalUrl: "https://sam.gov/workspace/demo-download",
              },
            ],
          },
        }),
      "GET /api/bids/1/attachments/attachment_1": () =>
        new Response("download note", { headers: { "Content-Type": "text/plain" } }),
      "POST /api/auth/register": (_input, init) => {
        const body = jsonBody(init);
        expect(body.email).toMatch(/^demo-smoke-/);
        expect(String(body.password)).toHaveLength(24);
        return jsonResponse(
          {
            user: {
              id: "user_normal",
              email: body.email,
              displayName: "Demo Smoke User",
              role: "user",
              tier: "free",
              features: ["bid_search"],
            },
          },
          201,
          "session=registered; Path=/; HttpOnly",
        );
      },
      "GET /api/auth/session": (_input, init) => {
        const cookie = cookieHeader(init);

        if (cookie.includes("session=normal")) {
          return jsonResponse({
            user: {
              id: "user_normal",
              email: "demo-smoke-unit@example.test",
              role: "user",
              tier: "free",
              features: ["bid_search"],
            },
          });
        }

        if (cookie.includes("session=paid")) {
          return jsonResponse({
            user: {
              id: "user_paid",
              email: "paid@example.test",
              role: "user",
              tier: "business",
              features: ["response.workspace.create"],
            },
          });
        }

        return jsonResponse({ user: null });
      },
      "PATCH /api/account/profile": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=registered");
        return jsonResponse({
          user: {
            id: "user_normal",
            email: "demo-smoke-unit@example.test",
            displayName: "Demo Smoke Verified",
            role: "user",
            tier: "free",
            features: ["bid_search"],
          },
        });
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

        if (body.email === "paid@example.test") {
          expect(body.password).toBe("PaidSecret-Unit!");
          return jsonResponse(
            {
              user: {
                id: "user_paid",
                email: body.email,
                role: "user",
                tier: "business",
                features: ["response.workspace.create"],
              },
            },
            200,
            "session=paid; Path=/; HttpOnly",
          );
        }

        return jsonResponse(
          {
            user: {
              id: "user_normal",
              email: body.email,
              role: "user",
              tier: "free",
              features: ["bid_search"],
            },
          },
          200,
          "session=normal; Path=/; HttpOnly",
        );
      },
      "GET /api/admin/users": (_input, init) => {
        const cookie = cookieHeader(init);

        if (cookie.includes("session=normal")) {
          return jsonResponse({ error: { code: "FORBIDDEN", message: "Admin access is required." } }, 403);
        }

        expect(cookie).toContain("session=admin");
        return jsonResponse({ users: [] });
      },
      "GET /api/dashboard/summary": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=admin");
        return jsonResponse({ summary: { account: { role: "admin", tier: "enterprise" } } });
      },
      "GET /api/admin/data-sources": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=admin");
        return jsonResponse({ sources: [], summary: { totalSources: 0 } });
      },
      "GET /api/admin/risk-check": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=admin");
        return jsonResponse({ report: { ok: true }, history: [], trend: {} });
      },
      "POST /api/admin/users": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=admin");
        const body = jsonBody(init);
        expect(body.tier).toBe("business");
        return jsonResponse({
          user: {
            id: "user_paid",
            email: "paid@example.test",
            displayName: "Paid Demo Smoke",
            role: "user",
            tier: "business",
            isDisabled: false,
          },
          temporaryPassword: "PaidSecret-Unit!",
        }, 201);
      },
      "POST /api/bids/1/intent": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=paid");
        return jsonResponse({ intent: { id: "intent_paid" } });
      },
      "GET /api/intents/intent_paid/response-workspace": (_input, init) => {
        expect(cookieHeader(init)).toContain("session=paid");
        return jsonResponse({ workspace: { summary: { total: 3 } } });
      },
    });

    const report = await runDemoSmoke({
      fetchImpl,
      origin,
      randomId: () => "unit",
      resetAdmin,
    });
    const formatted = formatDemoSmokeReport(report);
    const serialized = JSON.stringify(report) + formatted;

    expect(report.ok).toBe(true);
    expect(report.steps.map((step) => step.name)).toEqual([
      "anonymous public pages",
      "anonymous workspace auth boundary",
      "bid detail API and attachment download",
      "ordinary user auth/settings boundary",
      "ordinary user admin rejection",
      "admin reset/login boundary",
      "admin APIs",
      "paid gated workspace API",
    ]);
    expect(resetAdmin).toHaveBeenCalledOnce();
    expect(formatted).toContain("Demo smoke PASS");
    expect(serialized).not.toContain("AdminSecret-Unit!");
    expect(serialized).not.toContain("PaidSecret-Unit!");
    expect(serialized).not.toContain("session=");
  });

  it("fails clearly when the local dev server is down", async () => {
    await expect(runDemoSmoke({
      fetchImpl: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
      origin,
      resetAdmin: async () => ({ email: "admin@example.test", password: "secret" }),
    })).rejects.toThrow(
      "Local demo app is not reachable at http://localhost:3000. Start it with npm run dev -- --port 3000 before running npm run demo:smoke.",
    );
  });

  it("reports auth failures without leaking credentials or response bodies", async () => {
    const resetAdmin = async () => ({
      email: "admin@example.test",
      password: "AdminSecret-Unit!",
    });
    const fetchImpl = createMockFetch({
      "GET /": () => htmlResponse(),
      "GET /search": () => htmlResponse(),
      "GET /bids/1": () => htmlResponse(),
      "GET /api/intents/smoke-auth-required/response-workspace": () =>
        jsonResponse({ error: { code: "AUTH_REQUIRED", message: "Authentication is required" } }, 401),
      "GET /api/bids/1": () =>
        jsonResponse({
          bid: {
            id: "1",
            title: "Demo bid",
            attachments: [{ name: "SOW.pdf", url: "/api/bids/1/attachments/a1" }],
          },
        }),
      "GET /api/bids/1/attachments/a1": () => new Response("ok"),
      "POST /api/auth/register": () =>
        jsonResponse({
          user: { id: "user_normal", email: "demo@example.test", role: "user", tier: "free", features: [] },
        }, 201, "session=registered; Path=/"),
      "GET /api/auth/session": () =>
        jsonResponse({ user: { id: "user_normal", role: "user", tier: "free", features: [] } }),
      "GET /settings": () => htmlResponse(),
      "PATCH /api/account/profile": () =>
        jsonResponse({ user: { id: "user_normal", role: "user", tier: "free", features: [] } }),
      "POST /api/auth/login": (_input, init) => {
        const body = jsonBody(init);
        if (body.email === "admin@example.test") {
          return jsonResponse(
            {
              error: {
                code: "INVALID_CREDENTIALS",
                message: "bad password AdminSecret-Unit!",
              },
            },
            401,
          );
        }

        return jsonResponse(
          { user: { id: "user_normal", role: "user", tier: "free", features: [] } },
          200,
          "session=normal; Path=/",
        );
      },
      "GET /api/admin/users": () =>
        jsonResponse({ error: { code: "FORBIDDEN", message: "Admin access is required." } }, 403),
    });

    let message = "";
    try {
      await runDemoSmoke({ fetchImpl, origin, resetAdmin, randomId: () => "unit" });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("admin login failed");
    expect(message).toContain("INVALID_CREDENTIALS");
    expect(message).not.toContain("AdminSecret-Unit!");
    expect(message).not.toContain("admin@example.test");
  });

  it("parses --origin flags for npm run demo:smoke", () => {
    expect(parseDemoSmokeArgs([]).origin).toBe("http://localhost:3000");
    expect(parseDemoSmokeArgs(["--origin=http://127.0.0.1:4000"]).origin).toBe("http://127.0.0.1:4000");
    expect(parseDemoSmokeArgs(["--origin", "http://localhost:4001"]).origin).toBe("http://localhost:4001");
    expect(() => parseDemoSmokeArgs(["--origin"])).toThrow("--origin requires a URL.");
  });

  it("wires the repeatable smoke runner into npm scripts", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.["demo:smoke"]).toBe("tsx scripts/demo-smoke.ts");
  });
});
