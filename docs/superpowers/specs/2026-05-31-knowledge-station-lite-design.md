# Knowledge Station Lite Design

## Goal

Build the first usable slice of Product 0.9 Knowledge Station as an embedded workflow coaching and reusable knowledge capture layer inside the existing Intent workspace.

This phase should help a supplier understand what to do next on a bid, save reusable notes or snippets, and link those notes back to the bid/intent context. It is not a full enterprise knowledge-management product.

## Selected Approach

Use the Intent workspace as the primary surface and add a lightweight persistent knowledge model.

The current system already has:

- Intent workspaces with bid brief, match snapshot, submission guidance, compliance manifest, pursue/no-bid recommendations, and evidence references.
- Organization-aware session entitlements.
- A `knowledge_station` feature key currently mapped to Enterprise.
- Existing locked states and billing/account tier separation.

Knowledge Station Lite should reuse these foundations instead of introducing a separate product surface first. A standalone `/knowledge` library can follow after users can create useful knowledge from real bid workflow moments.

## Scope

### In Scope

- Add a `knowledge_items` persistence model scoped to the user's organization and creator.
- Add server repository/service helpers for creating and listing knowledge items.
- Add protected APIs for listing and creating knowledge items.
- Gate APIs and UI with the existing `knowledge_station` feature key.
- Add an Intent detail Knowledge Station panel with:
  - deterministic workflow coach cards,
  - manual reusable knowledge item creation,
  - recent knowledge items linked to the current intent or bid,
  - locked state for users without the required tier.
- Add sidebar navigation to a lightweight Knowledge Station library if the user has access.
- Add a minimal `/knowledge` page for browsing recent knowledge items by type/tag/search text.
- Add tests for schema migration, service behavior, API gating, API validation, and UI rendering.
- Update implementation status after the phase is complete.

### Out of Scope

- LLM retrieval, embeddings, vector search, or semantic ranking.
- File uploads or artifact vault integration.
- Knowledge approval workflow, version history, or admin publishing.
- Enterprise-wide course/content management.
- Automatic extraction from PDFs beyond existing deterministic bid/intent fields.
- Credit charging for knowledge actions.

## Entitlement Behavior

`knowledge_station` remains an Enterprise feature for this slice.

- Enterprise users and full admins with access can use the panel and APIs.
- Business/Pro/Free users see a locked state that explains the feature is available on Enterprise.
- Server routes must call `requireFeature(principal, "knowledge_station")`.
- Existing organization feature overrides can force-enable or force-disable the feature without new permission logic.
- The feature-gate coverage manifest must move `knowledge_station` from explicitly unimplemented to implemented protected routes.

## Data Model

Add `knowledge_items`:

```txt
id TEXT PRIMARY KEY
organization_id TEXT NOT NULL REFERENCES organizations(id)
created_by_user_id TEXT NOT NULL REFERENCES users(id)
title TEXT NOT NULL
body TEXT NOT NULL
type TEXT NOT NULL
tags_json TEXT NOT NULL DEFAULT '[]'
source_kind TEXT NOT NULL
source_intent_id TEXT REFERENCES intent_to_bid(id)
source_bid_id TEXT REFERENCES bids(id)
source_url TEXT
metadata_json TEXT NOT NULL DEFAULT '{}'
created_at TEXT NOT NULL
updated_at TEXT NOT NULL
```

Supported `type` values:

- `workflow_note`
- `template_snippet`
- `requirement`
- `lesson`

Supported `source_kind` values:

- `manual`
- `intent`
- `bid`
- `generated_coach`

Indexes:

- `idx_knowledge_items_organization_id`
- `idx_knowledge_items_created_by_user_id`
- `idx_knowledge_items_source_intent_id`
- `idx_knowledge_items_source_bid_id`
- `idx_knowledge_items_created_at`

The service should normalize invalid tags to an empty list, trim text fields, and reject empty title/body.

## APIs

### `GET /api/knowledge`

Returns recent organization-scoped knowledge items.

Query parameters:

- `intentId`: optional, filters to items linked to an intent.
- `bidId`: optional, filters to items linked to a bid.
- `q`: optional case-insensitive title/body/tag search.
- `type`: optional type filter.
- `limit`: optional, default 25, maximum 100.

### `POST /api/knowledge`

Creates a knowledge item.

Body:

```json
{
  "title": "Past performance wording",
  "body": "Use this structure when the solicitation asks for similar contract evidence.",
  "type": "template_snippet",
  "tags": ["past performance", "proposal"],
  "sourceKind": "intent",
  "sourceIntentId": "intent_123",
  "sourceBidId": "bid_123"
}
```

Validation:

- `title` and `body` are required and length-limited.
- `type` and `sourceKind` must be supported values.
- `sourceIntentId` and `sourceBidId` are optional, but if supplied they must be strings.
- The created item is always scoped to the current principal's organization.

## Workflow Coach

The coach is deterministic in this phase and should be derived from the existing Intent detail.

Coach card inputs:

- match score and match reasons,
- deadline date,
- generated checklist,
- risk flags,
- compliance manifest state,
- submission guidance state,
- pursue/no-bid recommendation details and evidence refs,
- attachment availability.

Initial coach card categories:

- `deadline`: highlight next deadline or missing deadline risk.
- `readiness`: call out missing supplier profile or portal readiness signals.
- `compliance`: summarize open compliance items or missing evidence.
- `documents`: point users to attachments/source URLs when available.
- `decision`: summarize pursue/no-bid signals and suggested next action.

Each coach card contains:

- title,
- short guidance,
- severity (`info`, `warning`, `critical`),
- suggested action,
- optional source label and href.

Coach cards are not saved automatically. Users can save a card into `knowledge_items` as a reusable note or template snippet.

## UI Behavior

### Intent Detail Panel

Add a Knowledge Station section near the existing qualification/compliance/decision workflow.

Enterprise state:

- Shows workflow coach cards.
- Shows a compact create form with title, type, tags, and body.
- Pre-fills a new note from a selected coach card when the user chooses save.
- Shows recent knowledge items linked to the current intent/bid.
- Links knowledge items back to the bid detail, original source, or intent when available.

Locked state:

- Shows a concise Enterprise-required message using the existing plan label helpers.
- Does not show create controls.
- Does not call protected create/list APIs after feature access is known to be missing.

### Knowledge Library Page

Add `/knowledge` as a minimal library page:

- Shows recent organization knowledge items.
- Supports simple search, type filter, and tag display.
- Links back to source intent or bid when available.
- Shows the same locked state for non-Enterprise users.

The sidebar should show Knowledge Station for users with `knowledge_station` in their session features. If access is not available, the Intent panel locked state remains discoverable.

## Error Handling

- API returns `401` for unauthenticated users through the existing principal flow.
- API returns feature-gate error payloads for users without `knowledge_station`.
- Invalid request bodies return `400` with `INVALID_REQUEST`.
- Missing linked intents or bids should not block creation if the user supplies only text; invalid source IDs should be ignored unless the API explicitly validates ownership in a later phase.
- Malformed `tags_json` or `metadata_json` in older rows hydrates to empty tags and metadata.
- UI should keep existing Intent content usable if Knowledge APIs fail.

## Testing

- Migration test confirms `knowledge_items` exists with expected indexes.
- Repository/service tests cover create, list, organization scoping, query filtering, type filtering, trimming, and invalid input.
- API route tests cover unauthenticated access, feature-gated access, create/list happy paths, and validation failures.
- Feature-gate coverage test updates `knowledge_station` from unimplemented to implemented protected routes.
- Intent page static test confirms coach/knowledge UI and locked copy render.
- Knowledge page static test confirms the library surface renders.
- Existing regression: `npm test`, `npm run lint`, `npm run build`, `npm run db:migrate`, `npm run risk:check`, `git diff --check`.

## Handoff

After implementation:

- Update `docs/product-requirements/winbids-implementation-status.md` to mark Knowledge Station Lite complete.
- Add Knowledge Station to advanced usage metrics as a future follow-up if usage counting is not added in this slice.
- Recommended next phase becomes Admin risk-check visualization or Response Workspace Lite, depending on whether the priority is operational safety or response preparation workflow.
