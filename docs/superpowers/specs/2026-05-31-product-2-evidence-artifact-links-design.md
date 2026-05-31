# Product 2 Evidence Artifact Links v1 Design

## Goal

Make Product 2 recommendations easier to trust by linking pursue/no-bid reason details to the existing qualification citations, bid source records, attachment download routes, and archived evidence metadata.

## Selected Approach

Use a lightweight evidence reference layer on top of current data instead of creating a new artifact database model in this slice.

The current system already has:

- `PursuitReasonDetail` for structured pursue/no-bid explanations.
- `QualificationCitation` for source-grounded bid fields, attachments, detail archives, and generated output.
- Bid attachment download routes that avoid direct broken external URLs.
- Bid detail archive status and attachment archive metadata.

This phase connects those pieces so a user can move from a recommendation reason to supporting evidence without hunting through separate panels.

## Scope

### In Scope

- Add `evidenceRefs` to each `PursuitReasonDetail`.
- Keep existing `evidenceLabel` for backwards-compatible display.
- Generate evidence refs deterministically from existing intent, bid, match, generated brief, and attachment data.
- Link reason refs to existing qualification citation IDs where possible.
- Show evidence chips or links inside each reason card in the Intent detail page.
- Preserve all current gated behavior for Pursue / No-Bid and Qualification Q&A.
- Add tests for generator output, API/client type compatibility, and Intent page rendering.

### Out of Scope

- New artifact tables.
- Full document parsing, OCR, or LLM extraction.
- Legal interpretation of solicitation documents.
- Admin artifact management UI.
- Replacing the existing citation model.

## Data Shape

Add a small reference type:

```ts
export type PursuitEvidenceRefKind =
  | "citation"
  | "bid_detail"
  | "attachment"
  | "source_url"
  | "supplier_profile"
  | "match_snapshot"
  | "generated_output";

export interface PursuitEvidenceRef {
  kind: PursuitEvidenceRefKind;
  label: string;
  citationId?: string;
  url?: string;
}
```

Extend reason details:

```ts
export interface PursuitReasonDetail {
  category: PursuitReasonCategory;
  severity: PursuitReasonSeverity;
  summary: string;
  explanation: string;
  evidenceLabel: string;
  suggestedAction: string;
  evidenceRefs: PursuitEvidenceRef[];
}
```

Existing API consumers that only read current fields continue to work because this is additive.

## Evidence Mapping Rules

Reason details should attach references by category and evidence label:

- `fit`, `geography`, and `pricing`: `match_snapshot`.
- `deadline`: `citation_deadline` plus bid detail/source URL.
- `profile`: `supplier_profile`.
- `risk`: generated risk flags and generated brief citations.
- `documentation`: available attachment citations and the bid detail/source URL.
- `registration`: submission/source URL and generated checklist evidence.

When a specific citation ID is stable, include it in `citationId`. When only a navigation target exists, include `url`.

## UI Behavior

In the Intent detail Pursuit Decision panel:

- Each structured reason card keeps the current category/severity/summary/explanation/action layout.
- The evidence block changes from a plain text label to a compact list of clickable evidence chips.
- If an evidence ref has a safe URL, open it in a new tab.
- If an evidence ref only has a citation ID, render a non-link chip using the citation label.
- If no refs are available, fall back to the current `evidenceLabel` text.

The existing Evidence Citations panel remains unchanged except for any additive metadata needed by the reason cards.

## Error Handling

- Malformed or missing evidence refs should not break recommendation rendering.
- Unsafe URLs are filtered through the existing `safeEvidenceUrl` helper before rendering.
- If citations have not loaded yet, reason cards still render with labels and any URL-only refs.

## Testing

- Unit test that generated recommendations include `evidenceRefs` for fit, deadline, documentation, and registration cases.
- Unit test that evidence refs preserve the old `evidenceLabel` behavior.
- API/client test that pursuit decision board responses accept reason details with evidence refs.
- Intent page static test that reason cards render evidence refs and safe evidence links.
- Existing regression: `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, `npm run risk:check`, `git diff --check`.

## Handoff

After implementation, update `docs/product-requirements/winbids-implementation-status.md` so the next phase list reflects that richer Product 2 evidence links are complete locally.
