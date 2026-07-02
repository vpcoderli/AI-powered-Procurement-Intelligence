import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatSecretsScanResult, parseSecretsScanArgs, runSecretsScan } from "./secrets-scan";

describe("secrets scan", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "secrets-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSourceFile(relativePath: string, contents: string) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents, "utf8");
  }

  it("passes on an empty repository", async () => {
    const result = runSecretsScan(root);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("flags a hardcoded Stripe live secret key", async () => {
    await writeSourceFile(
      "frontend/src/bad.ts",
      'export const STRIPE_SECRET_KEY = "sk_live_51H8abcdefghijklmnopqrstuvwxyzABCD1234";\n',
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "stripe-live-secret-key")).toBe(true);
  });

  it("flags a hardcoded Stripe/webhook signing secret", async () => {
    await writeSourceFile(
      "frontend/src/bad.ts",
      'const webhookSecret = "whsec_ABC123DEF456GHI789JKL012MNO345";\n',
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "stripe-webhook-secret")).toBe(true);
  });

  it("flags a hardcoded AWS access key ID", async () => {
    await writeSourceFile("frontend/src/bad.ts", 'const awsKey = "AKIAABCDEFGHIJKLMNOP";\n');

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "aws-access-key-id")).toBe(true);
  });

  it("flags a high-entropy value assigned to a *_PASSWORD name", async () => {
    await writeSourceFile("frontend/src/bad.ts", 'const dbPassword = "Sup3rSecretP@ss9182";\n');

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(
      result.findings.some(
        (finding) => finding.ruleId === "generic-high-entropy-secret-assignment" && finding.match.startsWith("dbPassword="),
      ),
    ).toBe(true);
  });

  it("flags an .env-style KEY=value assignment for a credential-shaped name", async () => {
    await writeSourceFile("frontend/.env.example", "NOTIFICATION_HTTP_TOKEN=abcDEF123xyz789QRS456\n");

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(
      result.findings.some((finding) => finding.match.startsWith("NOTIFICATION_HTTP_TOKEN=")),
    ).toBe(true);
  });

  it("does not flag documented placeholders like REPLACE_ME or REDACTED variants", async () => {
    await writeSourceFile(
      "docs/example.md",
      [
        "STRIPE_SECRET_KEY=sk_test_REPLACE_ME",
        "STRIPE_WEBHOOK_SECRET=whsec_REPLACE_ME",
        "STRIPE_SECRET_KEY=sk_test_REDACTED_TEST_KEY",
        "",
      ].join("\n"),
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("does not flag .env.local even if it contains a real-looking secret", async () => {
    await writeSourceFile(
      "frontend/.env.local",
      "STRIPE_SECRET_KEY=sk_live_shouldNeverBeFlaggedBecausePathIsExcluded1234\n",
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("excludes its own test fixture file (secrets-scan.test.ts) from scanning", async () => {
    // Regression guard: this scanner's own *.test.ts file intentionally
    // contains hard-match-shaped fixture strings to prove those rules still
    // fire inside test files (see the two tests above). If this file were
    // ever scanned against its own rules, those fixtures would make the
    // scan fail on itself.
    await writeSourceFile(
      "frontend/scripts/secrets-scan.test.ts",
      'const awsKey = "AKIAABCDEFGHIJKLMNOP";\n',
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("does not walk into node_modules, .git, or build output directories", async () => {
    await writeSourceFile(
      "node_modules/some-pkg/index.js",
      'const STRIPE_SECRET_KEY = "sk_live_shouldBeIgnoredBecauseNodeModules1234";\n',
    );
    await writeSourceFile(
      "frontend/.next/server/bad.js",
      'const STRIPE_SECRET_KEY = "sk_live_shouldBeIgnoredBecauseBuildOutput1234";\n',
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("does not treat bare *Key domain identifiers as secret-shaped", async () => {
    await writeSourceFile(
      "frontend/src/ok.ts",
      [
        'const dedupeKey = "alert_1:2026-05-19:email";',
        'const featureKey = "submission_guidance";',
        'const configKey = "billing.provider";',
        'const primaryKey = "abcXYZ1234567890";',
        "",
      ].join("\n"),
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("does not flag property-access or function-call expressions assigned to *_KEY-shaped names", async () => {
    await writeSourceFile(
      "frontend/src/ok.ts",
      [
        "const featureKey = input.featureKey;",
        "const dateKey = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);",
        "",
      ].join("\n"),
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("does not apply the generic entropy rule inside *.test.ts fixture files", async () => {
    await writeSourceFile(
      "frontend/src/billing/production-preflight.test.ts",
      [
        'const env = { STRIPE_SECRET_KEY: "sk_test_secret_123", STRIPE_WEBHOOK_SECRET: "whsec_live_123" };',
        "",
      ].join("\n"),
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("still applies hard-match rules (real key shapes) inside *.test.ts files", async () => {
    await writeSourceFile(
      "frontend/src/billing/production-preflight.test.ts",
      'const env = { STRIPE_SECRET_KEY: "sk_live_51H8abcdefghijklmnopqrstuvwxyzABCD1234" };\n',
    );

    const result = runSecretsScan(root);

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) => finding.ruleId === "stripe-live-secret-key")).toBe(true);
  });

  it("does not flag a public key name", async () => {
    await writeSourceFile("frontend/src/ok.ts", 'const publicKey = "abcXYZ1234567890notSecret";\n');

    const result = runSecretsScan(root);

    expect(result.ok).toBe(true);
  });

  it("reports file, line, and rule id for each finding", async () => {
    await writeSourceFile(
      "frontend/src/bad.ts",
      ['// leading comment', 'const awsKey = "AKIAABCDEFGHIJKLMNOP";', ""].join("\n"),
    );

    const result = runSecretsScan(root);

    expect(result.findings).toEqual([
      expect.objectContaining({
        file: "frontend/src/bad.ts",
        line: 2,
        ruleId: "aws-access-key-id",
      }),
    ]);
  });

  it("formats a passing result", () => {
    const formatted = formatSecretsScanResult({
      ok: true,
      scannedAt: "2026-07-01T00:00:00.000Z",
      filesScanned: 42,
      findings: [],
    });

    expect(formatted).toContain("PASS");
    expect(formatted).toContain("42 files scanned");
  });

  it("formats a failing result with finding details", () => {
    const formatted = formatSecretsScanResult({
      ok: false,
      scannedAt: "2026-07-01T00:00:00.000Z",
      filesScanned: 3,
      findings: [
        {
          file: "frontend/src/bad.ts",
          line: 2,
          ruleId: "aws-access-key-id",
          ruleLabel: "AWS access key ID (AKIA...)",
          match: "AKIAABCDEFGHIJKLMNOP",
        },
      ],
    });

    expect(formatted).toContain("FAIL");
    expect(formatted).toContain("frontend/src/bad.ts:2");
    expect(formatted).toContain("AKIAABCDEFGHIJKLMNOP");
  });
});

describe("secrets scan CLI args", () => {
  it("defaults to no json and the provided default root", () => {
    const options = parseSecretsScanArgs([], "/repo");
    expect(options).toEqual({ json: false, root: "/repo", help: false });
  });

  it("parses --json and --root", () => {
    const options = parseSecretsScanArgs(["--json", "--root", "/tmp/other-repo"], "/repo");
    expect(options.json).toBe(true);
    expect(options.root).toBe(path.resolve("/tmp/other-repo"));
  });

  it("parses --help", () => {
    const options = parseSecretsScanArgs(["--help"], "/repo");
    expect(options.help).toBe(true);
  });

  it("throws on an unknown argument", () => {
    expect(() => parseSecretsScanArgs(["--bogus"], "/repo")).toThrow("Unknown argument: --bogus");
  });

  it("throws when --root is missing its value", () => {
    expect(() => parseSecretsScanArgs(["--root"], "/repo")).toThrow("--root requires a path argument");
  });
});
