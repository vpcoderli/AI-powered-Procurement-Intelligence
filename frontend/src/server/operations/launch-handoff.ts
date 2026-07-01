import { readFileSync } from "node:fs";
import {
  validateStripeSandboxConfig,
  type StripeSandboxArgs,
} from "@/server/billing/stripe-sandbox-verifier";
import { validateProductionReadiness } from "./production-readiness";

export type LaunchHandoffTrackId =
  | "stripe_sandbox"
  | "production_preflight"
  | "aws_staging_dry_run"
  | "live_source_health_ops"
  | "browser_demo_evidence"
  | "risk_gate";

export type LaunchHandoffTrackStatus = "ready" | "blocked";

export interface LaunchHandoffTrack {
  id: LaunchHandoffTrackId;
  title: string;
  status: LaunchHandoffTrackStatus;
  blockers: string[];
  commands: string[];
  evidence: string[];
  docs: string[];
}

export interface LaunchHandoffReport {
  ok: boolean;
  generatedAt: string;
  summary: {
    total: number;
    ready: number;
    blocked: number;
  };
  tracks: LaunchHandoffTrack[];
}

type LaunchHandoffEnv = Record<string, string | undefined>;

export interface BuildLaunchHandoffOptions {
  now?: () => string;
  origin?: string;
  readFile?: (filePath: string) => string;
}

const defaultOrigin = "http://localhost:3000";

function value(env: LaunchHandoffEnv, key: string) {
  return env[key]?.trim() ?? "";
}

function stripSensitiveValues(raw: string) {
  return raw
    .replace(/sk_(test|live)_[A-Za-z0-9_:-]+/g, "STRIPE_SECRET_KEY[redacted]")
    .replace(/whsec_[A-Za-z0-9_:-]+/g, "STRIPE_WEBHOOK_SECRET[redacted]")
    .replace(/(mysql2?:\/\/)([^:@/\s]+):([^@/\s]+)@/g, "$1[redacted]@")
    .replace(/(postgres(?:ql)?:\/\/)([^:@/\s]+):([^@/\s]+)@/g, "$1[redacted]@")
    .replace(/(AWS_SECRET_ACCESS_KEY=)[^\s]+/g, "$1[redacted]")
    .replace(/(OBJECT_STORAGE_SECRET_ACCESS_KEY=)[^\s]+/g, "$1[redacted]");
}

function blockerFromError(error: unknown) {
  return stripSensitiveValues(error instanceof Error ? error.message : String(error));
}

function configuredMarkers(keys: string[]) {
  return keys.map((key) => `${key}=configured`);
}

function requiredKeysBlockers(env: LaunchHandoffEnv, keys: string[]) {
  return keys.filter((key) => !value(env, key)).map((key) => `${key} is required`);
}

function requireEitherKeyBlocker(env: LaunchHandoffEnv, keys: string[], label: string) {
  return keys.some((key) => value(env, key)) ? [] : [`${label} requires one of: ${keys.join(", ")}`];
}

function validateHttpUrlMarker(env: LaunchHandoffEnv, key: string) {
  const raw = value(env, key);
  if (!raw) return [];

  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") return [];
    return [`${key} must be an http or https URL`];
  } catch {
    return [`${key} must be a valid URL`];
  }
}

function numberField(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface SourceHealthEvidenceValidation {
  blockers: string[];
  unhealthySources: number | null;
}

function validateSourceHealthEvidencePayload(payload: unknown): SourceHealthEvidenceValidation {
  const blockers: string[] = [];
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;

  if (!record) {
    return {
      blockers: ["SOURCE_HEALTH_OPS_EVIDENCE_FILE must contain a JSON object"],
      unhealthySources: null,
    };
  }

  const payloadBlockers = Array.isArray(record.blockers)
    ? record.blockers.map((blocker) => String(blocker)).filter(Boolean)
    : [];

  if (record.ok !== true) {
    blockers.push(
      payloadBlockers.length > 0
        ? `SOURCE_HEALTH_OPS_EVIDENCE_FILE is not ready: ${payloadBlockers.join("; ")}`
        : "SOURCE_HEALTH_OPS_EVIDENCE_FILE is not ready",
    );
  }

  const readiness = record.readiness && typeof record.readiness === "object"
    ? record.readiness as Record<string, unknown>
    : null;

  if (!readiness) {
    blockers.push("SOURCE_HEALTH_OPS_EVIDENCE_FILE is missing readiness summary");
    return { blockers, unhealthySources: null };
  }

  const observed = numberField(readiness.observedStateCount);
  const expected = numberField(readiness.expectedStateCount);
  if (expected > 0 && observed < expected) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE covers ${observed}/${expected} expected state sources.`);
  }
  if (readiness.staleSnapshot === true) {
    blockers.push("SOURCE_HEALTH_OPS_EVIDENCE_FILE snapshot is stale.");
  }

  const criticalUnhealthy = numberField(readiness.criticalUnhealthy);
  if (criticalUnhealthy > 0) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE has ${criticalUnhealthy} critical unhealthy source(s).`);
  }

  const unassigned = numberField(readiness.unassignedUnhealthy);
  if (unassigned > 0) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has ${unassigned} unassigned unhealthy source(s).`);
  }

  const missingDisposition = numberField(readiness.missingDisposition);
  if (missingDisposition > 0) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has ${missingDisposition} source(s) missing disposition.`);
  }

  const missingNextReview = numberField(readiness.missingNextReview);
  if (missingNextReview > 0) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has ${missingNextReview} source(s) missing next-review.`);
  }

  const overdueNextReview = numberField(readiness.overdueNextReview);
  if (overdueNextReview > 0) {
    blockers.push(`SOURCE_HEALTH_OPS_EVIDENCE_FILE readiness has ${overdueNextReview} overdue next-review source(s).`);
  }

  return {
    blockers,
    unhealthySources: numberField(readiness.unhealthySources),
  };
}

function validateSourceHealthEvidenceFile(
  env: LaunchHandoffEnv,
  readFile: (filePath: string) => string,
): SourceHealthEvidenceValidation {
  const filePath = value(env, "SOURCE_HEALTH_OPS_EVIDENCE_FILE");
  if (!filePath) return { blockers: [], unhealthySources: null };

  let raw: string;
  try {
    raw = readFile(filePath);
  } catch {
    return {
      blockers: ["SOURCE_HEALTH_OPS_EVIDENCE_FILE could not be read"],
      unhealthySources: null,
    };
  }

  try {
    return validateSourceHealthEvidencePayload(JSON.parse(raw));
  } catch {
    return {
      blockers: ["SOURCE_HEALTH_OPS_EVIDENCE_FILE must contain valid JSON"],
      unhealthySources: null,
    };
  }
}

function validateSourceHealthAccessReviewPayload(payload: unknown, expectedReviewSources: number | null) {
  const blockers: string[] = [];
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;

  if (!record) {
    return ["SOURCE_HEALTH_ACCESS_REVIEW_FILE must contain a JSON object"];
  }

  const summary = record.summary && typeof record.summary === "object"
    ? record.summary as Record<string, unknown>
    : null;
  if (!summary) {
    blockers.push("SOURCE_HEALTH_ACCESS_REVIEW_FILE is missing summary.");
  }

  const reviewSources = summary ? numberField(summary.reviewSources) : 0;
  if (expectedReviewSources !== null && expectedReviewSources > 0 && reviewSources < expectedReviewSources) {
    blockers.push(`SOURCE_HEALTH_ACCESS_REVIEW_FILE covers ${reviewSources}/${expectedReviewSources} unhealthy source review(s).`);
  }

  const entries = Array.isArray(record.entries) ? record.entries : null;
  if (!entries) {
    blockers.push("SOURCE_HEALTH_ACCESS_REVIEW_FILE is missing entries.");
    return blockers;
  }

  if (reviewSources > 0 && entries.length < reviewSources) {
    blockers.push(`SOURCE_HEALTH_ACCESS_REVIEW_FILE has ${entries.length}/${reviewSources} review entries.`);
  }

  for (const [index, entry] of entries.entries()) {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    const label = item?.sourceId ? String(item.sourceId) : `#${index + 1}`;

    if (!item) {
      blockers.push(`SOURCE_HEALTH_ACCESS_REVIEW_FILE entry ${label} must be an object.`);
      continue;
    }
    if (!item.reviewMode) {
      blockers.push(`SOURCE_HEALTH_ACCESS_REVIEW_FILE entry ${label} is missing reviewMode.`);
    }
    if (!Array.isArray(item.requiredEvidence) || item.requiredEvidence.length === 0) {
      blockers.push(`SOURCE_HEALTH_ACCESS_REVIEW_FILE entry ${label} is missing requiredEvidence.`);
    }
  }

  return blockers;
}

function validateSourceHealthAccessReviewFile(
  env: LaunchHandoffEnv,
  readFile: (filePath: string) => string,
  expectedReviewSources: number | null,
) {
  const filePath = value(env, "SOURCE_HEALTH_ACCESS_REVIEW_FILE");
  if (!filePath) return [];

  let raw: string;
  try {
    raw = readFile(filePath);
  } catch {
    return ["SOURCE_HEALTH_ACCESS_REVIEW_FILE could not be read"];
  }

  try {
    return validateSourceHealthAccessReviewPayload(JSON.parse(raw), expectedReviewSources);
  } catch {
    return ["SOURCE_HEALTH_ACCESS_REVIEW_FILE must contain valid JSON"];
  }
}

function buildTrack(
  input: Omit<LaunchHandoffTrack, "status"> & { blockers: string[] },
): LaunchHandoffTrack {
  const blockers = input.blockers.map(stripSensitiveValues);

  return {
    ...input,
    blockers,
    status: blockers.length > 0 ? "blocked" : "ready",
  };
}

function stripeSandboxEnv(env: LaunchHandoffEnv): LaunchHandoffEnv {
  return {
    BILLING_PROVIDER: value(env, "BILLING_PROVIDER") || "stripe",
    STRIPE_SECRET_KEY: value(env, "STRIPE_SANDBOX_SECRET_KEY") || value(env, "STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: value(env, "STRIPE_SANDBOX_WEBHOOK_SECRET") || value(env, "STRIPE_WEBHOOK_SECRET"),
    STRIPE_PRICE_PRO_MONTHLY: value(env, "STRIPE_SANDBOX_PRICE_PRO_MONTHLY") ||
      value(env, "STRIPE_PRICE_PRO_MONTHLY"),
    STRIPE_PRICE_BUSINESS_MONTHLY: value(env, "STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY") ||
      value(env, "STRIPE_PRICE_BUSINESS_MONTHLY"),
  };
}

function stripeSandboxTrack(env: LaunchHandoffEnv, origin: string): LaunchHandoffTrack {
  const args: Partial<StripeSandboxArgs> = {
    tier: "pro",
    origin,
    skipCancel: false,
    timeoutMs: 300000,
  };
  const blockers: string[] = [];

  try {
    validateStripeSandboxConfig(stripeSandboxEnv(env), args);
  } catch (error) {
    blockers.push(
      blockerFromError(error)
        .replaceAll("STRIPE_SECRET_KEY", "STRIPE_SANDBOX_SECRET_KEY")
        .replaceAll("STRIPE_WEBHOOK_SECRET", "STRIPE_SANDBOX_WEBHOOK_SECRET")
        .replaceAll("STRIPE_PRICE_PRO_MONTHLY", "STRIPE_SANDBOX_PRICE_PRO_MONTHLY")
        .replaceAll("STRIPE_PRICE_BUSINESS_MONTHLY", "STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY"),
    );
  }

  return buildTrack({
    id: "stripe_sandbox",
    title: "Stripe Sandbox E2E",
    blockers,
    commands: [
      "stripe listen --forward-to localhost:3000/api/billing/webhook",
      `npm run billing:stripe:sandbox -- --tier=pro --origin=${origin}`,
      `npm run billing:stripe:sandbox -- --tier=business --origin=${origin}`,
    ],
    evidence: configuredMarkers([
      "STRIPE_SANDBOX_SECRET_KEY",
      "STRIPE_SANDBOX_WEBHOOK_SECRET",
      "STRIPE_SANDBOX_PRICE_PRO_MONTHLY",
      "STRIPE_SANDBOX_PRICE_BUSINESS_MONTHLY",
    ]),
    docs: ["docs/operations/stripe-sandbox-e2e.md"],
  });
}

function productionPreflightTrack(env: LaunchHandoffEnv): LaunchHandoffTrack {
  const blockers: string[] = [];

  try {
    validateProductionReadiness(env);
  } catch (error) {
    blockers.push(blockerFromError(error));
  }

  return buildTrack({
    id: "production_preflight",
    title: "Production Readiness Preflight",
    blockers,
    commands: ["NODE_ENV=production npm run ops:production:check"],
    evidence: configuredMarkers([
      "PRODUCTION_OWNER_BILLING",
      "PRODUCTION_OWNER_WORKERS",
      "PRODUCTION_OWNER_BACKUPS",
      "PRODUCTION_BACKUP_RUNBOOK_URL",
      "PRODUCTION_BACKUP_EVIDENCE_URL",
      "PRODUCTION_RESTORE_EVIDENCE_URL",
      "PRODUCTION_BACKUP_EVIDENCE_TIMESTAMP",
    ]),
    docs: [
      "docs/operations/aws-deployment-runbook.md",
      "docs/operations/production-billing-worker-runbook.md",
    ],
  });
}

function awsStagingDryRunTrack(env: LaunchHandoffEnv): LaunchHandoffTrack {
  const blockers = [
    ...requiredKeysBlockers(env, [
      "AWS_STAGING_OWNER",
      "AWS_STAGING_DRY_RUN_EVIDENCE_URL",
      "AWS_STAGING_DEPLOYMENT_URL",
      "AWS_STAGING_RELEASE_SHA",
    ]),
    ...validateHttpUrlMarker(env, "AWS_STAGING_DRY_RUN_EVIDENCE_URL"),
    ...validateHttpUrlMarker(env, "AWS_STAGING_DEPLOYMENT_URL"),
  ];

  return buildTrack({
    id: "aws_staging_dry_run",
    title: "AWS Staging Dry Run",
    blockers,
    commands: [
      "npm run build",
      "NODE_ENV=production npm run ops:production:check",
      "DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids npm run db:mysql:migrate",
      "DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids npm run db:mysql:smoke",
      "NODE_ENV=production DATABASE_URL=mysql://<staging-user>:<redacted>@<staging-rds-endpoint>:3306/winbids NOTIFICATION_PROVIDER=http npm run workers:check",
    ],
    evidence: configuredMarkers([
      "AWS_STAGING_OWNER",
      "AWS_STAGING_DRY_RUN_EVIDENCE_URL",
      "AWS_STAGING_DEPLOYMENT_URL",
      "AWS_STAGING_RELEASE_SHA",
    ]),
    docs: ["docs/operations/aws-deployment-runbook.md"],
  });
}

function liveSourceHealthTrack(env: LaunchHandoffEnv, readFile: (filePath: string) => string): LaunchHandoffTrack {
  const sourceHealthEvidence = validateSourceHealthEvidenceFile(env, readFile);
  const blockers = [
    ...requiredKeysBlockers(env, ["SOURCE_HEALTH_OWNER"]),
    ...requireEitherKeyBlocker(
      env,
      ["SOURCE_HEALTH_OPS_EVIDENCE_URL", "SOURCE_HEALTH_OPS_EVIDENCE_FILE"],
      "Live source health evidence",
    ),
    ...requireEitherKeyBlocker(
      env,
      ["SOURCE_HEALTH_ACCESS_REVIEW_URL", "SOURCE_HEALTH_ACCESS_REVIEW_FILE"],
      "Live source health access review",
    ),
    ...validateHttpUrlMarker(env, "SOURCE_HEALTH_OPS_EVIDENCE_URL"),
    ...validateHttpUrlMarker(env, "SOURCE_HEALTH_ACCESS_REVIEW_URL"),
    ...sourceHealthEvidence.blockers,
    ...validateSourceHealthAccessReviewFile(env, readFile, sourceHealthEvidence.unhealthySources),
  ];

  return buildTrack({
    id: "live_source_health_ops",
    title: "Live Source Health Operations",
    blockers,
    commands: [
      "npm run source:health:ops",
      "npm run source:health:report -- --format=markdown",
      "npm run source:health:evidence -- --format=json --output=../ops-evidence/source-health/source-health-evidence.json",
      "npm run source:health:access-review -- --format=json --output=../ops-evidence/source-health/source-health-access-review.json",
    ],
    evidence: configuredMarkers([
      "SOURCE_HEALTH_OWNER",
      "SOURCE_HEALTH_OPS_EVIDENCE_URL or SOURCE_HEALTH_OPS_EVIDENCE_FILE",
      "SOURCE_HEALTH_ACCESS_REVIEW_URL or SOURCE_HEALTH_ACCESS_REVIEW_FILE",
    ]),
    docs: ["docs/operations/source-health-check.md"],
  });
}

function browserEvidenceTrack(env: LaunchHandoffEnv, origin: string): LaunchHandoffTrack {
  const blockers = [
    ...requireEitherKeyBlocker(
      env,
      ["DEMO_BROWSER_EVIDENCE_URL", "DEMO_BROWSER_EVIDENCE_FILE"],
      "Browser demo evidence",
    ),
    ...validateHttpUrlMarker(env, "DEMO_BROWSER_EVIDENCE_URL"),
  ];

  return buildTrack({
    id: "browser_demo_evidence",
    title: "Browser Demo Evidence",
    blockers,
    commands: [
      `npm run demo:browser-evidence -- --origin=${origin} --output=../ops-evidence/demo-browser-evidence.json`,
    ],
    evidence: configuredMarkers(["DEMO_BROWSER_EVIDENCE_URL or DEMO_BROWSER_EVIDENCE_FILE"]),
    docs: ["docs/product-requirements/winbids-local-usable-mvp-plan.md"],
  });
}

function riskGateTrack(env: LaunchHandoffEnv): LaunchHandoffTrack {
  const blockers = [
    ...requireEitherKeyBlocker(env, ["RISK_CHECK_EVIDENCE_URL", "RISK_CHECK_EVIDENCE_FILE"], "Risk gate evidence"),
    ...validateHttpUrlMarker(env, "RISK_CHECK_EVIDENCE_URL"),
  ];

  return buildTrack({
    id: "risk_gate",
    title: "Risk And Security Gate",
    blockers,
    commands: ["npm run risk:check", "git diff --check"],
    evidence: configuredMarkers(["RISK_CHECK_EVIDENCE_URL or RISK_CHECK_EVIDENCE_FILE"]),
    docs: ["docs/product-requirements/winbids-current-gap-analysis.md"],
  });
}

export function buildLaunchHandoffReport(
  env: LaunchHandoffEnv = process.env,
  options: BuildLaunchHandoffOptions = {},
): LaunchHandoffReport {
  const origin = options.origin ?? defaultOrigin;
  const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
  const generatedAt = options.now?.() ?? new Date().toISOString();
  const tracks = [
    stripeSandboxTrack(env, origin),
    productionPreflightTrack(env),
    awsStagingDryRunTrack(env),
    liveSourceHealthTrack(env, readFile),
    browserEvidenceTrack(env, origin),
    riskGateTrack(env),
  ];
  const ready = tracks.filter((track) => track.status === "ready").length;
  const blocked = tracks.length - ready;

  return {
    ok: blocked === 0,
    generatedAt,
    summary: {
      total: tracks.length,
      ready,
      blocked,
    },
    tracks,
  };
}

export function formatLaunchHandoffMarkdown(report: LaunchHandoffReport) {
  const lines = [
    `# Launch handoff ${report.ok ? "READY" : "BLOCKED"}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Summary: ${report.summary.ready}/${report.summary.total} ready, ${report.summary.blocked} blocked.`,
    "",
  ];

  for (const track of report.tracks) {
    lines.push(`## ${track.status === "ready" ? "READY" : "BLOCKED"} - ${track.title}`);
    lines.push("");
    lines.push(`Track: ${track.id}`);
    lines.push("");

    if (track.blockers.length > 0) {
      lines.push("Blockers:");
      for (const blocker of track.blockers) {
        lines.push(`- ${blocker}`);
      }
      lines.push("");
    }

    lines.push("Commands:");
    for (const command of track.commands) {
      lines.push(`- \`${stripSensitiveValues(command)}\``);
    }
    lines.push("");

    lines.push("Evidence:");
    for (const evidence of track.evidence) {
      lines.push(`- ${stripSensitiveValues(evidence)}`);
    }
    lines.push("");

    lines.push("Docs:");
    for (const doc of track.docs) {
      lines.push(`- ${doc}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
