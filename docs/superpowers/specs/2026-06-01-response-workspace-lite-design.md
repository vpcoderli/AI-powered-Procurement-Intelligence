# Response Workspace Lite Design

## Goal

Add a thin response workspace to each Intent so Response Builder and Enterprise users can track response tasks, internal checkpoints, artifact placeholders, and a response package outline from the existing pursuit workspace.

## Scope

- Add durable `response_workspace_items` rows tied to an intent, bid, and user.
- Auto-seed a deterministic starter workspace the first time an entitled user opens the panel.
- Add `GET/PATCH /api/intents/[id]/response-workspace`.
- Gate the API with the existing `response.workspace.create` feature key.
- Add typed frontend API helpers.
- Render the workspace inside `frontend/src/app/intents/[id]/page.tsx`.
- Let users update item status and notes.

## Non-Goals

- No binary file upload in this slice; that remains Artifact Vault Lite.
- No collaborative assignment, comments, due-date automation, or history table yet.
- No LLM drafting in this slice; `response.section.draft` stays future.

## Data Model

Use a single table because the Lite slice needs a small, flexible checklist rather than several deep workflow models:

- `kind`: `task`, `checkpoint`, `artifact`, `outline_section`
- `status`: `todo`, `in_progress`, `done`, `blocked`
- `title`, `notes`, `due_at`, `sort_order`
- `intent_id`, `bid_id`, `user_id`

This lets the UI group the same row shape into tasks, checkpoints, artifacts, and outline sections.

## API Behavior

`GET /api/intents/[id]/response-workspace`:

- Resolves the current principal.
- Requires `response.workspace.create`.
- Finds the intent using existing workspace-aware intent lookup.
- Seeds default rows if none exist for the current user/intent.
- Returns `{ workspace: { intentId, bidId, summary, items } }`.

`PATCH /api/intents/[id]/response-workspace`:

- Requires `itemId`.
- Accepts `status`, `notes`, `title`, and `dueAt`.
- Validates enum values and trims text.
- Returns the refreshed workspace.

## Default Workspace

The generated default rows are intentionally practical:

- Tasks: review solicitation, build response calendar, draft response sections, collect pricing/partner inputs, final package review.
- Checkpoints: bid/no-bid decision confirmed, portal registration complete, addenda acknowledged, internal review complete.
- Artifacts: solicitation files, compliance evidence, pricing workbook, submitted package receipt.
- Outline sections: cover letter, technical approach, management plan, past performance, pricing/attachments.

## Testing

- Schema/migration test verifies the new table and indexes.
- Service tests verify seeding, grouping summary, updating status/notes, invalid status rejection, and feature-independent intent not-found behavior.
- Route tests verify feature gating, GET, PATCH, invalid payloads, and intent not-found.
- Client tests verify endpoint paths and request payloads.
- Page static test verifies the new panel, feature gate, and API calls are present.
- Regression commands: focused tests, `npm test`, `npm run lint`, `npm run build`, `npm run risk:check`, `git diff --check`.
