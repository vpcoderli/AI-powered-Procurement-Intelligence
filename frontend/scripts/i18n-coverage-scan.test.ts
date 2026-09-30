import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SCAN_SOURCE_ROOTS,
  formatI18nCoverageScanResult,
  scanHardcodedStrings,
  scanUnresolvedPlaceholders,
  type I18nCoverageScanResult,
} from "./i18n-coverage-scan";

describe("i18n coverage scan", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "i18n-scan-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function writeSourceFile(relativePath: string, contents: string) {
    const fullPath = path.join(root, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, contents, "utf8");
  }

  it("walks the App Router tree and the admin console components", () => {
    expect([...SCAN_SOURCE_ROOTS]).toEqual(["src/app", "src/components/admin"]);
  });

  describe("hard-coded strings", () => {
    it("finds JSX text and attributes in both trees and reports paths from the frontend root", async () => {
      await writeSourceFile("src/app/page.tsx", ["function A() {", "  return <h1>Welcome home</h1>;", "}", ""].join("\n"));
      await writeSourceFile(
        "src/components/admin/sections/ExampleSection.tsx",
        [
          "function B() {",
          "  return (",
          "    <div>",
          "      <TableHead>Change reason</TableHead>",
          '      <Input aria-label="Reason input" placeholder="Type a reason" />',
          "    </div>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );

      const findings = scanHardcodedStrings(root);

      expect(findings).toEqual(
        expect.arrayContaining([
          { file: "src/app/page.tsx", line: 2, kind: "text", snippet: "Welcome home" },
          { file: "src/components/admin/sections/ExampleSection.tsx", line: 4, kind: "text", snippet: "Change reason" },
          { file: "src/components/admin/sections/ExampleSection.tsx", line: 5, kind: "aria-label", snippet: "Reason input" },
          { file: "src/components/admin/sections/ExampleSection.tsx", line: 5, kind: "placeholder", snippet: "Type a reason" },
        ]),
      );
      expect(findings).toHaveLength(4);
    });

    it("leaves tests, translated lines and other component trees alone", async () => {
      await writeSourceFile("src/components/admin/Example.test.tsx", "  const x = <p>Only in a test</p>;\n");
      await writeSourceFile("src/components/admin/Example.spec.ts", '  const y = "<p>Only in a spec</p>";\n');
      await writeSourceFile("src/components/admin/Translated.tsx", '  return <p title="Plain">{t("admin.x")}</p>;\n');
      await writeSourceFile("src/components/bids/Card.tsx", "  return <p>Outside the scanned trees</p>;\n");

      expect(scanHardcodedStrings(root)).toEqual([]);
    });

    it("scans the roots it is given, and a root that does not exist scans nothing", async () => {
      await writeSourceFile("src/components/bids/Card.tsx", "  return <p>Bid card text</p>;\n");

      expect(scanHardcodedStrings(root, ["src/components/bids"]).map((finding) => finding.file)).toEqual([
        "src/components/bids/Card.tsx",
      ]);
      expect(scanHardcodedStrings(root, ["src/components/missing"])).toEqual([]);
      expect(scanHardcodedStrings(root)).toEqual([]);
    });
  });

  describe("unresolved placeholders", () => {
    const enFlat = new Map<string, string>([
      ["admin.rows", "{count} rows"],
      ["admin.lead", "Lives in {key} and more"],
      ["admin.pair", "From {first} to {second}"],
      ["admin.crawlerConfigAttachmentTemplate", "Attachment URL template (optional, {id} / {source_bid_id})"],
      ["admin.plain", "No placeholder here"],
    ]);

    it("flags a placeholder key rendered bare, in the admin components as well as the app tree", async () => {
      await writeSourceFile("src/app/page.tsx", 'export const A = () => <p>{t("admin.rows")}</p>;\n');
      await writeSourceFile(
        "src/components/admin/Panel.tsx",
        'export const B = () => <p>{t("admin.rows")}</p>;\n',
      );

      const findings = scanUnresolvedPlaceholders(root, enFlat);

      expect(findings.map((finding) => [finding.file, finding.keyPath, finding.placeholderTokens])).toEqual(
        expect.arrayContaining([
          ["src/app/page.tsx", "admin.rows", ["count"]],
          ["src/components/admin/Panel.tsx", "admin.rows", ["count"]],
        ]),
      );
      expect(findings).toHaveLength(2);
    });

    it("accepts a placeholder resolved by replace, by split around a JSX element, or by formatMessage", async () => {
      await writeSourceFile(
        "src/components/admin/Panel.tsx",
        [
          'export const A = () => <p>{t("admin.rows").replace("{count}", "3")}</p>;',
          "",
          "export function B() {",
          '  const [before, after = ""] = t("admin.lead").split("{key}");',
          "  return <p>{before}<code>x</code>{after}</p>;",
          "}",
          "",
          'export const C = () => <p>{formatMessage(t("admin.rows"), { count: 3 })}</p>;',
          "",
        ].join("\n"),
      );

      expect(scanUnresolvedPlaceholders(root, enFlat)).toEqual([]);
    });

    // The scan reads a window of a few lines around each call, so every case sits in a file of its own: a neighbouring
    // line must not be what resolves (or reports) the one under test.
    it("accepts a split on the key's own token whatever the quotes, and on any one token of a key with several", async () => {
      const resolved: Record<string, string> = {
        doubleQuotes: 'const [a, b = ""] = t("admin.lead").split("{key}");',
        singleQuotes: "const [a, b = ''] = t('admin.lead').split('{key}');",
        backticks: 'const [a, b = ""] = t("admin.lead").split(`{key}`);',
        spaced: 'const [a, b = ""] = t("admin.lead").split( "{key}" );',
        withLimit: 'const [a] = t("admin.lead").split("{key}", 2);',
        secondOfTwoTokens: 'const [a] = t("admin.pair").split("{second}");',
      };
      for (const [name, line] of Object.entries(resolved)) {
        await writeSourceFile(`src/components/admin/${name}.tsx`, `${line}\n`);
      }

      expect(scanUnresolvedPlaceholders(root, enFlat)).toEqual([]);
    });

    // `.split("{` used to resolve any key near it. The split has to be on one of the key's own tokens: a bare key with an
    // unrelated split beside it (a token of another key, or of the caller's own template) is still leaking its braces.
    it("reports a bare placeholder key beside a split on some other token", async () => {
      await writeSourceFile(
        "src/components/admin/Panel.tsx",
        [
          "export function A() {",
          '  const rows = t("admin.rows");',
          '  const [head] = template.split("{other}");',
          '  const [before] = t("admin.lead").split("{key}");',
          "  return <p>{rows}{head}{before}</p>;",
          "}",
          "",
        ].join("\n"),
      );

      const findings = scanUnresolvedPlaceholders(root, enFlat);

      // {other} belongs to no key, and {key} belongs to admin.lead, not to admin.rows ({count}).
      expect(findings.map((finding) => [finding.file, finding.line, finding.keyPath, finding.placeholderTokens])).toEqual([
        ["src/components/admin/Panel.tsx", 2, "admin.rows", ["count"]],
      ]);
    });

    it("reports a key split on a token it does not have, and a split that is no placeholder at all", async () => {
      await writeSourceFile("src/components/admin/A.tsx", 'const [x] = t("admin.lead").split("{count}");\n');
      await writeSourceFile("src/components/admin/B.tsx", 'const [x] = t("admin.pair").split("{key}");\n');
      await writeSourceFile("src/components/admin/C.tsx", 'const words = t("admin.rows").split(" ");\n');

      const findings = scanUnresolvedPlaceholders(root, enFlat);

      expect(findings.map((finding) => [finding.file, finding.keyPath]).sort()).toEqual([
        ["src/components/admin/A.tsx", "admin.lead"],
        ["src/components/admin/B.tsx", "admin.pair"],
        ["src/components/admin/C.tsx", "admin.rows"],
      ]);
    });

    it("skips a key whose braces are the content, such as the attachment URL template label", async () => {
      await writeSourceFile(
        "src/components/admin/CrawlerConfigPanel.tsx",
        'export const A = () => <span>{t("admin.crawlerConfigAttachmentTemplate")}</span>;\n',
      );

      expect(scanUnresolvedPlaceholders(root, enFlat)).toEqual([]);
    });
  });

  it("prints a finding as file:line [kind] \"snippet\" and names the trees it scanned", () => {
    const result: I18nCoverageScanResult = {
      scannedAt: "2026-09-30T00:00:00.000Z",
      dictionaryKeyCount: { en: 1, zh: 1 },
      keyDrift: [],
      hardcodedStrings: [
        { file: "src/components/admin/sections/ExampleSection.tsx", line: 3, kind: "text", snippet: "Change reason" },
      ],
      unresolvedPlaceholders: [],
    };

    const report = formatI18nCoverageScanResult(result);

    expect(report).toContain("(b) Hardcoded strings bypassing t() in src/app, src/components/admin: 1 finding(s)");
    expect(report).toContain('  src/components/admin/sections/ExampleSection.tsx:3 [text] "Change reason"');
    expect(report).toContain("(c) Unresolved placeholder tokens in src/app, src/components/admin: 0 finding(s)");
  });
});
