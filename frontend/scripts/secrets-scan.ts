/**
 * Secrets scan: walks the repository tree looking for hardcoded-secret-shaped
 * strings that should never be committed — live Stripe keys, webhook signing
 * secrets, AWS access key IDs, and generic high-entropy values assigned to
 * `*_SECRET` / `*_KEY` / `*_TOKEN` / `*_PASSWORD` style variable/env names.
 *
 * This formalizes the ad hoc `rg` command documented in
 * `docs/transferability/environment-variables.md` ("Check for accidental
 * secret-looking values") and `docs/transferability/secrets-and-access.md`
 * ("Local secret scan before sharing") into a script with a non-zero exit
 * code on findings, suitable for CI (`npm run risk:check` wires this in).
 *
 * What this catches:
 *   - Stripe live secret keys: `sk_live_...`
 *   - Stripe/webhook signing secrets: `whsec_...`
 *   - AWS access key IDs: `AKIA[0-9A-Z]{16}`
 *   - `SOME_SECRET=`, `someKey: "..."`, `API_TOKEN = '...'`, etc. assigned a
 *     high-entropy-looking literal, for variable/env names ending in
 *     SECRET / KEY / TOKEN / PASSWORD (case-insensitive, camelCase or
 *     SCREAMING_SNAKE_CASE).
 *
 * What this deliberately allows (false-negative by design, not a bug):
 *   - `.env.local` (never committed; see .gitignore) is skipped entirely.
 *   - Documented placeholders such as `REPLACE_ME`, `sk_test_REPLACE_ME`,
 *     `whsec_REPLACE_ME`, `REDACTED_...`, `<...>` template slots,
 *     `xxx`/`****` masks, and other low-entropy/placeholder-shaped values
 *     are not flagged — the goal is to catch real-looking secrets, not
 *     every mention of the word "secret" in documentation.
 *   - `*.test.ts` / `*.spec.ts` (and `.tsx`/`.js`/`.jsx` equivalents) skip
 *     the generic high-entropy rule, since this codebase's test suites
 *     legitimately hardcode fake-but-realistic-shaped fixture values (e.g.
 *     `STRIPE_SECRET_KEY=sk_test_secret_123` to exercise the production
 *     preflight validator). The hard-match rules for unambiguous real
 *     secret shapes (`sk_live_`, `whsec_`, `AKIA...`) still apply to test
 *     files.
 *   - node_modules, .git, build/dist output, and coverage are excluded from
 *     the walk (see EXCLUDED_DIR_NAMES below).
 *   - A bare `*_KEY`/`*Key` name is NOT treated as secret-shaped on its own
 *     (this codebase uses many non-secret `*Key` identifiers — dedupeKey,
 *     featureKey, configKey, labelKey); only KEY names paired with a
 *     credential-signaling word count (SECRET_KEY, API_KEY, ACCESS_KEY,
 *     PRIVATE_KEY, CLIENT_KEY, SIGNING_KEY, ENCRYPTION_KEY). SECRET, TOKEN,
 *     and PASSWORD suffixes always count on their own.
 *
 * Usage:
 *   npx tsx scripts/secrets-scan.ts            # scan repo root, human output
 *   npx tsx scripts/secrets-scan.ts --json      # machine-readable output
 *   npx tsx scripts/secrets-scan.ts --root ..   # override scan root (default: repo root, one level up from frontend/)
 *
 * Exit code: 0 if no findings, 1 if any finding, 2 on scan error.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface SecretsScanFinding {
  file: string;
  line: number;
  ruleId: string;
  ruleLabel: string;
  match: string;
}

export interface SecretsScanResult {
  ok: boolean;
  scannedAt: string;
  filesScanned: number;
  findings: SecretsScanFinding[];
}

// Directories skipped anywhere in the tree (matched by base name).
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "out",
  "build",
  "dist",
  "coverage",
  ".vercel",
  "__pycache__",
  ".pytest_cache",
  ".turbo",
  "data", // local sqlite/runtime state, not source
]);

// Specific repo-relative paths skipped outright (never scanned even if not a
// directory match above). Paths are matched relative to the scan root.
const EXCLUDED_RELATIVE_PATHS = new Set([
  "frontend/.env.local",
  ".env.local",
  // This scanner's own test suite deliberately contains fake but
  // hard-match-shaped strings (sk_live_..., whsec_..., AKIA...) to prove the
  // hard-match rules still fire inside *.test.ts files. Scanning this file
  // against its own rules would make the test fixtures fail the scan they
  // exist to validate; the fixtures are never real secrets.
  "frontend/scripts/secrets-scan.test.ts",
]);

// File extensions worth scanning as text. Binary/asset/lockfile types are
// skipped both for speed and because they are not where hand-typed secrets
// end up.
const SCANNABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".json",
  ".md",
  ".mdx",
  ".yml",
  ".yaml",
  ".env",
  ".env.example",
  ".sh",
  ".sql",
  ".txt",
  ".toml",
  ".ini",
  ".cfg",
]);

// Files that are documented, deliberately-fake placeholder collections and
// should not trip the generic entropy heuristic even though they may contain
// example env-var-shaped lines. Real secret-shaped literals (sk_live_,
// whsec_, AKIA...) are still caught everywhere, including these files.
const PLACEHOLDER_DOC_ALLOWLIST = new Set([
  "docs/transferability/environment-variables.md",
  "docs/transferability/secrets-and-access.md",
  "docs/operations/aws-deployment-runbook.md",
  "docs/operations/secrets-manager-guide.md",
]);

interface ScanRule {
  id: string;
  label: string;
  pattern: RegExp;
}

// Rules 1-3: unambiguous real-secret shapes. These are never placeholders in
// practice (a real Stripe live key literally starts with sk_live_, etc.), so
// they apply everywhere, including the placeholder-doc allowlist and .md
// files, and are not subject to the entropy/placeholder suppression below.
const HARD_MATCH_RULES: ScanRule[] = [
  {
    id: "stripe-live-secret-key",
    label: "Stripe live secret key (sk_live_...)",
    pattern: /sk_live_[A-Za-z0-9]{10,}/g,
  },
  {
    id: "stripe-webhook-secret",
    label: "Stripe/webhook signing secret (whsec_...)",
    pattern: /whsec_[A-Za-z0-9]{10,}/g,
  },
  {
    id: "aws-access-key-id",
    label: "AWS access key ID (AKIA...)",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
];

// Rule 4: generic "SOMETHING_SECRET/API_KEY/TOKEN/PASSWORD = <value>"
// assignment, for both SCREAMING_SNAKE_CASE env-style and camelCase
// code-style names. Case-insensitive so it also catches lower/mixed-case
// suffixes (e.g. `dbPassword`, `webhookSecret`), and greedily consumes the
// full identifier so multi-word names like `STRIPE_SECRET_KEY` are captured
// whole rather than truncated at the first suffix word found.
//
// The name suffix is intentionally NOT a bare "KEY" — this codebase makes
// heavy legitimate use of *Key as a plain domain identifier (dedupeKey,
// featureKey, configKey, labelKey, sortKey...) that has nothing to do with
// credentials. Matching bare KEY produced a very high false-positive rate
// during development of this rule. Instead, a trailing KEY only counts when
// it is paired with a credential-signaling word (SECRET_KEY, API_KEY,
// ACCESS_KEY, PRIVATE_KEY, CLIENT_KEY, SIGNING_KEY, ENCRYPTION_KEY), which
// matches how every real secret-shaped env var in this repo is actually
// named (see docs/transferability/environment-variables.md: STRIPE_SECRET_KEY,
// SAM_API_KEY, OBJECT_STORAGE_SECRET_ACCESS_KEY). SECRET, TOKEN, and
// PASSWORD suffixes always count on their own.
const CREDENTIAL_NAME_PATTERN =
  /(?:SECRET|TOKEN|PASSWORD|(?:SECRET|API|ACCESS|PRIVATE|CLIENT|SIGNING|ENCRYPTION)[_A-Z]*KEY)$/i;

// Two sub-patterns, deliberately NOT a single "value is any non-whitespace
// token" pattern:
//   (a) QUOTED_LITERAL_PATTERN: NAME = "value" / NAME: 'value' in source
//       code. Requires an actual quoted string literal on the right-hand
//       side, so property access and function-call expressions like
//       `dedupeKey = input.featureKey` or `dateKey = hmacSha256(...)` are
//       NOT matched — those are ordinary code identifiers rather than
//       hardcoded secret values.
//   (b) ENV_LINE_PATTERN: a whole-line `NAME=value` (optionally
//       `export NAME=value`), the shape used in `.env*`, shell, and CI YAML
//       env blocks, where the value is intentionally unquoted.
const QUOTED_LITERAL_PATTERN =
  /\b([A-Za-z][A-Za-z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD))\s*[:=]\s*(["'])((?:(?!\2)[^\\]|\\.)*)\2/gi;
const ENV_LINE_PATTERN =
  /^\s*(?:export\s+)?([A-Za-z][A-Za-z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD))\s*=\s*([^\s#]+)\s*$/i;

// Matched against the whole value (not just as a prefix), because
// documented placeholders are commonly written with a real-looking prefix,
// e.g. `sk_test_REPLACE_ME`, `whsec_REPLACE_ME`, `price_REPLACE_ME`.
const PLACEHOLDER_VALUE_PATTERNS: RegExp[] = [
  /REPLACE_ME/i,
  /REPLACE[_-]?ME/i,
  /REDACTED/i,
  /CHANGE_ME/i,
  /YOUR_/i,
  /^<.*>$/,
  /^\$\{.*\}$/,
  /^process\.env\./,
  /^env\./,
  /^x{3,}$/i,
  /^\*{3,}$/,
  /^\.{3,}$/,
  /example/i,
  /sample/i,
  /placeholder/i,
  /^test[_-]?value$/i,
  /^undefined$/,
  /^null$/,
  /^""$/,
  /^''$/,
  /^$/,
  /^\d+$/, // pure numeric (price IDs handled separately, but plain numbers are not secret-shaped)
];

// Names that are explicitly not treated as secrets even though they match
// CREDENTIAL_NAME_PATTERN (e.g. public keys are not secret by definition).
const GENERIC_NAME_ALLOWLIST = new Set([
  "publickey",
  "public_key",
]);

function isHighEntropyLikeSecret(value: string): boolean {
  if (value.length < 12) return false;
  if (PLACEHOLDER_VALUE_PATTERNS.some((pattern) => pattern.test(value))) return false;

  const hasUpper = /[A-Z]/.test(value);
  const hasLower = /[a-z]/.test(value);
  const hasDigit = /[0-9]/.test(value);
  const varietyScore = [hasUpper, hasLower, hasDigit].filter(Boolean).length;

  // Require at least two character classes (letters+digits, or mixed case)
  // and no whitespace, to approximate "looks like a real generated secret"
  // rather than a sentence, URL, or config phrase.
  if (varietyScore < 2) return false;
  if (/\s/.test(value)) return false;

  return true;
}

function shouldSkipDir(name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name) || name.startsWith(".") && name !== ".github";
}

function isScannableFile(fileName: string): boolean {
  const ext = path.extname(fileName);
  if (fileName === ".env.example") return true;
  return SCANNABLE_EXTENSIONS.has(ext);
}

function walk(dir: string, root: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const relativePath = path.relative(root, fullPath);

    if (EXCLUDED_RELATIVE_PATHS.has(relativePath)) continue;

    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      walk(fullPath, root, out);
    } else if (stats.isFile()) {
      if (isScannableFile(entry)) out.push(fullPath);
    }
  }
}

// Test files legitimately assign fake-but-realistic-shaped values (e.g.
// `STRIPE_SECRET_KEY=sk_test_secret_123`, `temporaryPassword=temp-password-123`)
// as fixtures for exercising validators like production-preflight and admin
// user creation. Those are not real secrets, so the generic entropy rule is
// skipped for test files. The hard-match rules (real sk_live_/whsec_/AKIA
// shapes) still apply everywhere, including test files — a real leaked key
// pasted into a test fixture is still a real leaked key.
function isTestFile(relativePath: string): boolean {
  return /\.(test|spec)\.[jt]sx?$/.test(relativePath);
}

function scanFileContents(relativePath: string, contents: string): SecretsScanFinding[] {
  const findings: SecretsScanFinding[] = [];
  const lines = contents.split(/\r?\n/);
  const isAllowlistedDoc = PLACEHOLDER_DOC_ALLOWLIST.has(relativePath);
  const skipGenericRule = isAllowlistedDoc || isTestFile(relativePath);

  lines.forEach((line, index) => {
    for (const rule of HARD_MATCH_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(line)) !== null) {
        findings.push({
          file: relativePath,
          line: index + 1,
          ruleId: rule.id,
          ruleLabel: rule.label,
          match: match[0],
        });
      }
    }

    if (skipGenericRule) return;

    const genericCandidates: Array<{ name: string; value: string }> = [];

    QUOTED_LITERAL_PATTERN.lastIndex = 0;
    let quotedMatch: RegExpExecArray | null;
    while ((quotedMatch = QUOTED_LITERAL_PATTERN.exec(line)) !== null) {
      genericCandidates.push({ name: quotedMatch[1], value: quotedMatch[3] });
    }

    const envMatch = ENV_LINE_PATTERN.exec(line);
    if (envMatch) {
      genericCandidates.push({ name: envMatch[1], value: envMatch[2] });
    }

    for (const { name, value } of genericCandidates) {
      if (!CREDENTIAL_NAME_PATTERN.test(name)) continue;
      if (GENERIC_NAME_ALLOWLIST.has(name.toLowerCase())) continue;
      if (!isHighEntropyLikeSecret(value)) continue;

      findings.push({
        file: relativePath,
        line: index + 1,
        ruleId: "generic-high-entropy-secret-assignment",
        ruleLabel: `High-entropy value assigned to ${name}`,
        match: `${name}=${value}`,
      });
    }
  });

  return findings;
}

export function runSecretsScan(root: string): SecretsScanResult {
  const files: string[] = [];
  walk(root, root, files);

  const findings: SecretsScanFinding[] = [];
  let filesScanned = 0;

  for (const filePath of files) {
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    filesScanned += 1;
    findings.push(...scanFileContents(relativePath, contents));
  }

  return {
    ok: findings.length === 0,
    scannedAt: new Date().toISOString(),
    filesScanned,
    findings,
  };
}

export function formatSecretsScanResult(result: SecretsScanResult): string {
  if (result.ok) {
    return `Secrets scan PASS at ${result.scannedAt} (${result.filesScanned} files scanned, 0 findings)`;
  }

  const lines = [
    `Secrets scan FAIL at ${result.scannedAt} (${result.filesScanned} files scanned, ${result.findings.length} findings)`,
    ...result.findings.map(
      (finding) => `  ${finding.file}:${finding.line} [${finding.ruleId}] ${finding.ruleLabel} -> ${finding.match}`,
    ),
  ];

  return lines.join("\n");
}

interface SecretsScanCliOptions {
  json: boolean;
  root: string;
  help: boolean;
}

export function parseSecretsScanArgs(argv: string[], defaultRoot: string): SecretsScanCliOptions {
  const options: SecretsScanCliOptions = { json: false, root: defaultRoot, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (!next) throw new Error("--root requires a path argument");
      options.root = path.resolve(next);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function formatHelp(): string {
  return [
    "Secrets Scan",
    "",
    "Usage:",
    "  tsx scripts/secrets-scan.ts",
    "  tsx scripts/secrets-scan.ts --json",
    "  tsx scripts/secrets-scan.ts --root /path/to/repo",
    "",
    "Options:",
    "  --json   Print the raw findings as JSON.",
    "  --root   Override the scan root (default: repository root, one level above frontend/).",
    "  --help   Print this help.",
    "",
    "Scans for hardcoded-secret-shaped strings (Stripe live keys, webhook secrets,",
    "AWS access key IDs, and high-entropy *_SECRET/*_KEY/*_TOKEN/*_PASSWORD",
    "assignments), excluding node_modules, .git, build output, and .env.local.",
    "Exits non-zero on any finding.",
  ].join("\n");
}

function defaultScanRoot(): string {
  // scripts/ lives at frontend/scripts/secrets-scan.ts; the repo root is two
  // levels up from this file.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

function main() {
  const options = parseSecretsScanArgs(process.argv.slice(2), defaultScanRoot());
  if (options.help) {
    console.log(formatHelp());
    return;
  }

  const result = runSecretsScan(options.root);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatSecretsScanResult(result));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
