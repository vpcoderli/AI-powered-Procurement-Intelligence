# APSi Local Saved Bids Persistence Design

## 1. Purpose

This design defines the next local development slice for APSi: persist saved bids across local server restarts and isolate saved bids between anonymous browser users.

The goal is to make the local MVP behave less like a shared in-memory demo while avoiding full authentication, accounts, or a production database in this slice.

## 2. Scope

### 2.1 In Scope

- Persist saved-bid IDs to a local JSON file under `frontend/data/`.
- Assign each browser an anonymous user ID through an HTTP-only cookie.
- Store saved-bid IDs by anonymous user ID.
- Keep existing bid seed data in `frontend/src/lib/mock-data.ts`.
- Keep the current saved-bids API response shapes so the front end does not need a large rewrite.
- Add tests for storage behavior, user isolation, cookie creation, and API persistence.
- Preserve existing search, detail, saved-page, and bilingual UI behavior.

### 2.2 Out Of Scope

- User registration, login, logout, password reset, or profile management.
- Production authentication or authorization.
- A database such as SQLite, Postgres, or hosted storage.
- Real SAM.gov or state data ingestion.
- Changing the bid data source.
- Account settings persistence.
- Saved-search alerts or email notification delivery.

## 3. Recommended Approach

Use JSON-file persistence plus an anonymous browser-user cookie.

This is the smallest useful step after the API foundation:

- It fixes local restart data loss.
- It prevents every browser from sharing the same saved list.
- It keeps the API contract stable.
- It remains easy to replace with a real database later.

SQLite is a reasonable future option, but it is more structure than this local slice needs. For now, the storage abstraction should make the future replacement straightforward without forcing database decisions early.

## 4. Data Storage

Create a local JSON store at:

```text
frontend/data/saved-bids.json
```

Use this shape:

```json
{
  "users": {
    "anon_example": ["2", "1"]
  }
}
```

Rules:

- The file is created automatically if it does not exist.
- A missing user entry means that user has no saved bids.
- Saved IDs are unique per user.
- Save and remove operations are idempotent.
- Bid records are still read from the existing seeded bid repository.
- `frontend/data/*.json` should not be committed as runtime state.

## 5. Anonymous User Identity

The server should identify the current browser through a cookie:

```text
apsi_user_id=anon_<random>
```

Cookie behavior:

- If a request includes a valid `apsi_user_id`, use it.
- If a request does not include one, generate a new anonymous ID.
- The response that creates a new ID must include `Set-Cookie`.
- The cookie should be HTTP-only, same-site lax, path `/`, and long-lived enough for local development.
- The anonymous ID should be opaque. It does not need to encode user information.

This identity is only for local saved-bid isolation. It is not authentication.

## 6. API Behavior

The saved-bids endpoints should keep their current response shape.

### 6.1 `GET /api/saved-bids`

Behavior:

- Resolve or create the anonymous user.
- Read saved IDs for that user from the JSON store.
- Return saved IDs and matching bid objects.
- Set the anonymous-user cookie when a new user is created.

Response:

```json
{
  "savedBidIds": ["2"],
  "bids": []
}
```

### 6.2 `POST /api/saved-bids`

Behavior:

- Resolve or create the anonymous user.
- Validate `bidId` as a non-empty string.
- Return `400 INVALID_REQUEST` for malformed request bodies.
- Return `404 BID_NOT_FOUND` for unknown bid IDs.
- Add the bid ID to that user's saved list if it is not already present.
- Write the updated JSON store.
- Return the updated saved-bids response.

### 6.3 `DELETE /api/saved-bids/[id]`

Behavior:

- Resolve or create the anonymous user.
- Remove the bid ID from that user's saved list if present.
- Deleting an already-unsaved ID remains idempotent.
- Return the updated saved-bids response.

## 7. Error Handling

Storage errors should be explicit rather than silently destructive.

Rules:

- If the JSON file does not exist, create a fresh empty store.
- If the JSON file contains invalid JSON or an invalid root shape, return `500 INTERNAL_ERROR`.
- Do not overwrite a corrupt file automatically.
- Write changes through a temporary file followed by rename.
- Keep existing API error shape:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error"
  }
}
```

## 8. Server Module Boundaries

Keep the modules small and replaceable.

Recommended responsibilities:

- `frontend/src/server/bids/user.ts`: resolve anonymous user IDs and cookie headers.
- `frontend/src/server/bids/saved-bids-store.ts`: read, write, save, and remove saved IDs in the JSON file.
- `frontend/src/server/bids/repository.ts`: keep seeded bid lookup/query responsibilities.
- `frontend/src/server/bids/service.ts`: coordinate bid validation and saved-bid responses using the store.
- `frontend/src/app/api/saved-bids/*`: translate HTTP requests and responses, including setting cookies.

The front end should continue to call `frontend/src/lib/api/bids.ts` and should not know whether saved bids are in memory, JSON, or a future database.

## 9. Testing Strategy

Add tests at the server/API boundary.

Required tests:

- Store creates an empty file-backed state when the file is missing.
- Store saves IDs idempotently for one user.
- Store removes IDs idempotently for one user.
- Store isolates IDs for two different anonymous users.
- Store rejects corrupt JSON without overwriting it.
- `GET /api/saved-bids` without cookie returns `Set-Cookie`.
- Saved IDs persist across module/service calls when using the same cookie.
- Different cookies return isolated saved lists.
- Existing malformed body and unknown bid tests remain green.

Existing client helper and page code should not need contract changes. If implementation changes the API shape, that is a design failure for this slice.

## 10. Acceptance Criteria

The slice is complete when:

- Saving a bid, stopping the dev server, restarting it, and reopening the same browser keeps the saved bid.
- A second browser or fresh cookie starts with an independent saved list.
- `npm test`, `npm run lint`, and `npm run build` pass.
- Existing browser acceptance still passes for search, detail, save, saved page, unsave, Chinese switch, and mobile width.
- Runtime JSON state under `frontend/data/` is ignored by git.

## 11. Follow-Up Work

After this slice, likely next steps are:

- Decide whether to replace JSON storage with SQLite or another database.
- Add a real user account model.
- Persist settings and saved search alerts.
- Add React integration tests for saved-bid context and page flows.
