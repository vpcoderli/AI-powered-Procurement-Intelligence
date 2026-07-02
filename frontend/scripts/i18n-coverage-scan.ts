/**
 * i18n coverage scan: static analysis over the two dictionaries
 * (`src/lib/i18n/dictionaries/en.ts` / `zh.ts`) and the App Router source
 * tree, looking for the three distinct classes of "untranslated variable"
 * defect described in the P1-5 task:
 *
 *   (a) KEY STRUCTURE DRIFT — a dot-path key present in one dictionary but
 *       missing (or an untranslated byte-identical copy) in the other. Note:
 *       `zh.ts` is typed as `Dictionary = typeof en` (see dictionaries/en.ts),
 *       so TypeScript's structural typing already prevents the zh dictionary
 *       object from being MISSING a key or having an extra key relative to
 *       en — a missing/extra key is a compile error, not a silent runtime
 *       gap. This scan re-verifies that invariant at the string level (in
 *       case the type ever loosens, e.g. to `Partial<Dictionary>`) and,
 *       more usefully, flags leaf VALUES that are byte-identical between the
 *       two dictionaries — the actual "still in English" runtime symptom.
 *
 *   (b) HARDCODED STRINGS — user-facing English text literals in JSX
 *       (text content, aria-label/title/placeholder/alt attributes) in
 *       `src/app/**` that bypass the dictionary/`t()` pattern entirely.
 *       This is the dominant real-world cause of "untranslated variable"
 *       reports — the string was simply never wired to i18n, so there is no
 *       missing key to find by diffing dictionaries.
 *
 *   (c) UNRESOLVED PLACEHOLDERS — dictionary values that contain a
 *       `{token}`-shaped placeholder (e.g. "{count}", "{used}") are meant to
 *       be resolved by the calling component via `.replace("{token}", ...)`
 *       or the local `formatMessage()` helper (see src/app/search/page.tsx).
 *       `t()` itself (src/lib/i18n/LanguageContext.tsx) does NOT interpolate
 *       — it is a pure dot-path lookup. If a component renders such a key
 *       bare (`{t("dashboard.resultsCount")}` with no `.replace(`), the
 *       literal "{count}" leaks into the rendered UI. This scan finds every
 *       dictionary key whose value contains a placeholder token, then greps
 *       the app tree for call sites of that key and flags any call site with
 *       no `.replace(`/`formatMessage(` in the surrounding statement.
 *
 * This script is a best-effort static scanner, not a type checker: part (c)
 * in particular relies on proximity heuristics (does `.replace(` or
 * `formatMessage(` appear within a few lines of the `t("key")` call) rather
 * than full expression parsing, so it can both under- and over-report on
 * unusual call shapes. Findings should be read as leads to verify, not as
 * ground truth — see docs/qa/i18n-coverage-report.md for a manually verified
 * pass over the routes this task prioritized.
 *
 * Usage:
 *   npx tsx scripts/i18n-coverage-scan.ts            # human-readable report
 *   npx tsx scripts/i18n-coverage-scan.ts --json      # machine-readable report
 *   npx tsx scripts/i18n-coverage-scan.ts --root ..   # override scan root (default: repo root)
 *
 * Exit code: 0 always (this is a reporting tool, not a CI gate). Pass
 * `--fail-on-findings` to exit 1 when any finding exists, if wiring this into
 * a merge gate later.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface KeyDriftFinding {
  type: "missing_in_zh" | "missing_in_en" | "identical_value";
  keyPath: string;
  enValue?: string;
  zhValue?: string;
}

export interface HardcodedStringFinding {
  file: string;
  line: number;
  kind: "text" | "aria-label" | "title" | "placeholder" | "alt";
  snippet: string;
}

export interface UnresolvedPlaceholderFinding {
  keyPath: string;
  placeholderTokens: string[];
  file: string;
  line: number;
  snippet: string;
}

export interface I18nCoverageScanResult {
  scannedAt: string;
  dictionaryKeyCount: { en: number; zh: number };
  keyDrift: KeyDriftFinding[];
  hardcodedStrings: HardcodedStringFinding[];
  unresolvedPlaceholders: UnresolvedPlaceholderFinding[];
}

// ---------------------------------------------------------------------------
// (a) Dictionary key-structure comparison
// ---------------------------------------------------------------------------

type DictionaryValue = string | { [key: string]: DictionaryValue };

/**
 * Extremely small, deliberately naive object-literal walker: rather than a
 * full TS/AST parse, this loads the compiled dictionary module directly via
 * `tsx`'s runtime (this script itself runs under tsx), which is the most
 * reliable way to get the *actual* object shape without re-implementing a TS
 * parser. Import paths are relative to this file.
 */
async function loadDictionary(relativeModulePath: string): Promise<DictionaryValue> {
  const mod = await import(relativeModulePath);
  // en.ts exports `en`, zh.ts exports `zh`.
  const exported = mod.en ?? mod.zh;
  if (!exported) {
    throw new Error(`Expected a named export "en" or "zh" from ${relativeModulePath}`);
  }
  return exported as DictionaryValue;
}

function flattenDictionary(value: DictionaryValue, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    for (const [k, v] of flattenDictionary(child, nextPrefix)) {
      out.set(k, v);
    }
  }
  return out;
}

/**
 * Keys where the EN and ZH values are conventionally allowed to be
 * byte-identical (acronyms, brand names, USPS state codes, format-only
 * placeholders) and should not be reported as "identical_value" drift. Kept
 * short and explicit rather than a broad heuristic, so new legitimate
 * English-in-both-locales additions must be deliberately added here — the
 * default assumption is that an identical value is a translation miss.
 */
const IDENTICAL_VALUE_ALLOWLIST = new Set<string>([
  "common.english",
  "header.initials",
  "settings.searchAlertStatesPlaceholder",
  "profilePage.statesPlaceholder",
  "admin.tier_pro",
  "admin.tier_business",
  "admin.responsePackageExportFormats.markdown",
  "admin.responsePackageExportFormats.zip",
  "admin.responsePackageExportFormats.pdf",
  "admin.responsePackageExportFormats.docx",
  "admin.artifactTypes.w9",
  "admin.sourceHealthClassification_ok",
]);

function compareDictionaries(en: Map<string, string>, zh: Map<string, string>): KeyDriftFinding[] {
  const findings: KeyDriftFinding[] = [];

  for (const [key, enValue] of en) {
    if (!zh.has(key)) {
      findings.push({ type: "missing_in_zh", keyPath: key, enValue });
      continue;
    }
    const zhValue = zh.get(key)!;
    if (zhValue === enValue && !IDENTICAL_VALUE_ALLOWLIST.has(key)) {
      findings.push({ type: "identical_value", keyPath: key, enValue, zhValue });
    }
  }

  for (const key of zh.keys()) {
    if (!en.has(key)) {
      findings.push({ type: "missing_in_en", keyPath: key, zhValue: zh.get(key) });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// (b) Hardcoded user-facing string scan
// ---------------------------------------------------------------------------

const APP_SCAN_EXTENSIONS = new Set([".tsx", ".ts"]);

// Directories skipped anywhere in the app tree.
const EXCLUDED_DIR_NAMES = new Set(["node_modules", ".git", ".next", "__pycache__"]);

function shouldSkipDir(name: string): boolean {
  return EXCLUDED_DIR_NAMES.has(name);
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (shouldSkipDir(entry)) continue;
      walk(fullPath, out);
    } else if (stats.isFile()) {
      if (APP_SCAN_EXTENSIONS.has(path.extname(entry))) out.push(fullPath);
    }
  }
}

// Matches a JSX text-content English sentence/phrase sitting directly between
// tags, e.g. `<p>Saved queue</p>` or `<h2>Workflow intelligence</h2>`. Requires
// at least one letter and excludes lines that are purely `{...}` expressions,
// pure punctuation, or a single short acronym-like token (heuristic to keep
// noise down — this is intentionally conservative to avoid drowning real
// findings in false positives from icons/whitespace-only lines).
const JSX_TEXT_PATTERN = />([A-Z][A-Za-z0-9 ,.'/&()-]{3,})</g;

// Matches hardcoded aria-label / title / placeholder / alt attributes with a
// literal double-quoted English string (not a `{t(...)}` expression or other
// JS expression container).
const HARDCODED_ATTR_PATTERN = /\b(aria-label|title|placeholder|alt)="([A-Za-z][A-Za-z0-9 ,.'/&()-]*)"/g;

// Lines that are clearly not user-facing text even though they match the
// coarse patterns above (className fragments, code comments, import/type
// lines) are filtered out via these guards rather than a stronger regex, to
// keep the primary pattern readable.
function looksLikeNonTextLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  if (trimmed.startsWith("import ") || trimmed.startsWith("export ")) return true;
  return false;
}

// A line containing `t("..."` or `t('...'` anywhere is assumed to already be
// routed through the dictionary for that segment, even if the coarse JSX
// text pattern also matches an adjacent literal on the same line (keeps the
// common `{condition ? t("a") : t("b")}` shape from false-firing).
function lineUsesTranslationHelper(line: string): boolean {
  return /\bt\(\s*[`'"]/.test(line) || /\bformatMessage\(/.test(line);
}

function scanHardcodedStrings(appRoot: string): HardcodedStringFinding[] {
  const files: string[] = [];
  walk(appRoot, files);

  const findings: HardcodedStringFinding[] = [];

  for (const filePath of files) {
    if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) continue;

    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const relativePath = path.relative(appRoot, filePath).split(path.sep).join("/");
    const lines = contents.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (looksLikeNonTextLine(line)) return;
      if (lineUsesTranslationHelper(line)) return;

      JSX_TEXT_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = JSX_TEXT_PATTERN.exec(line)) !== null) {
        const text = match[1].trim();
        // Skip pure-numeric / single-word-all-caps (likely a code/status
        // token rather than a sentence) and anything containing `{` (a JSX
        // expression slipped past the tag-content heuristic).
        if (/^\d+$/.test(text)) continue;
        if (text.includes("{") || text.includes("}")) continue;
        if (!/[a-z]/.test(text) && text.length <= 4) continue; // e.g. "PDF", "ZIP"
        findings.push({ file: relativePath, line: index + 1, kind: "text", snippet: text });
      }

      HARDCODED_ATTR_PATTERN.lastIndex = 0;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = HARDCODED_ATTR_PATTERN.exec(line)) !== null) {
        const [, attr, value] = attrMatch;
        findings.push({
          file: relativePath,
          line: index + 1,
          kind: attr as HardcodedStringFinding["kind"],
          snippet: value,
        });
      }
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// (c) Unresolved placeholder scan
// ---------------------------------------------------------------------------

const PLACEHOLDER_TOKEN_PATTERN = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

function extractPlaceholderTokens(value: string): string[] {
  const tokens: string[] = [];
  PLACEHOLDER_TOKEN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_TOKEN_PATTERN.exec(value)) !== null) {
    tokens.push(match[1]);
  }
  return tokens;
}

function scanUnresolvedPlaceholders(
  appRoot: string,
  enFlat: Map<string, string>,
): UnresolvedPlaceholderFinding[] {
  const placeholderKeys = new Map<string, string[]>();
  for (const [key, value] of enFlat) {
    const tokens = extractPlaceholderTokens(value);
    if (tokens.length > 0) placeholderKeys.set(key, tokens);
  }

  if (placeholderKeys.size === 0) return [];

  const files: string[] = [];
  walk(appRoot, files);

  const findings: UnresolvedPlaceholderFinding[] = [];

  for (const filePath of files) {
    if (/\.(test|spec)\.[jt]sx?$/.test(filePath)) continue;

    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const relativePath = path.relative(appRoot, filePath).split(path.sep).join("/");
    const lines = contents.split(/\r?\n/);

    for (const [keyPath, tokens] of placeholderKeys) {
      const needle = `"${keyPath}"`;
      const needleSingle = `'${keyPath}'`;

      lines.forEach((line, index) => {
        if (!line.includes(needle) && !line.includes(needleSingle)) return;
        if (!/\bt\(/.test(line)) return;

        // Look at a small window around the match (the call site's `.replace(`
        // chain or `formatMessage(` wrapper is usually on the same statement,
        // which may wrap onto adjacent lines).
        const windowStart = Math.max(0, index - 2);
        const windowEnd = Math.min(lines.length, index + 4);
        const window = lines.slice(windowStart, windowEnd).join("\n");

        const isResolved = /\.replace\(/.test(window) || /formatMessage\(/.test(window);
        if (isResolved) return;

        findings.push({
          keyPath,
          placeholderTokens: tokens,
          file: relativePath,
          line: index + 1,
          snippet: line.trim(),
        });
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Orchestration + CLI
// ---------------------------------------------------------------------------

export async function runI18nCoverageScan(frontendRoot: string): Promise<I18nCoverageScanResult> {
  const enPath = path.join(frontendRoot, "src/lib/i18n/dictionaries/en.ts");
  const zhPath = path.join(frontendRoot, "src/lib/i18n/dictionaries/zh.ts");

  const [enDict, zhDict] = await Promise.all([
    loadDictionary(pathToFileURL(enPath).href),
    loadDictionary(pathToFileURL(zhPath).href),
  ]);

  const enFlat = flattenDictionary(enDict);
  const zhFlat = flattenDictionary(zhDict);

  const keyDrift = compareDictionaries(enFlat, zhFlat);
  const appRoot = path.join(frontendRoot, "src", "app");
  const hardcodedStrings = scanHardcodedStrings(appRoot);
  const unresolvedPlaceholders = scanUnresolvedPlaceholders(appRoot, enFlat);

  return {
    scannedAt: new Date().toISOString(),
    dictionaryKeyCount: { en: enFlat.size, zh: zhFlat.size },
    keyDrift,
    hardcodedStrings,
    unresolvedPlaceholders,
  };
}

export function formatI18nCoverageScanResult(result: I18nCoverageScanResult): string {
  const lines: string[] = [];
  lines.push(`i18n coverage scan at ${result.scannedAt}`);
  lines.push(
    `Dictionary keys: en=${result.dictionaryKeyCount.en} zh=${result.dictionaryKeyCount.zh}`,
  );
  lines.push("");

  lines.push(`(a) Key structure drift: ${result.keyDrift.length} finding(s)`);
  for (const finding of result.keyDrift) {
    if (finding.type === "missing_in_zh") {
      lines.push(`  MISSING IN ZH  ${finding.keyPath}  (en: "${finding.enValue}")`);
    } else if (finding.type === "missing_in_en") {
      lines.push(`  MISSING IN EN  ${finding.keyPath}  (zh: "${finding.zhValue}")`);
    } else {
      lines.push(`  UNTRANSLATED   ${finding.keyPath}  (both: "${finding.enValue}")`);
    }
  }
  lines.push("");

  lines.push(
    `(b) Hardcoded strings bypassing t() in src/app: ${result.hardcodedStrings.length} finding(s) ` +
      `(heuristic scan — expect some false positives, see report notes)`,
  );
  for (const finding of result.hardcodedStrings) {
    lines.push(`  ${finding.file}:${finding.line} [${finding.kind}] "${finding.snippet}"`);
  }
  lines.push("");

  lines.push(
    `(c) Unresolved placeholder tokens: ${result.unresolvedPlaceholders.length} finding(s)`,
  );
  for (const finding of result.unresolvedPlaceholders) {
    lines.push(
      `  ${finding.file}:${finding.line} key=${finding.keyPath} tokens=${finding.placeholderTokens.join(",")}`,
    );
    lines.push(`    ${finding.snippet}`);
  }

  return lines.join("\n");
}

interface CliOptions {
  json: boolean;
  root: string;
  help: boolean;
  failOnFindings: boolean;
}

export function parseCliArgs(argv: string[], defaultRoot: string): CliOptions {
  const options: CliOptions = { json: false, root: defaultRoot, help: false, failOnFindings: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (!next) throw new Error("--root requires a path argument");
      options.root = path.resolve(next);
      i += 1;
    } else if (arg === "--fail-on-findings") {
      options.failOnFindings = true;
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
    "i18n Coverage Scan",
    "",
    "Usage:",
    "  tsx scripts/i18n-coverage-scan.ts",
    "  tsx scripts/i18n-coverage-scan.ts --json",
    "  tsx scripts/i18n-coverage-scan.ts --root /path/to/frontend",
    "  tsx scripts/i18n-coverage-scan.ts --fail-on-findings",
    "",
    "Options:",
    "  --json               Print the raw findings as JSON.",
    "  --root               Override the scan root (default: this frontend/ directory).",
    "  --fail-on-findings   Exit 1 if any finding exists (off by default; this is a",
    "                       reporting tool, not a merge gate, since the hardcoded-string",
    "                       heuristic has known false positives).",
    "  --help               Print this help.",
    "",
    "Scans for three classes of i18n gap: (a) key-structure drift or untranslated",
    "byte-identical values between src/lib/i18n/dictionaries/en.ts and zh.ts,",
    "(b) hardcoded English strings in src/app JSX that bypass t(...), and",
    "(c) dictionary values with unresolved {placeholder} tokens rendered bare.",
  ].join("\n");
}

function defaultFrontendRoot(): string {
  // scripts/ lives at frontend/scripts/i18n-coverage-scan.ts; frontend/ is one
  // level up from this file.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..");
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2), defaultFrontendRoot());
  if (options.help) {
    console.log(formatHelp());
    return;
  }

  const result = await runI18nCoverageScan(options.root);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatI18nCoverageScanResult(result));

  const totalFindings =
    result.keyDrift.length + result.hardcodedStrings.length + result.unresolvedPlaceholders.length;
  if (options.failOnFindings && totalFindings > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 2;
  });
}
