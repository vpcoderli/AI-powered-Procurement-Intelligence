# Product 2 Compliance Evidence Mapping v1 Design

## Goal

Make Compliance Manifest items traceable by linking each generated compliance requirement to existing evidence references such as attachments, source URLs, bid detail pages, generated checklist/risk output, match snapshot, and supplier profile.

## Selected Approach

Use an additive evidence reference field on current compliance item shapes. This reuses the lightweight evidence-reference model introduced for pursue/no-bid recommendation reasons and avoids a new compliance evidence table in this slice.

The current system already has:

- `ComplianceManifestItem` records with status, evidence status, notes, and categories.
- `PursuitEvidenceRef` for evidence chips in Intent decision reasons.
- `QualificationCitation` snapshots for bid fields, attachments, detail archives, and generated output.
- Safe internal attachment download routes.

This phase connects compliance items to those existing evidence surfaces while keeping manual compliance status editing unchanged.

## Scope

### In Scope

- Add `evidenceRefs` to generated and hydrated compliance manifest items.
- Generate evidence refs deterministically by compliance category.
- Store generated refs in existing row data without a schema migration by deriving refs at read/generate time.
- Render linked evidence chips under each compliance item in Intent detail.
- Keep existing `status`, `evidenceStatus`, and `notes` update behavior unchanged.
- Add tests for compliance generation/service, API compatibility, and Intent page rendering.
- Update product status docs after implementation.

### Out of Scope

- New database tables or migrations.
- User-editable evidence mappings.
- Compliance evidence history/versioning.
- Full document parsing, OCR, or LLM extraction.
- Legal interpretation or guarantee language.

## Data Shape

Reuse the existing `PursuitEvidenceRef` type for this phase:

```ts
import type { PursuitEvidenceRef } from "@/server/pursuit/types";

export interface GeneratedComplianceItem {
  title: string;
  category: ComplianceCategory;
  evidenceStatus: ComplianceEvidenceStatus;
  evidenceRefs: PursuitEvidenceRef[];
}

export interface ComplianceManifestItem extends GeneratedComplianceItem {
  id: string;
  intentId: string;
  bidId: string;
  userId: string;
  status: ComplianceItemStatus;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

Because existing database rows do not store evidence refs, `hydrateItem` should accept the current intent and derive refs for existing rows by category and title. Newly generated items also include refs before persistence, but persistence still writes only the existing row fields.

## Evidence Mapping Rules

Map by category and item content:

- `eligibility`: supplier profile, original source, generated checklist.
- `documents`: attachment download routes, bid detail, original source.
- `pricing`: match snapshot, original source, bid detail.
- `submission`: deadline citation, original source, generated checklist.
- `risk`: generated risk output, match snapshot, bid detail.

If an item title mentions attachment, form, certification, addenda, or solicitation, include attachment refs when available. If an item title mentions deadline, portal, receipt, or submission, include source/deadline refs.

Refs should be capped to a small number per item so the UI stays readable.

## UI Behavior

In the Intent detail Compliance Manifest section:

- Each compliance item keeps the current category, title, status select, evidence status select, and notes.
- Under the item title or notes, render a compact “Linked evidence” row.
- Links use the existing safe URL filtering pattern.
- URL refs render as clickable chips.
- Citation-only refs render as non-link chips.
- Items with no refs render no evidence row.

The evidence refs are informational in v1. Users still manually update `evidenceStatus` to `attached`, `needed`, or `not_required`.

## Error Handling

- Missing or malformed refs should not block manifest rendering.
- Unsafe URLs should be hidden by `safeEvidenceUrl`.
- Existing compliance rows created before this feature should hydrate with derived refs.
- If the underlying bid is suppressed or missing, existing intent compliance APIs should keep returning the same not-found behavior already used by the intent service.

## Testing

- Compliance service test confirms generated items include evidence refs.
- Existing-row compatibility test confirms hydrated old rows still receive derived refs.
- API client test accepts compliance items with `evidenceRefs`.
- Intent page static test confirms compliance evidence chips are rendered.
- Existing regression: `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, `npm run risk:check`, `git diff --check`.

## Handoff

After implementation, update `docs/product-requirements/winbids-implementation-status.md` so Product 2 Compliance Evidence Mapping v1 is listed as complete and the recommended next phase moves to Knowledge Station Lite or Admin risk-check visualization.
