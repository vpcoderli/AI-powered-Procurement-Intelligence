import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import {
  validateBidSourceUrl,
  validateStateAttachmentUrl,
} from "../src/server/source-validity/url-validity";

export interface DemoSmokeCredentials {
  email: string;
  password: string;
}

export interface DemoSmokeStep {
  name: string;
  status: "pass";
}

export interface DemoSmokeReport {
  ok: true;
  origin: string;
  checkedAt: string;
  steps: DemoSmokeStep[];
}

export interface DemoSmokeCliOptions {
  origin: string;
}

export type DemoSmokeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface DemoSmokeOptions {
  origin: string;
  fetchImpl?: DemoSmokeFetch;
  now?: () => Date;
  randomId?: () => string;
  resetAdmin?: () => Promise<DemoSmokeCredentials>;
}

interface SmokeContext {
  origin: string;
  fetchImpl: DemoSmokeFetch;
  now: () => Date;
  randomId: () => string;
  resetAdmin: () => Promise<DemoSmokeCredentials>;
  steps: DemoSmokeStep[];
}

interface JsonRequestOptions {
  body?: unknown;
  expectedStatus?: number | number[];
  jar?: CookieJar;
  label: string;
  method?: string;
}

interface HtmlRequestOptions {
  jar?: CookieJar;
  label: string;
}

type JsonObject = Record<string, unknown>;

class SmokeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmokeError";
  }
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  header() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  store(response: Response) {
    for (const header of setCookieHeaders(response)) {
      this.storeOne(header);
    }
  }

  private storeOne(header: string) {
    const pair = header.split(";")[0];
    const separator = pair.indexOf("=");

    if (separator <= 0) return;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name) return;

    if (/;\s*max-age=0(?:;|$)/i.test(header) || value === "") {
      this.cookies.delete(name);
      return;
    }

    this.cookies.set(name, value);
  }
}

function setCookieHeaders(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.();
  if (values?.length) return values;

  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
}

function endpoint(origin: string, pathname: string) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  return new URL(pathname, origin).toString();
}

function normalizeOrigin(value: string) {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new SmokeError(`Invalid --origin URL: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SmokeError(`Invalid --origin URL: ${value}`);
  }

  return parsed.origin;
}

function expectedStatuses(value: number | number[] | undefined) {
  return new Set(Array.isArray(value) ? value : [value ?? 200]);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(body: unknown) {
  if (!isObject(body) || !isObject(body.error) || typeof body.error.code !== "string") {
    return null;
  }

  return body.error.code;
}

function httpError(label: string, method: string, pathname: string, response: Response, body?: unknown) {
  const code = body === undefined ? null : errorCode(body);
  const suffix = code ? ` (${code})` : "";

  return new SmokeError(`${label} failed: ${method} ${pathname} returned HTTP ${response.status}${suffix}.`);
}

async function parseJson(response: Response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    return {};
  }
}

async function fetchPath(
  context: SmokeContext,
  pathname: string,
  init: RequestInit = {},
  jar?: CookieJar,
) {
  const headers = new Headers(init.headers);
  const cookie = jar?.header();
  if (cookie) headers.set("cookie", cookie);

  const response = await context.fetchImpl(endpoint(context.origin, pathname), {
    ...init,
    headers,
  });

  jar?.store(response);

  return response;
}

async function requestJson<T = unknown>(
  context: SmokeContext,
  pathname: string,
  options: JsonRequestOptions,
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers();
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }

  const response = await fetchPath(context, pathname, { method, headers, body }, options.jar);
  const parsed = await parseJson(response);

  if (!expectedStatuses(options.expectedStatus).has(response.status)) {
    throw httpError(options.label, method, pathname, response, parsed);
  }

  return parsed as T;
}

async function requestHtml(
  context: SmokeContext,
  pathname: string,
  options: HtmlRequestOptions,
) {
  const response = await fetchPath(context, pathname, { method: "GET" }, options.jar);
  const text = await response.text();

  if (response.status < 200 || response.status >= 400) {
    throw httpError(options.label, "GET", pathname, response);
  }

  if (!/<html[\s>]/i.test(text)) {
    throw new SmokeError(`${options.label} failed: GET ${pathname} did not return HTML.`);
  }
}

async function assertReachable(context: SmokeContext) {
  try {
    const response = await context.fetchImpl(context.origin, { method: "GET" });
    if (response.status >= 500) {
      throw new SmokeError(`Local demo app at ${context.origin} returned HTTP ${response.status}.`);
    }
  } catch (error) {
    if (error instanceof SmokeError) throw error;

    throw new SmokeError(
      `Local demo app is not reachable at ${context.origin}. Start it with npm run dev -- --port 3000 before running npm run demo:smoke.`,
    );
  }
}

function assertError(body: unknown, expectedCode: string, label: string) {
  const code = errorCode(body);
  if (code !== expectedCode) {
    throw new SmokeError(`${label} failed: expected ${expectedCode}, got ${code ?? "no error code"}.`);
  }
}

function publicUser(value: unknown) {
  return isObject(value) && isObject(value.user) ? value.user : null;
}

function assertUserTier(body: unknown, expectedTier: "free" | "business" | "enterprise", label: string) {
  const user = publicUser(body);
  if (!user || user.tier !== expectedTier) {
    throw new SmokeError(`${label} failed: expected ${expectedTier} session.`);
  }
}

function assertAdminUser(body: unknown, label: string) {
  const user = publicUser(body);
  if (!user || user.role !== "admin") {
    throw new SmokeError(`${label} failed: expected admin login.`);
  }
}

function generatedCredentials(randomId: () => string) {
  const suffix = randomId().replace(/[^a-z0-9]/gi, "").slice(0, 8).padEnd(8, "0");

  return {
    email: `demo-smoke-${Date.now()}-${suffix}@example.test`,
    password: `DemoSmoke-${suffix}-Pass!`,
  };
}

function generatedPaidEmail(randomId: () => string) {
  const suffix = randomId().replace(/[^a-z0-9]/gi, "").slice(0, 8).padEnd(8, "0");
  return `demo-smoke-paid-${Date.now()}-${suffix}@example.test`;
}

function bidAttachments(body: unknown) {
  if (!isObject(body) || !isObject(body.bid) || body.bid.id !== "1" || !Array.isArray(body.bid.attachments)) {
    throw new SmokeError("bid detail API failed: /api/bids/1 did not return bid 1 with attachments.");
  }

  return body.bid.attachments;
}

function assertSafeAttachment(attachment: unknown) {
  if (!isObject(attachment) || typeof attachment.url !== "string") {
    throw new SmokeError("bid attachment check failed: attachment URL is missing.");
  }

  if (!attachment.url.startsWith("/api/bids/1/attachments/")) {
    throw new SmokeError("bid attachment check failed: attachment URL is not routed through /api/bids/1/attachments/.");
  }

  const findings = validateStateAttachmentUrl(attachment.url);
  if (findings.length > 0) {
    throw new SmokeError(`bid attachment check failed: ${findings.map((finding) => finding.code).join(", ")}.`);
  }

  if (typeof attachment.originalUrl === "string") {
    const placeholderFindings = validateBidSourceUrl(attachment.originalUrl)
      .filter((finding) => finding.code === "placeholder_url");
    if (placeholderFindings.length > 0) {
      throw new SmokeError("bid attachment check failed: original URL is a known placeholder.");
    }
  }

  return attachment.url;
}

function assertIntentId(body: unknown) {
  if (!isObject(body) || !isObject(body.intent) || typeof body.intent.id !== "string") {
    throw new SmokeError("paid gated workspace API failed: bid intent was not created.");
  }

  return body.intent.id;
}

async function step<T>(context: SmokeContext, name: string, run: () => Promise<T>) {
  const value = await run();
  context.steps.push({ name, status: "pass" });
  return value;
}

async function anonymousPublicPages(context: SmokeContext, jar: CookieJar) {
  for (const pathname of ["/", "/search", "/bids/1"]) {
    await requestHtml(context, pathname, { jar, label: `anonymous ${pathname}` });
  }
}

async function anonymousWorkspaceBoundary(context: SmokeContext, jar: CookieJar) {
  const body = await requestJson(context, "/api/intents/smoke-auth-required/response-workspace", {
    expectedStatus: 401,
    jar,
    label: "anonymous workspace auth boundary",
  });
  assertError(body, "AUTH_REQUIRED", "anonymous workspace auth boundary");
}

async function bidAndAttachmentSmoke(context: SmokeContext) {
  const body = await requestJson(context, "/api/bids/1", {
    label: "bid detail API",
  });
  const [firstAttachment] = bidAttachments(body);
  const attachmentUrl = assertSafeAttachment(firstAttachment);
  const response = await fetchPath(context, attachmentUrl, { method: "GET" });

  if (response.status === 404) {
    throw httpError("attachment download", "GET", attachmentUrl, response);
  }

  if (response.status < 200 || response.status >= 400) {
    throw httpError("attachment download", "GET", attachmentUrl, response);
  }
}

async function ordinaryUserSmoke(context: SmokeContext) {
  const credentials = generatedCredentials(context.randomId);
  const registerJar = new CookieJar();
  const loginJar = new CookieJar();

  const registerBody = await requestJson(context, "/api/auth/register", {
    body: {
      email: credentials.email,
      password: credentials.password,
      displayName: "Demo Smoke User",
    },
    expectedStatus: 201,
    jar: registerJar,
    label: "ordinary user register",
    method: "POST",
  });
  assertUserTier(registerBody, "free", "ordinary user register");

  await requestJson(context, "/api/account/profile", {
    body: { displayName: "Demo Smoke Verified" },
    jar: registerJar,
    label: "ordinary user settings profile",
    method: "PATCH",
  });

  const loginBody = await requestJson(context, "/api/auth/login", {
    body: {
      email: credentials.email,
      password: credentials.password,
    },
    jar: loginJar,
    label: "ordinary user login",
    method: "POST",
  });
  assertUserTier(loginBody, "free", "ordinary user login");

  const sessionBody = await requestJson(context, "/api/auth/session", {
    jar: loginJar,
    label: "ordinary user session",
  });
  assertUserTier(sessionBody, "free", "ordinary user session");

  await requestHtml(context, "/settings", {
    jar: loginJar,
    label: "ordinary user settings page",
  });

  return loginJar;
}

async function ordinaryUserAdminRejection(context: SmokeContext, jar: CookieJar) {
  const body = await requestJson(context, "/api/admin/users", {
    expectedStatus: 403,
    jar,
    label: "ordinary user admin rejection",
  });
  assertError(body, "FORBIDDEN", "ordinary user admin rejection");
}

async function adminLoginSmoke(context: SmokeContext) {
  const credentials = await context.resetAdmin();
  const jar = new CookieJar();
  const body = await requestJson(context, "/api/auth/login", {
    body: {
      email: credentials.email,
      password: credentials.password,
    },
    jar,
    label: "admin login",
    method: "POST",
  });

  assertAdminUser(body, "admin login");

  return jar;
}

async function adminApiSmoke(context: SmokeContext, jar: CookieJar) {
  await requestJson(context, "/api/dashboard/summary", {
    jar,
    label: "admin summary",
  });
  await requestJson(context, "/api/admin/users", {
    jar,
    label: "admin users",
  });
  await requestJson(context, "/api/admin/data-sources", {
    jar,
    label: "admin data sources",
  });
  await requestJson(context, "/api/admin/risk-check", {
    jar,
    label: "admin risk check",
  });
}

async function paidGatedWorkspaceSmoke(context: SmokeContext, adminJar: CookieJar) {
  const paidEmail = generatedPaidEmail(context.randomId);
  const paidInvite = await requestJson(context, "/api/admin/users", {
    body: {
      email: paidEmail,
      displayName: "Paid Demo Smoke",
      role: "user",
      tier: "business",
    },
    expectedStatus: 201,
    jar: adminJar,
    label: "paid business fixture",
    method: "POST",
  });

  if (!isObject(paidInvite) || typeof paidInvite.temporaryPassword !== "string") {
    throw new SmokeError("paid business fixture failed: temporary password was not returned.");
  }

  const paidUser = isObject(paidInvite.user) && typeof paidInvite.user.email === "string"
    ? paidInvite.user.email
    : paidEmail;
  const paidJar = new CookieJar();
  const loginBody = await requestJson(context, "/api/auth/login", {
    body: {
      email: paidUser,
      password: paidInvite.temporaryPassword,
    },
    jar: paidJar,
    label: "paid business login",
    method: "POST",
  });
  assertUserTier(loginBody, "business", "paid business login");

  const sessionBody = await requestJson(context, "/api/auth/session", {
    jar: paidJar,
    label: "paid business session",
  });
  assertUserTier(sessionBody, "business", "paid business session");

  const intentBody = await requestJson(context, "/api/bids/1/intent", {
    expectedStatus: 200,
    jar: paidJar,
    label: "paid bid intent",
    method: "POST",
  });
  const intentId = assertIntentId(intentBody);
  const workspaceBody = await requestJson(context, `/api/intents/${encodeURIComponent(intentId)}/response-workspace`, {
    expectedStatus: 200,
    jar: paidJar,
    label: "paid response workspace",
  });
  const code = errorCode(workspaceBody);

  if (code === "AUTH_REQUIRED" || code === "FEATURE_NOT_AVAILABLE") {
    throw new SmokeError(`paid gated workspace API failed: unexpected ${code}.`);
  }
}

export function parseDemoSmokeArgs(argv: string[]): DemoSmokeCliOptions {
  const options: DemoSmokeCliOptions = {
    origin: "http://localhost:3000",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("--origin=")) {
      options.origin = arg.slice("--origin=".length);
    } else if (arg === "--origin") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new SmokeError("--origin requires a URL.");
      }
      options.origin = value;
      index += 1;
    } else {
      throw new SmokeError(`Unknown argument: ${arg}`);
    }
  }

  return {
    origin: normalizeOrigin(options.origin),
  };
}

export async function runDemoSmoke(options: DemoSmokeOptions): Promise<DemoSmokeReport> {
  const context: SmokeContext = {
    origin: normalizeOrigin(options.origin),
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date()),
    randomId: options.randomId ?? (() => randomUUID()),
    resetAdmin: options.resetAdmin ?? resetAdminForDemoSmoke,
    steps: [],
  };

  await assertReachable(context);

  const anonymousJar = new CookieJar();
  await step(context, "anonymous public pages", () => anonymousPublicPages(context, anonymousJar));
  await step(context, "anonymous workspace auth boundary", () => anonymousWorkspaceBoundary(context, anonymousJar));
  await step(context, "bid detail API and attachment download", () => bidAndAttachmentSmoke(context));
  const ordinaryJar = await step(context, "ordinary user auth/settings boundary", () => ordinaryUserSmoke(context));
  await step(context, "ordinary user admin rejection", () => ordinaryUserAdminRejection(context, ordinaryJar));
  const adminJar = await step(context, "admin reset/login boundary", () => adminLoginSmoke(context));
  await step(context, "admin APIs", () => adminApiSmoke(context, adminJar));
  await step(context, "paid gated workspace API", () => paidGatedWorkspaceSmoke(context, adminJar));

  return {
    ok: true,
    origin: context.origin,
    checkedAt: context.now().toISOString(),
    steps: context.steps,
  };
}

export function formatDemoSmokeReport(report: DemoSmokeReport) {
  return [
    `Demo smoke ${report.ok ? "PASS" : "FAIL"} at ${report.checkedAt}`,
    `origin: ${report.origin}`,
    "checks:",
    ...report.steps.map((step) => `  - ${step.status.toUpperCase()} ${step.name}`),
  ].join("\n");
}

export async function resetAdminForDemoSmoke(): Promise<DemoSmokeCredentials> {
  const [
    adminReset,
    dbClient,
    mysqlRuntime,
  ] = await Promise.all([
    import("../src/server/auth/admin-reset"),
    import("../src/server/db/client"),
    import("../src/server/db/mysql"),
  ]);
  const input = {
    email: process.env.LOCAL_ADMIN_EMAIL,
    password: process.env.LOCAL_ADMIN_PASSWORD,
  };

  if (mysqlRuntime.isMysqlDatabaseUrlConfigured()) {
    return adminReset.resetLocalAdminPasswordFromMysql(mysqlRuntime.resolveMysqlPool(), input);
  }

  const sqlite = dbClient.createDatabase();
  try {
    return await adminReset.resetLocalAdminPassword(sqlite, input);
  } finally {
    sqlite.$client.close();
  }
}

function isDirectRun() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseDemoSmokeArgs(process.argv.slice(2));
  const report = await runDemoSmoke(options);
  console.log(formatDemoSmokeReport(report));
}

if (isDirectRun()) {
  void main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      const { closeResolvedMysqlPool } = await import("../src/server/db/mysql");
      await closeResolvedMysqlPool();
    });
}
