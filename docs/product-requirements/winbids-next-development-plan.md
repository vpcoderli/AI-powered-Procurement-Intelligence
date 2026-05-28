# WinBids Next Development Plan

Updated: 2026-05-28

## Recommendation

Continue with **Submission Guidance Lite** as the next implementation phase.

The local system already supports bid search, match scoring, supplier profile, and Intent to Bid. The next user question is: "How do I submit this bid correctly outside WinBids?" Submission Guidance Lite answers that question without trying to build direct submission or portal automation.

## Phase Goal

Add a lightweight submission guidance layer to each Intent workspace:

`Intent -> Submission path -> Complexity score -> Readiness checklist -> External guidance -> Confirmation record`

## User Story

As a supplier reviewing an Intent to Bid, I want WinBids to explain where and how the bid must be submitted so that I can avoid missing portal, registration, document, addenda, or deadline requirements.

## In Scope

- Submission path data model.
- Submission guidance generator.
- Submission complexity score.
- Submission readiness checklist.
- Submission confirmation record.
- Intent detail UI section.
- API client and route tests.
- Bilingual labels.
- Operation guide update.

## Out of Scope

- Direct bid submission.
- Portal login automation.
- Browser automation for third-party portals.
- Full compliance matrix.
- Calendar integration.
- Email integration.
- Team assignments.
- Quote management.

## Proposed Data Model

### `submission_paths`

Fields:

- `id`
- `intent_id`
- `bid_id`
- `user_id`
- `method`
- `portal_url`
- `contact_email`
- `requires_registration`
- `requires_physical_delivery`
- `requires_addenda_acknowledgement`
- `complexity_score`
- `guidance_text`
- `readiness_checklist_json`
- `risk_flags_json`
- `created_at`
- `updated_at`

### `submission_confirmations`

Fields:

- `id`
- `intent_id`
- `user_id`
- `submitted_at`
- `method`
- `confirmation_reference`
- `confirmation_notes`
- `created_at`
- `updated_at`

## API Design

### `GET /api/intents/:id/submission`

Returns existing submission path or generates one from the bid and intent context.

### `PATCH /api/intents/:id/submission`

Allows the user to update manually known fields such as method, portal URL, and registration flags.

### `POST /api/intents/:id/submission/confirm`

Stores a manual external submission confirmation.

## Deterministic Guidance Rules

For this phase, generate submission guidance without a real LLM.

Inputs:

- Bid source.
- Source URL.
- Issuer type.
- Contact email.
- Contact phone.
- Deadline date.
- Attachments.
- Full description text.

Rules:

- If source is SAM.gov or source URL includes a known portal, mark portal submission likely.
- If contact email exists, show it as a fallback contact, not as guaranteed submission method.
- If attachments exist, add a checklist item to review every attachment before submission.
- If deadline is within 7 days, flag short response window.
- If description mentions addenda, flag addenda acknowledgement.
- If description mentions sealed bid, physical delivery, mail, or hard copy, flag physical delivery risk.
- If source URL is missing, mark high complexity.

## UI Design

Add a `Submission Guidance` section to `/intents/[id]`.

Show:

- Complexity score.
- Submission method.
- Portal/source link.
- Readiness checklist.
- Risk flags.
- Confirmation form.

Confirmation form:

- Method.
- Submitted at date/time.
- Confirmation reference.
- Notes.
- Save confirmation button.

## Tests

Add focused tests for:

- Migration creates new tables.
- Generator handles portal/source/contact/attachment/deadline cases.
- API creates or reads submission guidance idempotently.
- API validates confirmation payload.
- Client wrapper handles non-JSON errors.
- Intent detail page includes submission guidance wiring.

## Acceptance Criteria

- User can open an intent and see submission guidance.
- User can see a complexity score and risk flags.
- User can review a readiness checklist.
- User can save a manual external submission confirmation.
- The same intent does not create duplicate submission path records.
- Existing Phase 1A tests still pass.
- `npm test`, `npm run lint`, and `npm run build` pass.
- Browser smoke covers `/intents/[id]` submission section.

## Suggested Task Breakdown

1. Schema and migration for submission path and confirmation.
2. Submission guidance generator service.
3. Submission API routes and client wrapper.
4. Intent detail UI integration.
5. Operation guide update.
6. Full verification and browser smoke.

## Remaining Work After This Phase

After Submission Guidance Lite, remaining major MVP functions are:

1. Compliance Manifest Lite.
2. Pursue/No-Bid Decision Lite.
3. Sourcing Partner and Quote Inquiry Lite.
4. Award/Tabulation Tracking Lite.
5. Win/Loss Analysis Lite.
6. Knowledge Station Lite.
