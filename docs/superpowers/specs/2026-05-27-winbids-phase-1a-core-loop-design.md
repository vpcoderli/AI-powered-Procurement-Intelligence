# WinBids Phase 1A Core Loop Design

## Goal

Build the smallest useful WinBids pursuit loop on top of the current APSi system:

Matched bid discovery -> supplier profile context -> match score explanation -> Intent to Bid -> bid brief and initial checklist.

This phase turns the existing search/save experience into the first real bid pursuit workflow without attempting the full WinBids MVP at once.

## Source Documents

This design follows the three Google Docs reviewed on 2026-05-27:

- `1 WinBids Product Vision`
- `2 MVP Cutline 5 Phases`
- `3 WinBids CTO Build Pack`

The relevant cutline is Phase 1: Core Bid Discovery and Intent Workflow.

## Scope

### In Scope

- Supplier profile v1.
- Match score v1 with user-facing explanation.
- Intent to Bid creation and listing.
- Intent workspace v1.
- Rule-generated bid brief v1.
- Rule-generated initial checklist v1.
- Risk flags and next actions derived from stored bid fields.
- Bid detail UI changes for match score, intent action, brief, and checklist.
- API and repository tests for new behavior.

### Out of Scope

- Real LLM integration.
- Full submission management.
- External bid submission inside WinBids.
- Quote management.
- Sourcing partner CRUD.
- Award, tabulation, and win/loss learning.
- Billing, team accounts, CRM/ERP, email/calendar integrations.

## Product Behavior

### Supplier Profile V1

Users can create and update a lightweight supplier profile with:

- Company name.
- Business types.
- Product/service categories.
- Keywords.
- Certifications.
- Service states.
- Minimum and maximum preferred contract value.
- Risk preferences.

The profile should support progressive completion. Missing fields should not block search, saved bids, or intent creation.

### Match Score V1

The system computes a deterministic score from `0` to `100` for a bid and the current user's profile.

Score components:

- State/geography fit.
- Keyword/title/description/category fit.
- Category fit.
- Certification/set-aside text fit when discoverable from bid text.
- Contract value fit when amount ranges are available.
- Deadline feasibility.

The API returns:

- Total score.
- Component scores.
- Plain-English explanation.
- Risk notes.
- Missing-profile hints.

If no supplier profile exists, the system returns a low-confidence baseline score and prompts the user to complete the profile.

### Intent to Bid V1

Users can add a bid to Intent to Bid from:

- Bid detail page.

Search cards are out of scope for Phase 1A and should not receive the intent action in this delivery.

An intent record contains:

- User id.
- Bid id.
- Status.
- AI brief text.
- Key dates JSON.
- Initial checklist JSON.
- Risk flags JSON.
- Creation/update timestamps.

Initial statuses:

- `intent_added`
- `needs_review`
- `questions_needed`
- `sourcing_needed`
- `pursuit_decision_needed`

Creating intent is idempotent per user and bid.

### Bid Brief and Checklist V1

Phase 1A uses deterministic local generation, not a real LLM.

The generated brief should include:

- Opportunity summary.
- Agency/source.
- Deadline.
- Estimated value if available.
- Submission/source link reminder.
- Fit summary from match score.

The generated checklist should include:

- Read full solicitation and attachments.
- Confirm eligibility and certifications.
- Confirm deadline/timezone.
- Check pre-bid or question deadlines when available.
- Review required documents.
- Review pricing and delivery constraints.
- Confirm external portal or submission path.

Risk flags should include:

- Deadline soon.
- Missing attachments.
- Unknown or missing amount.
- Missing contact info.
- State or category mismatch with profile.
- Source reliability concerns if source status is stale or failing.

## API Design

### Supplier Profile

- `GET /api/company/profile`
- `PUT /api/company/profile`

`GET` returns the current user's profile or an empty profile shape.

`PUT` validates simple JSON arrays and numeric ranges, then upserts the profile for the current user.

### Match Score

- `GET /api/bids/:id/match`

Returns match score for the current user's profile and the selected bid.

### Intent

- `POST /api/bids/:id/intent`
- `GET /api/intents`
- `GET /api/intents/:id`
- `PATCH /api/intents/:id/status`

`POST` creates or returns the existing intent. It also generates the initial brief, checklist, risk flags, and key dates.

## Data Model

### `supplier_profiles`

- `user_id` primary key.
- `company_name`.
- `business_types` JSON text.
- `categories` JSON text.
- `keywords` JSON text.
- `certifications` JSON text.
- `service_states` JSON text.
- `min_contract_value`.
- `max_contract_value`.
- `risk_preferences` JSON text.
- `created_at`.
- `updated_at`.

### `intent_to_bid`

- `id` primary key.
- `user_id`.
- `bid_id`.
- `status`.
- `ai_bid_brief`.
- `key_dates_json`.
- `initial_checklist_json`.
- `risk_flags_json`.
- `match_score_snapshot_json`.
- `created_at`.
- `updated_at`.

Unique index:

- `(user_id, bid_id)`

## UI Design

### Profile Page

Add a supplier profile page reachable from navigation/settings. The first version can be a single form with grouped fields:

- Company.
- Business fit.
- Geography.
- Certifications.
- Contract preferences.
- Risk preferences.

The page should show profile completion percentage and short guidance about improving match quality.

### Bid Detail Page

Add a pursuit panel near the top:

- Match score.
- Explanation.
- Missing-profile hint if needed.
- `Add to Intent` button.
- If already in intent, link to intent workspace.

Add an AI brief/checklist section after the description or metadata once an intent exists.

### Intent Workspace

Add an Intent page that lists all intent records and a detail workspace for one intent.

The workspace shows:

- Bid title and agency.
- Current status.
- AI brief.
- Key dates.
- Checklist.
- Risk flags.
- Match score snapshot.
- Source link.

## Error Handling

- Missing bid returns `404`.
- Invalid JSON body returns `400`.
- Unauthenticated users continue using the existing anonymous principal behavior.
- If profile is missing, match API still returns a baseline response.
- Intent creation should not fail because profile is incomplete.
- Brief/checklist generation should be deterministic and always return a usable fallback.

## Testing

Add tests for:

- Migration and schema definitions.
- Supplier profile upsert and retrieval.
- Match score calculation with profile and without profile.
- Intent creation idempotency.
- Intent listing by user.
- Intent status update ownership.
- API route validation and responses.
- Client API wrappers.
- A page-level check that the bid detail page includes the `Add to Intent` action label.

## Acceptance Criteria

Phase 1A is complete when:

1. A user can create/update a supplier profile.
2. A bid detail page shows a match score and explanation.
3. A user can add a bid to Intent to Bid.
4. The intent stores a generated brief, checklist, risk flags, and match snapshot.
5. A user can list intents and open an intent workspace.
6. The workflow works for anonymous local users and authenticated users.
7. Existing search, saved bids, crawler/admin, and static UI pages continue to pass tests.

## Remaining Work After Phase 1A

After this phase, the next recommended stages are:

1. Phase 1B: improve match scoring and show scores on search cards.
2. Phase 1C: replace rule-generated brief/checklist with guarded LLM generation.
3. Phase 2: submission path and submission readiness checklist.
4. Phase 3: sourcing partner and quote support.
