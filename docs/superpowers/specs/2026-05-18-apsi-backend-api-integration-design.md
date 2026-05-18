# APSi Backend API Integration Design

## 1. Purpose

This design defines the next APSi implementation slice: replacing direct front-end mock-data reads with a thin backend foundation inside the existing Next.js app.

The goal is to make the current MVP demo behave like a real product boundary without introducing a separate backend service, authentication system, crawler, or database in this slice.

## 2. Scope

### 2.1 In Scope

- Add Next.js API routes for bid list search, bid details, saved bid listing, save, and unsave actions.
- Keep the API inside `frontend/src/app/api` so the current project remains one deployable app.
- Move bid search, filtering, sorting, lookup, and saved-bid mutation logic into server-side modules.
- Keep seeded in-memory data for this slice, using the existing mock records as the initial dataset.
- Preserve the current front-end user experience, visual design, and bilingual UI.
- Update the homepage, bid detail page, saved bids page, and saved-bid context to call API endpoints.
- Add clear loading, error, and empty states for API-backed pages.
- Add tests around server-side bid querying and saved-bid behavior before implementation.

### 2.2 Out Of Scope

- Separate Express, FastAPI, or other standalone backend service.
- Database integration.
- User registration, login, logout, sessions, or authorization.
- Multi-user saved-bid isolation beyond a fixed demo user.
- Real SAM.gov or state portal crawler integration.
- Attachment downloading, parsing, or AI summarization.
- URL-driven locale routing.
- Production-grade rate limiting, audit logging, or observability.

## 3. Current Project Context

The project currently has one application under `frontend/`, built with Next.js 16, React 19, TypeScript, and the App Router.

The current UI reads `MOCK_BIDS` directly from `frontend/src/lib/mock-data.ts` in:

- `frontend/src/app/page.tsx`
- `frontend/src/app/bids/[id]/page.tsx`
- `frontend/src/app/saved/page.tsx`
- `frontend/src/components/bids/BidCard.tsx`
- `frontend/src/context/SavedBidsContext.tsx`

This slice should keep the existing mock data file as seed data, but pages and interactive contexts should stop treating it as their primary runtime data source.

## 4. Recommended Architecture

Use Next.js route handlers as the backend foundation.

The API layer should be backed by small server-side modules:

- `frontend/src/server/bids/repository.ts`: owns seeded bid records and saved-bid IDs.
- `frontend/src/server/bids/service.ts`: owns query, filter, sort, lookup, save, and unsave behavior.
- `frontend/src/server/bids/types.ts`: owns API request and response types shared by route handlers and client helpers.
- `frontend/src/lib/api/bids.ts`: owns front-end fetch helpers for bid APIs.

The UI should depend on `frontend/src/lib/api/bids.ts`, not on server modules. Route handlers should depend on server modules, not React components.

This keeps the product boundary realistic while leaving room to replace the repository during the database integration slice.

## 5. API Design

### 5.1 `GET /api/bids`

Returns filtered, sorted bid results.

Supported query parameters:

- `q`: keyword search across title, description, issuer name, original category, and tags.
- `states`: comma-separated state/source IDs such as `sam`, `ca`, `tx`.
- `issuerType`: `all`, `federal`, or `state`.
- `deadline`: `any`, `next7`, or `next30`.
- `published`: `any`, `last24`, or `last7`.
- `sort`: `relevance`, `newest`, or `deadline`.

Response:

```json
{
  "bids": [],
  "total": 0,
  "filters": {
    "q": "",
    "states": [],
    "issuerType": "all",
    "deadline": "any",
    "published": "any",
    "sort": "relevance"
  }
}
```

### 5.2 `GET /api/bids/[id]`

Returns one bid by ID.

Successful response:

```json
{
  "bid": {
    "id": "1"
  }
}
```

Not found response:

```json
{
  "error": {
    "code": "BID_NOT_FOUND",
    "message": "Bid not found"
  }
}
```

### 5.3 `GET /api/saved-bids`

Returns saved bids for the demo user.

Response:

```json
{
  "savedBidIds": [],
  "bids": []
}
```

### 5.4 `POST /api/saved-bids`

Saves a bid for the demo user.

Request:

```json
{
  "bidId": "1"
}
```

Successful response:

```json
{
  "savedBidIds": ["1"],
  "bids": []
}
```

Invalid bid response:

```json
{
  "error": {
    "code": "BID_NOT_FOUND",
    "message": "Bid not found"
  }
}
```

### 5.5 `DELETE /api/saved-bids/[id]`

Removes a saved bid for the demo user.

Response:

```json
{
  "savedBidIds": [],
  "bids": []
}
```

Deleting an unsaved but existing bid should be idempotent and return the current saved list.

## 6. Data Model

The API should initially expose the same bid fields used by the current UI:

- `id`
- `title`
- `source`
- `stateCode`
- `issuerName`
- `issuerType`
- `amount`
- `deadlineDate`
- `publishedDate`
- `description`
- `fullDescription`
- `originalCategory`
- `contactName`
- `contactEmail`
- `contactPhone`
- `sourceUrl`
- `attachments`
- `tags`
- `isActive`
- `saved`

The repository should initialize saved-bid IDs from the seeded records with `saved: true`.

The fixed demo user should be represented inside the server module as `demo-user`. The API does not need to expose that ID yet.

## 7. Front-End Data Flow

### 7.1 Search Workspace

The homepage should keep UI filter state locally, but fetch results from `GET /api/bids` whenever the filter state changes.

The page should show:

- Loading state while the request is pending.
- Error state if the request fails.
- Empty state when the request succeeds with zero bids.
- Result count from the API response.

The front end should no longer duplicate server-side filtering logic.

### 7.2 Bid Details

The detail page should fetch `GET /api/bids/[id]` using the route param.

The page should show:

- Loading state while the bid is loading.
- Not found state for a 404 response.
- Error state for other failed responses.

Save and unsave actions should call the saved-bid API through the shared saved-bid context.

### 7.3 Saved Bids

The saved bids page should read saved bid data from the saved-bid context, which is hydrated by `GET /api/saved-bids`.

Removing a saved bid should call `DELETE /api/saved-bids/[id]` and update local context state from the response.

### 7.4 Bid Cards

`BidCard` should continue receiving a `bid` prop. It should not fetch data by itself.

The card save button should call the shared saved-bid context. The card should remain reusable across search and saved pages.

## 8. Error Handling

API errors should use a consistent shape:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

Planned error codes:

- `BID_NOT_FOUND`
- `INVALID_REQUEST`
- `INTERNAL_ERROR`

Client fetch helpers should throw a typed error or return a consistent failure object so React pages do not duplicate response parsing.

## 9. Testing Strategy

This slice should use test-first development for server behavior.

Minimum tests:

- `queryBids` returns all active bids by default.
- `queryBids` filters by keyword.
- `queryBids` filters by state/source.
- `queryBids` filters by issuer type.
- `queryBids` filters by published date and deadline presets.
- `queryBids` sorts by newest and deadline.
- `getBidById` returns a bid or not found.
- `saveBid` adds an existing bid and is idempotent.
- `saveBid` rejects an unknown bid.
- `removeSavedBid` removes an existing saved bid and is idempotent.

If the current project has no test runner, add Vitest with a minimal configuration and keep the tests focused on server modules rather than browser UI.

Manual browser verification should still cover:

- Search page loads from API.
- Filters affect API-backed results.
- Detail page loads from API.
- Save and unsave update search/detail/saved pages.
- English remains default, Chinese switch still works.

## 10. Acceptance Criteria

- The app exposes API routes for bid list, bid detail, saved bid list, save, and unsave.
- The homepage, bid detail page, and saved page no longer read `MOCK_BIDS` directly for runtime behavior.
- Search, filters, sorting, detail lookup, and saved-bid state continue to behave like the current MVP demo.
- API responses use consistent success and error shapes.
- Server-side query and saved-bid behavior has automated tests.
- `npm run lint`, `npm run build`, and the new test command pass from `frontend/`.
- Browser verification confirms the full path: search, filter, detail, save, saved page, unsave, and language switch.
