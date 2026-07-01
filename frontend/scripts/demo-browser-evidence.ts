import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { loadEnvConfig } from "@next/env";
import {
  resetAdminForDemoSmoke,
  type DemoSmokeCredentials,
  type DemoSmokeFetch,
} from "./demo-smoke";

type EvidenceRole = "anonymous" | "free-user" | "admin" | "business-user";
type EvidenceSessionState = "anonymous" | "authenticated";
type EvidenceViewportName = "desktop" | "tablet" | "mobile";
type EvidenceFormat = "json" | "markdown";
type EvidenceBrowserMode = "auto" | "chrome" | "static";
type EvidenceCollectorName = "chrome-cdp" | "static-html" | "mock";

interface JsonObject {
  [key: string]: unknown;
}

export interface DemoBrowserEvidenceViewport {
  name: EvidenceViewportName;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface DemoBrowserEvidenceTarget {
  route: string;
  role: EvidenceRole;
  sessionState: EvidenceSessionState;
  expectedSignals: string[];
}

export interface DemoBrowserEvidenceEntry {
  route: string;
  finalUrl: string;
  viewport: DemoBrowserEvidenceViewport;
  role: EvidenceRole;
  sessionState: EvidenceSessionState;
  collector: EvidenceCollectorName;
  httpStatus: number;
  title: string;
  headings: string[];
  pageHorizontalOverflow: boolean;
  layout: {
    clientWidth: number;
    scrollWidth: number;
  };
  authSignals: {
    hasLoginEntry: boolean;
    hasRegisterEntry: boolean;
    hasAdminSignal: boolean;
    hasUpgradeSignal: boolean;
    hasLockedSignal: boolean;
  };
  expectedSignals: string[];
  signalFailures: string[];
  screenshotPath: string | null;
  status: "pass" | "fail";
  notes: string[];
}

export interface DemoBrowserEvidenceOverflowFailure {
  route: string;
  role: EvidenceRole;
  viewport: EvidenceViewportName;
  clientWidth: number;
  scrollWidth: number;
  screenshotPath: string | null;
}

export interface DemoBrowserEvidenceCtaFailure {
  label: string;
  href: string;
  httpStatus?: number;
  error?: string;
}

export interface DemoBrowserEvidenceSignalFailure {
  route: string;
  role: EvidenceRole;
  viewport: EvidenceViewportName;
  expectedSignal: string;
  finalUrl: string;
  screenshotPath: string | null;
}

export interface DemoBrowserEvidenceReport {
  ok: boolean;
  origin: string;
  checkedAt: string;
  outputPath: string;
  screenshotDir: string | null;
  browserMode: EvidenceBrowserMode;
  collector: EvidenceCollectorName;
  summary: {
    totalEntries: number;
    failedEntries: number;
    routes: number;
    viewports: number;
    roles: EvidenceRole[];
    overflowFailures: number;
    signalFailures: number;
  };
  routes: string[];
  viewports: EvidenceViewportName[];
  overflowFailures: DemoBrowserEvidenceOverflowFailure[];
  signalFailures: DemoBrowserEvidenceSignalFailure[];
  ctaFailures: DemoBrowserEvidenceCtaFailure[];
  entries: DemoBrowserEvidenceEntry[];
  setupWarnings: string[];
}

export interface DemoBrowserEvidenceCliOptions {
  browser: EvidenceBrowserMode;
  format: EvidenceFormat;
  origin: string;
  outputPath: string | null;
  screenshots: boolean;
  timeoutMs: number;
}

interface DemoBrowserEvidenceOptions extends DemoBrowserEvidenceCliOptions {
  collector?: EvidenceCollector;
  fetchImpl?: DemoSmokeFetch;
  now?: () => Date;
  randomId?: () => string;
  resetAdmin?: () => Promise<DemoSmokeCredentials>;
}

interface EvidenceContext {
  browser: EvidenceBrowserMode;
  collector: EvidenceCollector;
  cleanup?: () => Promise<void> | void;
  fetchImpl: DemoSmokeFetch;
  format: EvidenceFormat;
  now: () => Date;
  origin: string;
  outputPath: string;
  randomId: () => string;
  resetAdmin: () => Promise<DemoSmokeCredentials>;
  screenshotDir: string | null;
  screenshots: boolean;
  setupWarnings: string[];
  timeoutMs: number;
}

export interface EvidenceCollectionInput {
  context: EvidenceContext;
  jar: CookieJar;
  route: string;
  target: DemoBrowserEvidenceTarget;
  url: string;
  viewport: DemoBrowserEvidenceViewport;
}

export interface EvidenceCollectionResult {
  collector: EvidenceCollectorName;
  finalUrl: string;
  title: string;
  headings: string[];
  text?: string;
  pageHorizontalOverflow: boolean;
  layout: {
    clientWidth: number;
    scrollWidth: number;
  };
  authSignals: DemoBrowserEvidenceEntry["authSignals"];
  screenshotPath: string | null;
  notes: string[];
}

export type DemoBrowserEvidenceCollector = (input: EvidenceCollectionInput) => Promise<EvidenceCollectionResult>;
type EvidenceCollector = DemoBrowserEvidenceCollector;
type ChromeProcess = ChildProcessByStdio<null, null, Readable>;

interface EvidenceCollectorRuntime {
  cleanup?: () => Promise<void> | void;
  collector: EvidenceCollector;
}

interface RoleSession {
  jar: CookieJar;
  role: EvidenceRole;
  sessionState: EvidenceSessionState;
  setupError?: string;
}

class DemoBrowserEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoBrowserEvidenceError";
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

export const DEMO_BROWSER_EVIDENCE_VIEWPORTS: DemoBrowserEvidenceViewport[] = [
  { name: "desktop", width: 1440, height: 1100, deviceScaleFactor: 1, isMobile: false },
  { name: "tablet", width: 834, height: 1112, deviceScaleFactor: 2, isMobile: false },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
];

const DEMO_BROWSER_EVIDENCE_CTA_TARGETS = [
  { label: "Start Free", href: "/register" },
  { label: "Sign In", href: "/login" },
  { label: "Request Demo", href: "/request-demo" },
  { label: "Public Search", href: "/search" },
] as const;

const STATIC_HTML_COLLECTOR: EvidenceCollector = async (input) => {
  const response = await fetchPath(input.context, input.route, { method: "GET" }, input.jar);
  const html = await response.text();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
  const plainText = stripTags(html);

  return {
    collector: "static-html",
    finalUrl: input.url,
    title,
    headings,
    text: plainText,
    pageHorizontalOverflow: false,
    layout: {
      clientWidth: input.viewport.width,
      scrollWidth: input.viewport.width,
    },
    authSignals: textSignals(plainText, html),
    screenshotPath: null,
    notes: ["Static HTML fallback used; page-level overflow is not browser-measured."],
  };
};

export function buildDemoBrowserEvidenceTargets(intentRoute: string | null): DemoBrowserEvidenceTarget[] {
  const targets: DemoBrowserEvidenceTarget[] = [
    { route: "/", role: "anonymous", sessionState: "anonymous", expectedSignals: ["public-home"] },
    { route: "/request-demo", role: "anonymous", sessionState: "anonymous", expectedSignals: ["request-demo", "local-demo"] },
    { route: "/search", role: "anonymous", sessionState: "anonymous", expectedSignals: ["public-search"] },
    { route: "/bids/1", role: "anonymous", sessionState: "anonymous", expectedSignals: ["public-bid-detail"] },
    { route: "/settings", role: "anonymous", sessionState: "anonymous", expectedSignals: ["auth-boundary"] },
    { route: "/", role: "free-user", sessionState: "authenticated", expectedSignals: ["free-session"] },
    { route: "/settings", role: "free-user", sessionState: "authenticated", expectedSignals: ["settings"] },
    { route: "/admin", role: "free-user", sessionState: "authenticated", expectedSignals: ["admin-denied"] },
    { route: "/admin", role: "admin", sessionState: "authenticated", expectedSignals: ["admin-console"] },
  ];

  if (intentRoute) {
    targets.push({
      route: intentRoute,
      role: "business-user",
      sessionState: "authenticated",
      expectedSignals: ["real-intent", "paid-workspace"],
    });
  }

  return targets;
}

export function parseDemoBrowserEvidenceArgs(argv: string[]): DemoBrowserEvidenceCliOptions {
  const options: DemoBrowserEvidenceCliOptions = {
    browser: "auto",
    format: "json",
    origin: "http://localhost:3000",
    outputPath: null,
    screenshots: true,
    timeoutMs: 30000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg.startsWith("--origin=")) {
      options.origin = arg.slice("--origin=".length);
    } else if (arg === "--origin") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new DemoBrowserEvidenceError("--origin requires a URL.");
      options.origin = value;
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.outputPath = arg.slice("--output=".length);
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new DemoBrowserEvidenceError("--output requires a file path.");
      options.outputPath = value;
      index += 1;
    } else if (arg.startsWith("--format=")) {
      options.format = parseFormat(arg.slice("--format=".length));
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new DemoBrowserEvidenceError("--format requires json or markdown.");
      options.format = parseFormat(value);
      index += 1;
    } else if (arg.startsWith("--browser=")) {
      options.browser = parseBrowserMode(arg.slice("--browser=".length));
    } else if (arg === "--browser") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new DemoBrowserEvidenceError("--browser requires auto, chrome, or static.");
      options.browser = parseBrowserMode(value);
      index += 1;
    } else if (arg === "--no-screenshots") {
      options.screenshots = false;
    } else if (arg === "--screenshots") {
      options.screenshots = true;
    } else if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = parseTimeoutMs(arg.slice("--timeout-ms=".length));
    } else if (arg === "--timeout-ms") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new DemoBrowserEvidenceError("--timeout-ms requires a positive number.");
      options.timeoutMs = parseTimeoutMs(value);
      index += 1;
    } else {
      throw new DemoBrowserEvidenceError(`Unknown argument: ${arg}`);
    }
  }

  return {
    ...options,
    origin: normalizeOrigin(options.origin),
    outputPath: options.outputPath ? resolve(options.outputPath) : null,
  };
}

export async function runDemoBrowserEvidence(
  options: Partial<DemoBrowserEvidenceOptions> = {},
): Promise<DemoBrowserEvidenceReport> {
  const now = options.now ?? (() => new Date());
  const origin = normalizeOrigin(options.origin ?? "http://localhost:3000");
  const format = options.format ?? "json";
  const outputPath = options.outputPath
    ? resolve(options.outputPath)
    : defaultOutputPath(format);
  const screenshotDir = options.screenshots === false ? null : join(dirname(outputPath), "screenshots");
  const setupWarnings: string[] = [];
  const runtime = options.collector
    ? { collector: options.collector }
    : await createDefaultCollector(options.browser ?? "auto", setupWarnings);
  const context: EvidenceContext = {
    browser: options.browser ?? "auto",
    collector: runtime.collector,
    cleanup: runtime.cleanup,
    fetchImpl: options.fetchImpl ?? fetch,
    format,
    now,
    origin,
    outputPath,
    randomId: options.randomId ?? (() => randomUUID()),
    resetAdmin: options.resetAdmin ?? resetAdminForDemoSmoke,
    screenshotDir,
    screenshots: options.screenshots ?? true,
    setupWarnings,
    timeoutMs: options.timeoutMs ?? 30000,
  };

  try {
    await assertReachable(context);

    const ctaFailures = await collectCtaFailures(context);
    const sessions = await createRoleSessions(context);
    const intentRoute = await createBusinessIntentRoute(context, sessions).catch((error: unknown) => {
      setupWarnings.push(`business intent route skipped: ${publicErrorMessage(error)}`);
      return null;
    });
    const targets = buildDemoBrowserEvidenceTargets(intentRoute);
    const entries: DemoBrowserEvidenceEntry[] = [];

    for (const target of targets) {
      const session = sessions[target.role];
      for (const viewport of DEMO_BROWSER_EVIDENCE_VIEWPORTS) {
        entries.push(session.setupError
          ? setupFailureEntry(context, target, session.setupError, viewport)
          : await collectEvidenceEntry(context, target, session.jar, viewport));
      }
    }

    const report = finalizeReport(context, entries, ctaFailures);
    await writeEvidenceReport(report, format);

    return report;
  } finally {
    try {
      await context.cleanup?.();
    } catch {
      // Cleanup failures should not hide the already-written evidence report.
    }
  }
}

export function formatDemoBrowserEvidenceReport(report: DemoBrowserEvidenceReport, format: EvidenceFormat) {
  if (format === "json") {
    return `${JSON.stringify(report, null, 2)}\n`;
  }

  const rows = report.entries.map((entry) => [
    entry.status.toUpperCase(),
    entry.role,
    entry.viewport.name,
    entry.route,
    String(entry.httpStatus),
    entry.pageHorizontalOverflow ? "yes" : "no",
    entry.collector,
    entry.screenshotPath ?? "",
  ]);

  return [
    `# WinBids Demo Browser Evidence`,
    "",
    `- Status: ${report.ok ? "PASS" : "FAIL"}`,
    `- Checked at: ${report.checkedAt}`,
    `- Origin: ${report.origin}`,
    `- Collector: ${report.collector}`,
    `- Entries: ${report.summary.totalEntries}`,
    `- Failed entries: ${report.summary.failedEntries}`,
    `- Overflow failures: ${report.summary.overflowFailures}`,
    `- Signal failures: ${report.summary.signalFailures}`,
    `- CTA failures: ${report.ctaFailures.length}`,
    "",
    "| Status | Role | Viewport | Route | HTTP | Overflow | Collector | Screenshot |",
    "| --- | --- | --- | --- | ---: | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    report.signalFailures.length ? "\n## Signal Failures" : "",
    ...report.signalFailures.map((failure) =>
      `- ${failure.role} ${failure.viewport} ${failure.route}: missing ${failure.expectedSignal}`
    ),
    report.ctaFailures.length ? "\n## CTA Failures" : "",
    ...report.ctaFailures.map((failure) => `- ${failure.label} (${failure.href}): ${failure.httpStatus ?? failure.error ?? "failed"}`),
    report.setupWarnings.length ? "\n## Setup Warnings" : "",
    ...report.setupWarnings.map((warning) => `- ${warning}`),
    "",
  ].filter((line) => line !== "").join("\n");
}

function finalizeReport(
  context: EvidenceContext,
  entries: DemoBrowserEvidenceEntry[],
  ctaFailures: DemoBrowserEvidenceCtaFailure[],
): DemoBrowserEvidenceReport {
  const failedEntries = entries.filter((entry) => entry.status === "fail");
  const overflowFailures = entries
    .filter((entry) => entry.pageHorizontalOverflow)
    .map((entry) => ({
      route: entry.route,
      role: entry.role,
      viewport: entry.viewport.name,
      clientWidth: entry.layout.clientWidth,
      scrollWidth: entry.layout.scrollWidth,
      screenshotPath: entry.screenshotPath,
    }));
  const signalFailures = entries.flatMap((entry) =>
    entry.signalFailures.map((expectedSignal) => ({
      route: entry.route,
      role: entry.role,
      viewport: entry.viewport.name,
      expectedSignal,
      finalUrl: entry.finalUrl,
      screenshotPath: entry.screenshotPath,
    }))
  );
  const roles = [...new Set(entries.map((entry) => entry.role))];
  const viewports = [...new Set(entries.map((entry) => entry.viewport.name))];
  const routeList = [...new Set(entries.map((entry) => entry.route))];
  const routes = new Set(entries.map((entry) => `${entry.role}:${entry.route}`));
  const collector = entries.find((entry) => entry.collector === "chrome-cdp")?.collector
    ?? entries[0]?.collector
    ?? "static-html";

  return {
    ok: failedEntries.length === 0 && ctaFailures.length === 0,
    origin: context.origin,
    checkedAt: context.now().toISOString(),
    outputPath: context.outputPath,
    screenshotDir: context.screenshotDir,
    browserMode: context.browser,
    collector,
    summary: {
      totalEntries: entries.length,
      failedEntries: failedEntries.length,
      routes: routes.size,
      viewports: viewports.length,
      roles,
      overflowFailures: overflowFailures.length,
      signalFailures: signalFailures.length,
    },
    routes: routeList,
    viewports,
    overflowFailures,
    signalFailures,
    ctaFailures,
    entries,
    setupWarnings: context.setupWarnings,
  };
}

async function collectEvidenceEntry(
  context: EvidenceContext,
  target: DemoBrowserEvidenceTarget,
  jar: CookieJar,
  viewport: DemoBrowserEvidenceViewport,
) {
  const url = endpoint(context.origin, target.route);
  const preflight = await fetchPath(context, target.route, { method: "GET" }, jar);
  await preflight.arrayBuffer().catch(() => new ArrayBuffer(0));
  const result = await context.collector({ context, jar, route: target.route, target, url, viewport });
  const notes = [...result.notes];
  const signalFailures = missingExpectedSignals(target, result);

  if (preflight.status >= 400) {
    notes.push(`HTTP status ${preflight.status} returned for page route.`);
  }

  for (const signal of signalFailures) {
    notes.push(`Expected signal missing: ${signal}.`);
  }

  const status = preflight.status >= 400 || result.pageHorizontalOverflow || signalFailures.length > 0 ? "fail" : "pass";

  return {
    route: target.route,
    finalUrl: result.finalUrl,
    viewport,
    role: target.role,
    sessionState: target.sessionState,
    collector: result.collector,
    httpStatus: preflight.status,
    title: result.title,
    headings: result.headings,
    pageHorizontalOverflow: result.pageHorizontalOverflow,
    layout: result.layout,
    authSignals: result.authSignals,
    expectedSignals: target.expectedSignals,
    signalFailures,
    screenshotPath: result.screenshotPath,
    status,
    notes,
  } satisfies DemoBrowserEvidenceEntry;
}

interface ExpectedSignalEvidence {
  authSignals: DemoBrowserEvidenceEntry["authSignals"];
  finalUrl: string;
  normalizedRoute: string;
  normalizedText: string;
  role: EvidenceRole;
  route: string;
  sessionState: EvidenceSessionState;
}

function missingExpectedSignals(
  target: DemoBrowserEvidenceTarget,
  result: EvidenceCollectionResult,
) {
  const evidence = expectedSignalEvidence(target, result);

  return target.expectedSignals.filter((signal) => !hasExpectedSignal(signal, evidence));
}

function expectedSignalEvidence(
  target: DemoBrowserEvidenceTarget,
  result: EvidenceCollectionResult,
): ExpectedSignalEvidence {
  const text = [
    result.title,
    ...result.headings,
    result.text ?? "",
  ].filter(Boolean).join("\n");
  const route = `${target.route}\n${result.finalUrl}`;

  return {
    authSignals: result.authSignals,
    finalUrl: result.finalUrl,
    normalizedRoute: normalizeSignalText(route),
    normalizedText: normalizeSignalText(text),
    role: target.role,
    route: target.route,
    sessionState: target.sessionState,
  };
}

function hasExpectedSignal(signal: string, evidence: ExpectedSignalEvidence) {
  switch (signal) {
    case "admin-console":
      return evidence.authSignals.hasAdminSignal || hasSignalText(evidence, [/admin/, /administrator/, /管理员/, /运营控制台/]);
    case "admin-denied":
      return hasSignalText(evidence, [
        /access denied/,
        /admin access denied/,
        /denied/,
        /forbidden/,
        /not authorized/,
        /unauthorized/,
        /permission/,
        /无权/,
        /拒绝/,
        /权限/,
      ]);
    case "auth-boundary":
      return evidence.authSignals.hasLoginEntry
        || evidence.authSignals.hasRegisterEntry
        || hasSignalText(evidence, [
          /login/,
          /sign in/,
          /register/,
          /sign up/,
          /authentication required/,
          /please sign/,
          /登录/,
          /注册/,
        ]);
    case "free-session":
      return (evidence.role === "free-user" && evidence.sessionState === "authenticated")
        || hasSignalText(evidence, [/free/, /starter/, /免费/]);
    case "local-demo":
      return hasSignalText(evidence, [/local demo/, /demo request/, /request demo/, /演示/])
        || evidence.normalizedRoute.includes("/request-demo");
    case "locked":
      return evidence.authSignals.hasLockedSignal
        || hasSignalText(evidence, [/locked/, /lock/, /unlock/, /restricted/, /解锁/, /受限/]);
    case "paid-workspace":
      return hasSignalText(evidence, [
        /paid workspace/,
        /workspace/,
        /business/,
        /response workspace/,
        /intent paid/,
        /paid/,
        /付费/,
        /工作台/,
      ]) || evidence.normalizedRoute.includes("intent_paid");
    case "public-bid-detail":
      return /^\/bids\/[^/]+/.test(evidence.route)
        || hasSignalText(evidence, [/bid detail/, /bid/, /招标/, /采购/]);
    case "public-home":
      return evidence.role === "anonymous" && evidence.route === "/"
        || hasSignalText(evidence, [/home/, /winbids/, /public/]);
    case "public-search":
      return evidence.normalizedRoute.includes("/search")
        || hasSignalText(evidence, [/public search/, /search/, /搜索/]);
    case "real-intent":
      return evidence.normalizedRoute.includes("/intents/")
        || hasSignalText(evidence, [/intent/, /意向/]);
    case "request-demo":
      return evidence.normalizedRoute.includes("/request-demo")
        || hasSignalText(evidence, [/request demo/, /demo/, /预约/]);
    case "settings":
      return evidence.normalizedRoute.includes("/settings")
        || hasSignalText(evidence, [/settings/, /profile/, /account/, /设置/, /账户/]);
    case "upgrade":
      return evidence.authSignals.hasUpgradeSignal
        || hasSignalText(evidence, [/upgrade/, /billing/, /pricing/, /subscribe/, /升级/, /套餐/, /订阅/]);
    default:
      return hasSignalText(evidence, signalTextPatterns(signal))
        || signalTextPatterns(signal).some((pattern) => pattern.test(evidence.normalizedRoute));
  }
}

function hasSignalText(evidence: ExpectedSignalEvidence, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(evidence.normalizedText));
}

function signalTextPatterns(signal: string) {
  const normalizedSignal = normalizeSignalText(signal);
  const phrase = normalizedSignal.replace(/[-_]+/g, " ");

  return [
    new RegExp(escapeRegExp(normalizedSignal)),
    new RegExp(escapeRegExp(phrase)),
  ];
}

function normalizeSignalText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function createRoleSessions(context: EvidenceContext): Promise<Record<EvidenceRole, RoleSession>> {
  const anonymous: RoleSession = { jar: new CookieJar(), role: "anonymous", sessionState: "anonymous" };
  const free = await createSessionOrWarning(context, "free-user", () => createFreeUserSession(context));
  const admin = await createSessionOrWarning(context, "admin", () => createAdminSession(context));
  const business = admin.setupError
    ? failedRoleSession(context, "business-user", "business-user session setup skipped: admin session unavailable.")
    : await createSessionOrWarning(context, "business-user", () => createBusinessUserSession(context, admin.jar));

  return {
    anonymous,
    "free-user": free,
    admin,
    "business-user": business,
  };
}

async function createSessionOrWarning(
  context: EvidenceContext,
  role: Exclude<EvidenceRole, "anonymous">,
  createSession: () => Promise<CookieJar>,
): Promise<RoleSession> {
  try {
    return { jar: await createSession(), role, sessionState: "authenticated" };
  } catch (error) {
    return failedRoleSession(context, role, `${role} session setup failed: ${publicErrorMessage(error)}`);
  }
}

function failedRoleSession(
  context: EvidenceContext,
  role: Exclude<EvidenceRole, "anonymous">,
  message: string,
): RoleSession {
  context.setupWarnings.push(message);

  return {
    jar: new CookieJar(),
    role,
    sessionState: "authenticated",
    setupError: message,
  };
}

async function createFreeUserSession(context: EvidenceContext) {
  const credentials = generatedCredentials("demo-browser", context.randomId);
  const jar = new CookieJar();
  await requestJson(context, "/api/auth/register", {
    body: {
      email: credentials.email,
      password: credentials.password,
      displayName: "Demo Browser Evidence",
    },
    expectedStatus: 201,
    jar,
    label: "free user register",
    method: "POST",
  });

  return jar;
}

async function createAdminSession(context: EvidenceContext) {
  const credentials = await context.resetAdmin();
  const jar = new CookieJar();
  await requestJson(context, "/api/auth/login", {
    body: {
      email: credentials.email,
      password: credentials.password,
    },
    expectedStatus: 200,
    jar,
    label: "admin login",
    method: "POST",
  });

  return jar;
}

async function createBusinessUserSession(context: EvidenceContext, adminJar: CookieJar) {
  const email = generatedCredentials("demo-browser-business", context.randomId).email;
  const invite = await requestJson(context, "/api/admin/users", {
    body: {
      email,
      displayName: "Demo Browser Business",
      role: "user",
      tier: "business",
    },
    expectedStatus: 201,
    jar: adminJar,
    label: "business user fixture",
    method: "POST",
  });

  if (!isObject(invite) || typeof invite.temporaryPassword !== "string") {
    throw new DemoBrowserEvidenceError("business user fixture failed: temporary password was not returned.");
  }

  const user = isObject(invite.user) && typeof invite.user.email === "string" ? invite.user.email : email;
  const jar = new CookieJar();
  await requestJson(context, "/api/auth/login", {
    body: {
      email: user,
      password: invite.temporaryPassword,
    },
    expectedStatus: 200,
    jar,
    label: "business user login",
    method: "POST",
  });

  return jar;
}

async function createBusinessIntentRoute(context: EvidenceContext, sessions: Record<EvidenceRole, RoleSession>) {
  if (sessions["business-user"].setupError) return null;

  const body = await requestJson(context, "/api/bids/1/intent", {
    expectedStatus: 200,
    jar: sessions["business-user"].jar,
    label: "business intent fixture",
    method: "POST",
  });

  if (!isObject(body) || !isObject(body.intent) || typeof body.intent.id !== "string") {
    throw new DemoBrowserEvidenceError("business intent fixture failed: intent id was not returned.");
  }

  return `/intents/${encodeURIComponent(body.intent.id)}`;
}

function setupFailureEntry(
  context: EvidenceContext,
  target: DemoBrowserEvidenceTarget,
  setupError: string,
  viewport: DemoBrowserEvidenceViewport,
): DemoBrowserEvidenceEntry {
  return {
    route: target.route,
    finalUrl: endpoint(context.origin, target.route),
    viewport,
    role: target.role,
    sessionState: target.sessionState,
    collector: "static-html",
    httpStatus: 0,
    title: "",
    headings: [],
    pageHorizontalOverflow: false,
    layout: {
      clientWidth: viewport.width,
      scrollWidth: viewport.width,
    },
    authSignals: {
      hasLoginEntry: false,
      hasRegisterEntry: false,
      hasAdminSignal: false,
      hasUpgradeSignal: false,
      hasLockedSignal: false,
    },
    expectedSignals: target.expectedSignals,
    signalFailures: [],
    screenshotPath: null,
    status: "fail",
    notes: [setupError],
  };
}

async function assertReachable(context: EvidenceContext) {
  try {
    const response = await context.fetchImpl(context.origin, { method: "GET" });
    if (response.status >= 500) {
      throw new DemoBrowserEvidenceError(`Local demo app at ${context.origin} returned HTTP ${response.status}.`);
    }
  } catch (error) {
    if (error instanceof DemoBrowserEvidenceError) throw error;

    throw new DemoBrowserEvidenceError(
      `Local demo app is not reachable at ${context.origin}. Start it with npm run dev -- --port 3000 before running npm run demo:browser-evidence.`,
    );
  }
}

async function collectCtaFailures(context: EvidenceContext) {
  const failures: DemoBrowserEvidenceCtaFailure[] = [];

  for (const target of DEMO_BROWSER_EVIDENCE_CTA_TARGETS) {
    try {
      const response = await fetchPath(context, target.href, { method: "GET" });
      await response.arrayBuffer().catch(() => new ArrayBuffer(0));

      if (response.status >= 400) {
        failures.push({
          label: target.label,
          href: target.href,
          httpStatus: response.status,
        });
      }
    } catch (error) {
      failures.push({
        label: target.label,
        href: target.href,
        error: publicErrorMessage(error),
      });
    }
  }

  return failures;
}

interface JsonRequestOptions {
  body?: unknown;
  expectedStatus?: number | number[];
  jar?: CookieJar;
  label: string;
  method?: string;
}

async function requestJson<T = unknown>(
  context: EvidenceContext,
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
  const expected = new Set(Array.isArray(options.expectedStatus) ? options.expectedStatus : [options.expectedStatus ?? 200]);

  if (!expected.has(response.status)) {
    throw httpError(options.label, method, pathname, response, parsed);
  }

  return parsed as T;
}

async function fetchPath(
  context: EvidenceContext,
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

async function parseJson(response: Response) {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) as unknown : {};
  } catch {
    return {};
  }
}

function httpError(label: string, method: string, pathname: string, response: Response, body?: unknown) {
  const code = body === undefined ? null : errorCode(body);
  const suffix = code ? ` (${code})` : "";

  return new DemoBrowserEvidenceError(`${label} failed: ${method} ${pathname} returned HTTP ${response.status}${suffix}.`);
}

function errorCode(body: unknown) {
  if (!isObject(body) || !isObject(body.error) || typeof body.error.code !== "string") return null;
  return body.error.code;
}

async function createDefaultCollector(
  browser: EvidenceBrowserMode,
  setupWarnings: string[],
): Promise<EvidenceCollectorRuntime> {
  if (browser === "static") return { collector: STATIC_HTML_COLLECTOR };

  const chromePath = discoverChromeExecutable();
  if (!chromePath) {
    if (browser === "chrome") {
      throw new DemoBrowserEvidenceError("Chrome executable was not found. Set CHROME_PATH or run with --browser=static.");
    }

    setupWarnings.push("Chrome executable was not found; static HTML evidence fallback is being used.");
    return { collector: STATIC_HTML_COLLECTOR };
  }

  const browserSession = await ChromeEvidenceSession.launch(chromePath);
  process.once("exit", () => {
    browserSession.closeSync();
  });

  return {
    collector: async (input) => browserSession.collect(input),
    cleanup: () => browserSession.close(),
  };
}

class ChromeEvidenceSession {
  private closed = false;

  private constructor(
    private readonly process: ChromeProcess,
    private readonly userDataDir: string,
    private readonly connection: CdpConnection,
  ) {}

  static async launch(executablePath: string) {
    const userDataDir = await mkdtemp(join(tmpdir(), "winbids-demo-browser-"));
    const child = spawn(executablePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    const wsUrl = await waitForDevtoolsUrl(child);
    const connection = await CdpConnection.connect(wsUrl);

    return new ChromeEvidenceSession(child, userDataDir, connection);
  }

  async collect(input: EvidenceCollectionInput): Promise<EvidenceCollectionResult> {
    const targetId = await this.connection.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    }).then((value) => value.targetId);
    const attach = await this.connection.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const sessionId = attach.sessionId;

    try {
      await this.connection.send("Page.enable", undefined, sessionId);
      await this.connection.send("Runtime.enable", undefined, sessionId);
      await this.connection.send("Network.enable", undefined, sessionId);
      await this.connection.send("Emulation.setDeviceMetricsOverride", {
        width: input.viewport.width,
        height: input.viewport.height,
        deviceScaleFactor: input.viewport.deviceScaleFactor,
        mobile: input.viewport.isMobile,
      }, sessionId);

      const cookie = input.jar.header();
      if (cookie) {
        await this.connection.send("Network.setExtraHTTPHeaders", { headers: { Cookie: cookie } }, sessionId);
      }

      const loadEvent = this.connection.waitForEvent("Page.loadEventFired", sessionId, input.context.timeoutMs);
      await this.connection.send("Page.navigate", { url: input.url }, sessionId);
      await loadEvent;

      const evaluated = await this.connection.send<{
        result?: { value?: EvidenceDomSnapshot };
      }>("Runtime.evaluate", {
        expression: domSnapshotExpression(),
        returnByValue: true,
        awaitPromise: true,
      }, sessionId);
      const snapshot = evaluated.result?.value ?? fallbackSnapshot(input.viewport.width);
      const screenshotPath = input.context.screenshots && input.context.screenshotDir
        ? await this.captureScreenshot(input, sessionId)
        : null;

      return {
        collector: "chrome-cdp",
        finalUrl: snapshot.finalUrl,
        title: snapshot.title,
        headings: snapshot.headings,
        text: snapshot.text,
        pageHorizontalOverflow: snapshot.pageHorizontalOverflow,
        layout: {
          clientWidth: snapshot.clientWidth,
          scrollWidth: snapshot.scrollWidth,
        },
        authSignals: snapshot.authSignals,
        screenshotPath,
        notes: [],
      };
    } finally {
      await this.connection.send("Target.closeTarget", { targetId }).catch(() => null);
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
    const exitPromise = waitForProcessExit(this.process, 3000);
    this.process.kill("SIGTERM");
    await exitPromise;
    await rm(this.userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
  }

  closeSync() {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
    this.process.kill("SIGTERM");
    void rm(this.userDataDir, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
  }

  private async captureScreenshot(input: EvidenceCollectionInput, sessionId: string) {
    await mkdir(input.context.screenshotDir ?? "", { recursive: true });
    const name = [
      input.target.role,
      input.viewport.name,
      input.route === "/" ? "home" : input.route.replace(/^\//, "").replace(/[^a-z0-9-]+/gi, "-"),
    ].join("-");
    const screenshotPath = join(input.context.screenshotDir ?? "", `${name}.png`);
    const screenshot = await this.connection.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false,
    }, sessionId);
    await writeFile(screenshotPath, screenshot.data, "base64");

    return screenshotPath;
  }
}

interface EvidenceDomSnapshot {
  finalUrl: string;
  title: string;
  headings: string[];
  text: string;
  pageHorizontalOverflow: boolean;
  clientWidth: number;
  scrollWidth: number;
  authSignals: DemoBrowserEvidenceEntry["authSignals"];
}

function fallbackSnapshot(width: number): EvidenceDomSnapshot {
  return {
    finalUrl: "",
    title: "",
    headings: [],
    text: "",
    pageHorizontalOverflow: false,
    clientWidth: width,
    scrollWidth: width,
    authSignals: {
      hasLoginEntry: false,
      hasRegisterEntry: false,
      hasAdminSignal: false,
      hasUpgradeSignal: false,
      hasLockedSignal: false,
    },
  };
}

function domSnapshotExpression() {
  return `(() => {
    const text = document.body ? document.body.innerText || "" : "";
    const html = document.documentElement ? document.documentElement.outerHTML || "" : "";
    const headings = Array.from(document.querySelectorAll("h1,h2,h3"))
      .map((node) => (node.textContent || "").replace(/\\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8);
    const root = document.documentElement;
    const body = document.body;
    const clientWidth = root ? root.clientWidth : window.innerWidth;
    const scrollWidth = Math.max(root ? root.scrollWidth : 0, body ? body.scrollWidth : 0, clientWidth);
    const normalized = (text + "\\n" + html).toLowerCase();
    return {
      finalUrl: window.location.href,
      title: document.title || "",
      headings,
      text,
      pageHorizontalOverflow: scrollWidth > clientWidth + 2,
      clientWidth,
      scrollWidth,
      authSignals: {
        hasLoginEntry: /login|sign in|登录/.test(normalized),
        hasRegisterEntry: /register|sign up|注册/.test(normalized),
        hasAdminSignal: /admin|administrator|管理员|运营控制台/.test(normalized),
        hasUpgradeSignal: /upgrade|billing|pricing|升级|套餐|订阅/.test(normalized),
        hasLockedSignal: /locked|lock|unlock|解锁|受限/.test(normalized)
      }
    };
  })()`;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
  sessionId?: string;
}

class CdpConnection {
  private nextId = 1;
  private readonly pending = new Map<number, {
    reject: (error: Error) => void;
    resolve: (value: unknown) => void;
    timeout: NodeJS.Timeout;
  }>();
  private readonly eventWaiters = new Set<{
    method: string;
    reject: (error: Error) => void;
    resolve: (value: CdpMessage) => void;
    sessionId?: string;
    timeout: NodeJS.Timeout;
  }>();

  private constructor(private readonly ws: WebSocket) {
    this.ws.onmessage = (event) => this.handleMessage(String(event.data));
    this.ws.onerror = () => this.rejectAll(new DemoBrowserEvidenceError("Chrome DevTools connection failed."));
    this.ws.onclose = () => this.rejectAll(new DemoBrowserEvidenceError("Chrome DevTools connection closed."));
  }

  static async connect(wsUrl: string) {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new DemoBrowserEvidenceError("Timed out connecting to Chrome DevTools.")), 15000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolveOpen();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        rejectOpen(new DemoBrowserEvidenceError("Failed to connect to Chrome DevTools."));
      };
    });

    return new CdpConnection(ws);
  }

  send<T = unknown>(method: string, params?: JsonObject, sessionId?: string): Promise<T> {
    const id = this.nextId++;
    const message = params === undefined ? { id, method, sessionId } : { id, method, params, sessionId };

    return new Promise<T>((resolveSend, rejectSend) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        rejectSend(new DemoBrowserEvidenceError(`Chrome DevTools command timed out: ${method}`));
      }, 30000);

      this.pending.set(id, {
        reject: rejectSend,
        resolve: (value) => resolveSend(value as T),
        timeout,
      });
      this.ws.send(JSON.stringify(message));
    });
  }

  waitForEvent(method: string, sessionId: string | undefined, timeoutMs: number) {
    return new Promise<CdpMessage>((resolveEvent, rejectEvent) => {
      const waiter = {
        method,
        sessionId,
        resolve: resolveEvent,
        reject: rejectEvent,
        timeout: setTimeout(() => {
          this.eventWaiters.delete(waiter);
          rejectEvent(new DemoBrowserEvidenceError(`Timed out waiting for Chrome event: ${method}`));
        }, timeoutMs),
      };
      this.eventWaiters.add(waiter);
    });
  }

  close() {
    this.ws.close();
    this.rejectAll(new DemoBrowserEvidenceError("Chrome DevTools connection closed."));
  }

  private handleMessage(raw: string) {
    let message: CdpMessage;

    try {
      message = JSON.parse(raw) as CdpMessage;
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);

      if (message.error) {
        pending.reject(new DemoBrowserEvidenceError(message.error.message ?? "Chrome DevTools command failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;

    for (const waiter of [...this.eventWaiters]) {
      if (waiter.method !== message.method) continue;
      if (waiter.sessionId && waiter.sessionId !== message.sessionId) continue;

      clearTimeout(waiter.timeout);
      this.eventWaiters.delete(waiter);
      waiter.resolve(message);
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();

    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.eventWaiters.clear();
  }
}

function waitForDevtoolsUrl(child: ChromeProcess) {
  return new Promise<string>((resolveUrl, rejectUrl) => {
    let buffer = "";
    const timeout = setTimeout(() => {
      rejectUrl(new DemoBrowserEvidenceError("Timed out waiting for Chrome DevTools endpoint."));
    }, 15000);

    child.stderr.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;

      clearTimeout(timeout);
      resolveUrl(match[1]);
    });

    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectUrl(error);
    });

    child.once("exit", (code) => {
      if (!buffer.includes("DevTools listening on")) {
        clearTimeout(timeout);
        rejectUrl(new DemoBrowserEvidenceError(`Chrome exited before DevTools was ready (code ${code ?? "unknown"}).`));
      }
    });
  });
}

function waitForProcessExit(child: ChromeProcess, timeoutMs: number) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise<void>((resolveExit) => {
    const timeout = setTimeout(resolveExit, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
}

function discoverChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function writeEvidenceReport(report: DemoBrowserEvidenceReport, format: EvidenceFormat) {
  await mkdir(dirname(report.outputPath), { recursive: true });
  await writeFile(report.outputPath, sanitizeText(formatDemoBrowserEvidenceReport(report, format)), "utf8");
}

function textSignals(text: string, html = ""): DemoBrowserEvidenceEntry["authSignals"] {
  const normalized = `${text}\n${html}`.toLowerCase();

  return {
    hasLoginEntry: /login|sign in|登录/.test(normalized),
    hasRegisterEntry: /register|sign up|注册/.test(normalized),
    hasAdminSignal: /admin|administrator|管理员|运营控制台/.test(normalized),
    hasUpgradeSignal: /upgrade|billing|pricing|升级|套餐|订阅/.test(normalized),
    hasLockedSignal: /locked|lock|unlock|解锁|受限/.test(normalized),
  };
}

function stripTags(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
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
    throw new DemoBrowserEvidenceError(`Invalid --origin URL: ${value}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DemoBrowserEvidenceError(`Invalid --origin URL: ${value}`);
  }

  return parsed.origin;
}

function parseFormat(value: string): EvidenceFormat {
  if (value === "json" || value === "markdown") return value;
  throw new DemoBrowserEvidenceError("--format must be json or markdown.");
}

function parseBrowserMode(value: string): EvidenceBrowserMode {
  if (value === "auto" || value === "chrome" || value === "static") return value;
  throw new DemoBrowserEvidenceError("--browser must be auto, chrome, or static.");
}

function parseTimeoutMs(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DemoBrowserEvidenceError("--timeout-ms requires a positive number.");
  }

  return parsed;
}

function generatedCredentials(prefix: string, randomId: () => string) {
  const suffix = randomId().replace(/[^a-z0-9]/gi, "").slice(0, 8).padEnd(8, "0");

  return {
    email: `${prefix}-${Date.now()}-${suffix}@example.test`,
    password: `DemoBrowser-${suffix}-Pass!`,
  };
}

function defaultOutputPath(format: EvidenceFormat) {
  const extension = format === "json" ? "json" : "md";

  return join(tmpdir(), "winbids-demo-browser-evidence", `demo-browser-evidence-latest.${extension}`);
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) return sanitizeText(error.message);
  return sanitizeText(String(error));
}

function sanitizeText(value: string) {
  return value
    .replace(/session=[^;"\s]+/gi, "session=[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/g, "Bearer [REDACTED]")
    .replace(/("password"\s*:\s*")[^"]+"/gi, "$1[REDACTED]\"")
    .replace(/(password=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(token=)[^&\s]+/gi, "$1[REDACTED]");
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectRun() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseDemoBrowserEvidenceArgs(process.argv.slice(2));
  const report = await runDemoBrowserEvidence(options);
  console.log(`Demo browser evidence ${report.ok ? "PASS" : "FAIL"}: ${report.outputPath}`);
  if (report.screenshotDir) console.log(`Screenshots: ${report.screenshotDir}`);
  if (!report.ok) process.exitCode = 1;
  setImmediate(() => process.exit(process.exitCode ?? 0));
}

if (isDirectRun()) {
  void main().catch((error: unknown) => {
    console.error(publicErrorMessage(error));
    process.exitCode = 1;
  });
}
