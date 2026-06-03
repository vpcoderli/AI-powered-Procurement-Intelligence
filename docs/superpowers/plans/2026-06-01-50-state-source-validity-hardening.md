# 50-State Source Validity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 50-state crawler data defensible by adding source-validity metadata, deterministic URL/attachment validity checks, risk-check enforcement, and Admin API visibility.

**Architecture:** Extend the existing state crawler registry as the single source of truth, add a small pure URL validator module, consume both from `risk:check`, and surface trust metadata through the existing Admin Data Sources repository. Keep live portal probing out of the default test path so local and CI checks stay deterministic.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, Drizzle SQLite/MySQL repository adapters, existing crawler source registry.

---

## File Structure

- Modify `frontend/src/lib/state-crawler-sources.ts`: add source-validity types, derive metadata, export fields on every state source.
- Modify `frontend/src/lib/state-crawler-sources.test.ts`: assert all 50 sources carry validity metadata and fallback/verified states are labeled correctly.
- Create `frontend/src/server/source-validity/url-validity.ts`: pure validation helpers for bid source URLs and attachment URLs.
- Create `frontend/src/server/source-validity/url-validity.test.ts`: TDD coverage for placeholder, malformed, safe portal, safe API attachment, and unsafe external attachment cases.
- Modify `frontend/src/server/risk/checklist.ts`: add `source-validity-metadata` and `state-url-validity` checks.
- Modify `frontend/src/server/risk/checklist.test.ts`: assert new checks pass for valid seed data and fail for placeholder source/attachment URLs.
- Modify `frontend/src/server/admin/data-sources-repository.ts`: expose trust metadata on `AdminDataSource`.
- Modify `frontend/src/server/admin/data-sources-repository.test.ts`: cover SQLite and fake MySQL paths.
- Modify product/status docs after code is green.

## Task 1: Source Validity Metadata

**Files:**
- Modify: `frontend/src/lib/state-crawler-sources.ts`
- Test: `frontend/src/lib/state-crawler-sources.test.ts`

- [ ] **Step 1: Write failing tests**

Add expectations:

```ts
expect(STATE_CRAWLER_SOURCES.every((source) => source.sourceAuthority)).toBe(true);
expect(STATE_CRAWLER_SOURCES.every((source) => source.trustStatus)).toBe(true);
expect(STATE_CRAWLER_SOURCES.every((source) => source.evidenceMode)).toBe(true);
expect(STATE_CRAWLER_SOURCES.every((source) => source.validityNotes.trim().length > 0)).toBe(true);

expect(getStateCrawlerSourceMetadata("CA")).toMatchObject({
  sourceAuthority: "official",
  trustStatus: "verified",
  evidenceMode: "direct_portal",
});

for (const stateCode of ["AL", "AK", "AZ", "CO", "ID", "KY", "LA", "MD", "MI", "MN", "NC", "ND", "NE", "NH", "OH", "SC", "VT", "WI", "WV"]) {
  expect(getStateCrawlerSourceMetadata(stateCode)).toMatchObject({
    sourceAuthority: "public_aggregator",
    trustStatus: "fallback",
    evidenceMode: "aggregator_page",
  });
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts
```

Expected: FAIL because `sourceAuthority`, `trustStatus`, `evidenceMode`, and `validityNotes` are not defined.

- [ ] **Step 3: Implement metadata**

Add:

```ts
export type SourceAuthority = "official" | "official_aggregator" | "public_aggregator";
export type SourceTrustStatus = "verified" | "beta" | "fallback" | "needs_review" | "blocked";
export type SourceEvidenceMode = "direct_portal" | "api" | "aggregator_page" | "fixture_fallback";

export type SourceValidityMetadata = {
  sourceAuthority: SourceAuthority;
  trustStatus: SourceTrustStatus;
  evidenceMode: SourceEvidenceMode;
  validityNotes: string;
};
```

Add a `BIDNET_FALLBACK_SOURCE_IDS` set for the known public aggregator fallback sources and a `validityForMetadata(source, metadata)` helper:

```ts
const BIDNET_FALLBACK_SOURCE_IDS = new Set<StateCrawlerSourceDefinitionId>([
  "al_state_procurement",
  "ak_state_procurement",
  "az_state_procurement",
  "co_state_procurement",
  "id_state_procurement",
  "ky_state_procurement",
  "la_state_procurement",
  "md_state_procurement",
  "mi_state_procurement",
  "mn_state_procurement",
  "nc_state_procurement",
  "nd_state_procurement",
  "ne_state_procurement",
  "nh_state_procurement",
  "oh_state_procurement",
  "sc_state_procurement",
  "vt_state_procurement",
  "wi_state_procurement",
  "wv_state_procurement",
]);

function validityForMetadata(
  source: StateCrawlerSourceDefinition,
  metadata: CrawlerMetadata,
): SourceValidityMetadata {
  if (BIDNET_FALLBACK_SOURCE_IDS.has(source.id)) {
    return {
      sourceAuthority: "public_aggregator",
      trustStatus: "fallback",
      evidenceMode: "aggregator_page",
      validityNotes: "Uses public BidNet-style opportunity pages when the official state route is unavailable, blocked, or not reliably machine-readable.",
    };
  }

  if (metadata.maturity === "verified") {
    return {
      sourceAuthority: "official",
      trustStatus: "verified",
      evidenceMode: "direct_portal",
      validityNotes: "Verified public state procurement portal with deterministic parser coverage.",
    };
  }

  return {
    sourceAuthority: "official",
    trustStatus: "beta",
    evidenceMode: "direct_portal",
    validityNotes: "Beta public state procurement portal parser; requires ongoing operator review before production approval.",
  };
}
```

Merge it into `STATE_CRAWLER_SOURCES`.

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts
```

Expected: PASS.

## Task 2: URL Validity Module

**Files:**
- Create: `frontend/src/server/source-validity/url-validity.ts`
- Test: `frontend/src/server/source-validity/url-validity.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests:

```ts
import { describe, expect, it } from "vitest";
import {
  validateBidSourceUrl,
  validateStateAttachmentUrl,
} from "./url-validity";

describe("source URL validity", () => {
  it("accepts real https state portal URLs", () => {
    expect(validateBidSourceUrl("https://caleprocure.ca.gov/event/CA-2026-1")).toEqual([]);
  });

  it("rejects empty, malformed, local, example, and known demo URLs", () => {
    expect(validateBidSourceUrl("")).toContainEqual(expect.objectContaining({ code: "empty_url" }));
    expect(validateBidSourceUrl("not a url")).toContainEqual(expect.objectContaining({ code: "invalid_url" }));
    expect(validateBidSourceUrl("http://localhost:3000/bids/1")).toContainEqual(expect.objectContaining({ code: "placeholder_url" }));
    expect(validateBidSourceUrl("https://example.com/bid/1")).toContainEqual(expect.objectContaining({ code: "placeholder_url" }));
    expect(validateBidSourceUrl("https://sam.gov/opp/12345/sow.pdf")).toContainEqual(expect.objectContaining({ code: "placeholder_url" }));
  });

  it("accepts safe local attachment download routes", () => {
    expect(validateStateAttachmentUrl("/api/bids/ca_caleprocure%3A1/attachments/sow_pdf")).toEqual([]);
  });

  it("rejects raw external attachment URLs for state risk checks", () => {
    expect(validateStateAttachmentUrl("https://sam.gov/opp/12345/sow.pdf")).toContainEqual(
      expect.objectContaining({ code: "unsafe_external_attachment" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm test -- src/server/source-validity/url-validity.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal validator**

Create:

```ts
export type SourceValidityFindingCode =
  | "empty_url"
  | "invalid_url"
  | "placeholder_url"
  | "unsafe_external_attachment";

export interface SourceValidityFinding {
  code: SourceValidityFindingCode;
  message: string;
}

const PLACEHOLDER_PATTERNS = [
  /(^|\.)example\.(com|org|net)$/i,
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /sam\.gov\/opp\/12345/i,
  /\/placeholder(\/|$)/i,
  /\/example(\/|$)/i,
];

function parseHttpUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function placeholderFinding(value: string, parsed: URL): SourceValidityFinding | null {
  const haystack = `${parsed.hostname}${parsed.pathname}`;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(haystack))
    ? { code: "placeholder_url", message: `${value} looks like demo, placeholder, or local-only data.` }
    : null;
}

export function validateBidSourceUrl(value: string): SourceValidityFinding[] {
  if (!value.trim()) return [{ code: "empty_url", message: "Source URL is empty." }];
  const parsed = parseHttpUrl(value);
  if (!parsed) return [{ code: "invalid_url", message: `${value} is not a valid HTTP(S) URL.` }];
  const placeholder = placeholderFinding(value, parsed);
  return placeholder ? [placeholder] : [];
}

export function validateStateAttachmentUrl(value: string): SourceValidityFinding[] {
  if (!value.trim()) return [{ code: "empty_url", message: "Attachment URL is empty." }];
  if (value.startsWith("/api/bids/") && value.includes("/attachments/")) return [];
  const parsed = parseHttpUrl(value);
  if (!parsed) return [{ code: "invalid_url", message: `${value} is not a valid attachment URL.` }];
  const placeholder = placeholderFinding(value, parsed);
  return [
    ...(placeholder ? [placeholder] : []),
    { code: "unsafe_external_attachment", message: `${value} is a raw external attachment URL; use the safe local download route.` },
  ];
}
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/source-validity/url-validity.test.ts
```

Expected: PASS.

## Task 3: Risk Checklist Enforcement

**Files:**
- Modify: `frontend/src/server/risk/checklist.ts`
- Test: `frontend/src/server/risk/checklist.test.ts`

- [ ] **Step 1: Write failing tests**

Update expected check IDs:

```ts
expect(report.checks.map((check) => check.id)).toEqual([
  "state-coverage",
  "state-content",
  "bid-detail-routes",
  "attachment-downloads",
  "account-tier-separation",
  "source-ingestion-governance",
  "source-validity-metadata",
  "state-url-validity",
]);
```

Add:

```ts
it("fails when state source or attachment URLs are placeholders", async () => {
  const db = await seededDatabase();
  db.update(bids)
    .set({ sourceUrl: "https://sam.gov/opp/12345/sow.pdf" })
    .where(eq(bids.id, "ca_caleprocure:risk-check-seed"))
    .run();

  const report = await createRiskChecklistReport(db);

  expect(report.ok).toBe(false);
  expect(report.checks.find((check) => check.id === "state-url-validity")).toMatchObject({ ok: false });
  expect(formatRiskChecklistReport(report)).toContain("placeholder_url");
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm test -- src/server/risk/checklist.test.ts
```

Expected: FAIL because the new checks are missing.

- [ ] **Step 3: Implement checks**

Import:

```ts
import { validateBidSourceUrl, validateStateAttachmentUrl } from "@/server/source-validity/url-validity";
```

Add helper:

```ts
function sourceValidityMetadataFailures() {
  return STATE_CRAWLER_SOURCES.flatMap((source) => {
    const missing = [
      source.sourceAuthority ? null : "sourceAuthority",
      source.trustStatus ? null : "trustStatus",
      source.evidenceMode ? null : "evidenceMode",
      source.validityNotes?.trim() ? null : "validityNotes",
    ].filter((value): value is string => Boolean(value));

    return missing.length === 0 ? [] : [`${source.stateCode} ${source.id} missing ${missing.join(", ")}`];
  });
}

function stateUrlValidityFailures(bids: Bid[]) {
  return bids.flatMap((bid) => [
    ...validateBidSourceUrl(bid.sourceUrl).map((finding) => `${bid.id}: sourceUrl ${finding.code} - ${finding.message}`),
    ...bid.attachments.flatMap((attachment) =>
      validateStateAttachmentUrl(attachment.url).map(
        (finding) => `${bid.id}: attachment ${attachment.name} ${finding.code} - ${finding.message}`,
      ),
    ),
  ]);
}
```

Append two `check(...)` entries after governance:

```ts
check(
  "source-validity-metadata",
  "50 state source validity metadata",
  sourceValidityFailures.length === 0,
  `${requiredStates.length} state crawler sources checked for authority, trust, evidence mode, and notes`,
  sourceValidityFailures,
),
check(
  "state-url-validity",
  "State source and attachment URLs are production-like",
  stateUrlValidityFailures.length === 0,
  `${stateBids.length} state bids checked for placeholder source URLs and unsafe attachment URLs`,
  stateUrlValidityFailures,
),
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/risk/checklist.test.ts
```

Expected: PASS.

## Task 4: Admin Data Source API Visibility

**Files:**
- Modify: `frontend/src/server/admin/data-sources-repository.ts`
- Test: `frontend/src/server/admin/data-sources-repository.test.ts`

- [ ] **Step 1: Write failing tests**

In registry/default metadata tests, add:

```ts
expect(source).toMatchObject({
  sourceAuthority: "official",
  trustStatus: "verified",
  evidenceMode: "direct_portal",
  validityNotes: expect.stringContaining("Verified"),
});
```

For fake MySQL CA source, add:

```ts
expect(result.sources.find((item) => item.id === "california_caleprocure")).toMatchObject({
  sourceAuthority: "official",
  trustStatus: "verified",
  evidenceMode: "direct_portal",
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd frontend
npm test -- src/server/admin/data-sources-repository.test.ts
```

Expected: FAIL because `AdminDataSource` does not expose validity fields.

- [ ] **Step 3: Implement API fields**

Import source validity types and extend `AdminDataSource`:

```ts
type SourceAuthority,
type SourceTrustStatus,
type SourceEvidenceMode,
```

Add fields:

```ts
sourceAuthority: SourceAuthority | null;
trustStatus: SourceTrustStatus | null;
evidenceMode: SourceEvidenceMode | null;
validityNotes: string | null;
```

In `toAdminSource`, return:

```ts
sourceAuthority: crawlerMetadata?.sourceAuthority ?? null,
trustStatus: crawlerMetadata?.trustStatus ?? null,
evidenceMode: crawlerMetadata?.evidenceMode ?? null,
validityNotes: crawlerMetadata?.validityNotes ?? null,
```

- [ ] **Step 4: Run test to verify GREEN**

Run:

```bash
cd frontend
npm test -- src/server/admin/data-sources-repository.test.ts
```

Expected: PASS.

## Task 5: Documentation And Verification

**Files:**
- Modify: `docs/product-requirements/winbids-current-gap-analysis.md`
- Modify: `docs/product-requirements/winbids-implementation-status.md`
- Modify: `docs/product-requirements/winbids-next-development-plan.md`

- [ ] **Step 1: Update docs**

Record:

- 50-state source validity metadata is implemented locally.
- `risk:check` now rejects known demo/placeholder bid and attachment URLs.
- Live government portal reachability is still an operator-run validation, not a deterministic CI gate.

- [ ] **Step 2: Focused verification**

Run:

```bash
cd frontend
npm test -- src/lib/state-crawler-sources.test.ts src/server/source-validity/url-validity.test.ts src/server/risk/checklist.test.ts src/server/admin/data-sources-repository.test.ts
```

Expected: PASS.

- [ ] **Step 3: Full verification**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
npm run risk:check
git diff --check
```

Expected: all PASS.

## Self-Review

- Spec coverage: source metadata is Task 1, URL validation is Task 2, risk enforcement is Task 3, Admin API is Task 4, docs and verification are Task 5.
- Placeholder scan: the plan uses the word placeholder only as a URL-risk category, not as missing plan content.
- Type consistency: source validity type names are introduced in Task 1 and reused by Admin API in Task 4.
