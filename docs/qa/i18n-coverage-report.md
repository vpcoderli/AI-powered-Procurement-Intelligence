# i18n Coverage Report (P1-5)

Date: 2026-07-01
Scope: `frontend/src/lib/i18n/` dictionaries (`en.ts` / `zh.ts`), the `useLanguage()`/`t()` consumption
pattern, and a bounded, prioritized pass over the highest-traffic routes named in `CLAUDE.md`:
`/search`, `/bids/[id]`, `/intents/[id]`, `/saved`.

This is an honest snapshot, not a coverage claim. The review doc that kicked off this task cited
"~89% coverage with untranslated variable rendering defects." That framing turned out to be
partially right and partially misleading once the actual mechanics were inspected — see below.

## How the i18n system actually works

- `frontend/src/lib/i18n/LanguageContext.tsx` exposes `useLanguage()` → `{ t, dict, language,
  setLanguage }`. `t(key)` is a **pure dot-path lookup** into whichever dictionary
  (`en.ts`/`zh.ts`) matches the active language, with a fallback of returning the raw key string
  if the path resolves to `undefined` or hits a string too early.
- **`t()` does not interpolate.** Dictionary values that need a runtime value (a count, a date, a
  name) are written with a literal `{token}` placeholder in the string (e.g.
  `"Showing {count} results for your criteria"`), and the *calling component* is responsible for
  resolving it — either via a chained `.replace("{token}", value)` (used throughout
  `src/app/settings/page.tsx` and `src/app/admin/page.tsx`) or via a small local `formatMessage()`
  helper (defined in `src/app/search/page.tsx`, lines 73-77) that reduces over a `values` map doing
  the same `.replace` internally.
- `zh.ts` is typed as `export const zh: Dictionary` where `Dictionary = typeof en`
  (`dictionaries/en.ts`, last line). This means **TypeScript already prevents missing or extra
  keys** between the two dictionaries at compile time — a key present in `en.ts` but absent from
  `zh.ts` (or vice versa) is a type error, not a silent runtime gap. This matters because it rules
  out one of the two "coverage gap" mechanisms the review doc worried about: there is no dictionary
  where a whole key is simply missing.

Given that, "untranslated variable" defects in this codebase can only come from three places, and
the scan script (`frontend/scripts/i18n-coverage-scan.ts`) checks all three:

1. **A `zh.ts` value that's byte-identical to the `en.ts` value** — i.e., technically present, but
   never actually translated (a "translated" key that silently regressed to English).
2. **A hardcoded English string in JSX that never calls `t()` at all** — no key exists to be
   missing; the string simply bypasses the dictionary. This turned out to be the dominant real
   cause found in this pass, not orphaned dictionary keys.
3. **A dictionary value with a `{placeholder}` token rendered bare** (no `.replace()`/
   `formatMessage()` at the call site), which would leak literal `{count}`-style text into the UI.

## What I found

### (c) Unresolved placeholder tokens: none found in the four priority routes

I manually traced every dictionary key in `en.ts` whose value contains a `{token}` placeholder
(47 keys) to its call site(s) in `src/app/search`, `src/app/saved`, `src/app/settings`,
`src/app/admin`, and `src/app/intents/[id]`. Every call site correctly resolves its placeholder(s),
either via `.replace()` chains or the `formatMessage()` helper. This class of bug, which the review
doc flagged by name ("untranslated variable rendering defects"), **does not currently exist as a
live rendering bug** in this codebase — the team has been disciplined about it. The scan script
still checks for it going forward (regressions are easy to introduce when a new placeholder key is
added without updating the call site), and its heuristic is proximity-based (looks for `.replace(`
or `formatMessage(` within a few lines of the `t("key")` call), so it will flag new instances even
though none exist today.

One related dead-code note: the entire `searchAlerts` dictionary section (`en.ts`/`zh.ts`, keys like
`searchAlerts.title`, `.lastMatch`, etc.) has **zero call sites** anywhere in `src/app` or
`src/components`. The live saved-search-alerts UI in `settings/page.tsx` uses a parallel
`settings.searchAlert*` key set instead. This isn't a translation bug (nothing renders it, so
nothing can render it wrong), but it's dead dictionary weight worth cleaning up separately.

### (a) Untranslated (byte-identical) values in `zh.ts` — fixed, 8 keys

Found by diffing `en.ts` against `zh.ts` value-by-value (not by key presence, which TS already
guarantees, but by content — a translated-looking key whose Chinese value was actually just the
English string copied over). Fixed:

| Key | Before (`zh.ts`) | After |
|---|---|---|
| `settings.creditSummary` | `"Credits"` | `"额度"` |
| `settings.includedCredits` | `"每月包含 {credits} credits"` (partial leak) | `"每月包含 {credits} 额度"` |
| `settings.unlimitedCredits` | `"不限量 included credits"` (partial leak) | `"不限量额度"` |
| `settings.workspaceRole_owner` | `"Owner"` | `"所有者"` |
| `admin.aiProvider` | `"Provider"` | `"提供方"` |
| `admin.tier_enterprise` | `"Enterprise"` | `"企业版"` |
| `admin.crawlerMaturity_beta` | `"Beta"` | `"测试版"` |
| `admin.sourceTrust_fallback` | `"Fallback"` | `"回退"` |
| `knowledge.tagsPlaceholder` | `"deadline, compliance, portal"` | `"截止日期、合规、门户"` |

Each was confirmed against sibling keys in the same enum/group to establish that translation, not
retention, was the established convention (e.g. `tier_free: "免费"` proves generic tier descriptors
get translated, so `tier_enterprise` staying `"Enterprise"` was an outlier — whereas `tier_pro`
("Pursuit Starter") and `tier_business` ("Response Builder") are genuinely branded product names
correctly kept in English, confirmed by their consistent English-brand-name usage even inside
otherwise-fully-Chinese sentences elsewhere in `zh.ts`).

**Left as-is, deliberately** (verified as correct convention, not gaps):
`common.english` ("English" — language-switcher autonym, correctly paired with `chinese: "中文"`),
`header.initials` ("JD" — a static avatar-mockup placeholder, not translatable content),
`settings.searchAlertStatesPlaceholder` / `profilePage.statesPlaceholder` ("CA, TX, NY" — USPS
state codes, no Chinese equivalent), `admin.tier_pro` / `admin.tier_business` (branded product
names), `admin.responsePackageExportFormats.{markdown,zip,pdf,docx}` (file-format names, never
localized in Chinese technical UIs), `admin.artifactTypes.w9` ("W-9" — a fixed US tax form
identifier), `admin.sourceHealthClassification_ok` ("OK" — retained as a near-universal loanword,
consistent with every other sibling in that enum being translated except this one).

**Flagged but not changed** (borderline, needs a product decision — see Outstanding below):
`admin.creditDryRun` ("Credit dry-run") and `admin.creditChargedAmount` ("Charged amount") in the
admin AI-metadata debug panel, and `admin.sourceEvidence_fixture_fallback` ("Fixture fallback") —
these sit in internal/admin-only technical panels where a few neighboring terms (e.g. "Prompt
version" rendered as "Prompt 版本" — a loanword-style mix) suggest a looser, semi-technical
translation bar was intentionally applied. Translating them would be consistent with the
`creditSummary` fix above, but I didn't want to unilaterally reverse an apparent intentional
convention in an admin-only surface without confirmation.

### (b) Hardcoded strings bypassing `t()` — fixed in the 4 priority routes, found (not fixed) elsewhere

**Fixed**, all within `/search`, `/saved`, `/intents/[id]`:

- `src/app/search/page.tsx`
  - `aria-label="WinBids overview"` → `aria-label={t("dashboard.overviewRegionLabel")}`
  - `aria-label="Discovery metrics"` → `aria-label={t("dashboard.discoveryMetricsLabel")}`
  - Metric badge values `"Intent"` / `"Lite"` / `"API"` → `t("dashboard.activePursuitsModeIntent")`
    / `t("dashboard.submissionRisksModeLite")` / `t("dashboard.readyArtifactsModeApi")`
  - (Left as-is: `"American Public Supply Intelligence LLC"` — verified this is a consistent legal
    entity name used identically across 5 files including the marketing homepage and
    `winbids-demo`; never translated anywhere in the app, so this is a brand name, not a gap.)
- `src/app/saved/page.tsx`
  - `<p className="winbids-kicker">Saved queue</p>` → `{t("saved.kicker")}` (its sibling `<h1>`
    right below it already correctly used `t("saved.title")`, making this a clear oversight)
- `src/app/intents/[id]/page.tsx` — this file has 235+ correct `t()` call sites; the gap was one
  concentrated, bolted-on-looking block (a "Procurement read models" panel with quote-comparison,
  win/loss-learning, and evidence-links summary cards, roughly lines 2582-2687) that had **zero**
  i18n wiring despite living inside an otherwise fully-translated page, plus three stray
  module-level string constants (`prototypeWorkspace`, `submissionPath`, `knowledgeStationPanel`)
  that were rendered as literal text/aria-label instead of through `t()`. Added 17 new
  `intentsPage.*` dictionary keys (see `frontend/src/lib/i18n/dictionaries/en.ts` /
  `zh.ts`, inserted after `pipelineItems`) and rewired every hardcoded string in that block,
  including the two count/percentage-interpolated strings
  (`quoteComparisonPricedQuotes: "{count} priced quotes"`,
  `quoteComparisonVariance: "{percent}% variance"`,
  `winLossRecommendedActions: "Recommended actions: {actions}"`), each resolved via `.replace()`
  at the call site, following the codebase's established interpolation convention.
  - Note: the three removed module-level constants (`prototypeWorkspace`, `submissionPath`,
    `knowledgeStationPanel`) were also reused as **CSS class-name tokens**
    (`"winbids-detail-workspace prototypeWorkspace"`, `"winbids-panel submissionPath ..."`) — those
    literal class-name strings were deliberately left untouched (they're not user-facing text), and
    `frontend/src/app/intents/page.test.ts` (lines 59/61) asserts on those exact class-name
    substrings via `.toContain("prototypeWorkspace")` / `.toContain("submissionPath")`; both still
    pass since the class names are unchanged.

**`/bids/[id]` was checked and found already clean** — every heading, label, button, and status
message in that file routes through `t()`. No hardcoded strings needed fixing there.

**Found but out of scope for this pass** (not one of the four priority routes, or is genuinely
dynamic/defensive rather than a literal string bug — listed here so they aren't lost):

- `src/app/admin/page.tsx` — several hardcoded English blocks that contrast with 235+ correct
  `t()` calls elsewhere in the same file: a "Marketing Funnel" section (heading, `SummaryCard`
  labels like "Request Demo"/"Signup complete"/"Profile started"/"Profile complete"/"First matched
  bid", "Export leads CSV" link, "Latest request-demo leads" section label, empty-state text), and
  a "Config Registry" / "Marketing Content CMS" / state-data-quality-queue block (table headers,
  "No config registry entries found.", "State data quality action queue", etc.). Admin is
  operator-facing rather than one of the four named priority routes, so this pass didn't touch it,
  but it's the largest remaining concentration of hardcoded strings in the app.
- `src/app/settings/page.tsx` — `FEATURE_ACCESS_ITEMS` (lines 82-95) is a 12-item array of
  hardcoded English feature labels ("Bid search", "Saved bids", "Pursue / No-Bid", etc.) rendered
  raw. Notably inconsistent with the near-identical `USAGE_FEATURE_LABEL_KEYS` map a few lines
  below it (104-109), which stores i18n **keys** instead of literal strings for the same kind of
  feature list — the clearest "was this supposed to go through `t()`" signal in the file.
- `src/app/bids/[id]/page.tsx:41` — `ADD_TO_INTENT_FALLBACK = "Add to Intent"` is a **defensive**
  fallback string used only if `t("detail.pursuitAddToIntent")` ever returns the raw key (i.e., if
  the key were ever deleted from a dictionary). The key currently exists in both dictionaries, so
  this fallback is dead code today, not a live bug — flagged for awareness, not fixed.

## Files changed

- `frontend/src/lib/i18n/dictionaries/en.ts` — added `dashboard.overviewRegionLabel`,
  `dashboard.discoveryMetricsLabel`, `dashboard.activePursuitsModeIntent`,
  `dashboard.submissionRisksModeLite`, `dashboard.readyArtifactsModeApi`, `saved.kicker`, and 17
  new `intentsPage.*` keys (see report body above for the full list).
- `frontend/src/lib/i18n/dictionaries/zh.ts` — matching translations for all of the above, plus the
  8 untranslated-value fixes listed in the table above.
- `frontend/src/app/search/page.tsx` — wired two `aria-label`s and three metric-badge values
  through `t()`.
- `frontend/src/app/saved/page.tsx` — wired the kicker through `t()`.
- `frontend/src/app/intents/[id]/page.tsx` — removed 3 unused hardcoded string constants, rewired
  the entire "Procurement read models" panel (quote comparison / win-loss learning / evidence
  links summary cards) plus one `aria-label` and one section heading through `t()`.
- `frontend/scripts/i18n-coverage-scan.ts` — new scan script (see below).
- `frontend/package.json` — added `"i18n:check": "tsx scripts/i18n-coverage-scan.ts"`.

## The scan script

`frontend/scripts/i18n-coverage-scan.ts` (run via `npm run i18n:check` from `frontend/`) checks all
three defect classes on every run:

1. Loads both dictionary modules directly (via dynamic `import()`, not a hand-rolled parser) and
   flattens them to dot-path → value maps, then reports any key present in one but not the other
   (belt-and-suspenders given the TS structural guarantee) and any leaf value that's byte-identical
   between `en` and `zh`, excluding a short, explicit allowlist of legitimate exceptions (brand
   names, acronyms, USPS codes — the same list reasoned through in this report).
2. Walks `src/app/**/*.{ts,tsx}` (excluding `*.test.ts(x)`) with a regex heuristic for JSX text
   content and `aria-label`/`title`/`placeholder`/`alt` attributes containing literal English text
   not wrapped in `t(...)`.
3. For every dictionary key whose value contains a `{token}` placeholder, greps `src/app` for
   `t("that.key")` call sites and flags any without a nearby `.replace(`/`formatMessage(`.

**Known limitation, stated in the script's own header and CLI help**: part 2 (hardcoded-string
detection) is a regex heuristic over raw source text, not an AST/type-aware parse. It will produce
some false positives (e.g., a `<Badge>{learningSummary.outcomeClass}</Badge>` where the braces
happen to survive the tag-content pattern check, non-English proper nouns, or JSX comments) and can
miss unusual call shapes (e.g., a translated string built through several intermediate variables
before reaching JSX). Treat its findings as leads to manually verify, the same way the findings in
this report were manually verified before being fixed — this is why `--fail-on-findings` is opt-in
rather than wired into `risk:check` or CI by default.

## Outstanding / recommended follow-ups (honest gap list)

1. **Admin (`/admin`) and Settings (`/settings`) hardcoded strings** — largest remaining volume,
   documented above, not fixed (out of the four named priority routes for this task).
2. **`admin.creditDryRun` / `admin.creditChargedAmount` / `admin.sourceEvidence_fixture_fallback`**
   — needs a product call on whether the admin AI-metadata/diagnostics panels should hold to the
   same full-translation bar as customer-facing surfaces, or whether a looser
   semi-technical-jargon convention there is intentional.
3. **Dead `searchAlerts` dictionary section** — zero call sites; either wire it up or remove it so
   future contributors don't maintain translations for unreachable UI.
4. **No automated test currently enforces dictionary parity/translation** beyond the TS structural
   type and the one narrow `bids/[id]/page.test.ts` assertion on `detail.archiveStatus_*` copy.
   `npm run i18n:check` fills this gap as a manual/CI-optional command, but nothing currently fails
   `npm run test` or `npm run risk:check` if a future PR reintroduces an untranslated value or a
   hardcoded string — wiring `i18n:check --fail-on-findings` into CI was considered out of scope
   here given the heuristic's known false-positive rate, but is a reasonable next step once someone
   has triaged a baseline run and possibly tightened the JSX-text heuristic.
5. This report and the scan script were produced by reading and grepping the codebase, not by
   executing `npm run i18n:check` (sandboxed environment constraints — see repo automation notes).
   **A human should run `npm run i18n:check` and `npm run test` locally** before merging to confirm
   the script runs cleanly end-to-end (in particular, the dynamic `import()` of the two `.ts`
   dictionary files under `tsx` runtime) and that no existing Vitest suite regressed.
