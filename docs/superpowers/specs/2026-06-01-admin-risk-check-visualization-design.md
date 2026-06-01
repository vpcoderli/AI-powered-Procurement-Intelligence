# Admin Risk Check Visualization Design

## Goal

Expose the existing local risk checklist in the Admin console so operators can see whether the crawler/data/link/account-risk gates are healthy without running a terminal command.

## Scope

- Add a read-only Admin API for the existing `createRiskChecklistReport()` output.
- Add typed frontend API helpers for that endpoint.
- Load the report with the existing Admin dashboard data.
- Render a compact risk checklist section near the top of `/admin`.
- Keep the existing `npm run risk:check` CLI behavior unchanged.

## Non-Goals

- No persistent risk-check history table in this slice.
- No automatic crawler rerun from the risk panel; crawler controls already exist.
- No new risk checks beyond the current checklist: 50-state coverage, non-empty state content, bid detail route lookup, attachment downloads, and account/tier separation.

## Architecture

The server already has the canonical risk-check domain logic in `frontend/src/server/risk/checklist.ts`. The new endpoint `GET /api/admin/risk-check` will call that service with the app database and protect access with `requireAdminAccess()`, matching other operational Admin read APIs. The frontend API layer will export `getAdminRiskChecklist()` and share the server report types.

The Admin page will include `riskReport` in `LoadState`. It will render an overall pass/fail badge, checked timestamp, per-check status cards, and up to a few failure details per check. This keeps the console dense and operational rather than adding a separate page.

## UI Behavior

- Loading state remains the existing Admin loading skeleton.
- If the full Admin data load fails, the existing error panel remains.
- If the report is healthy, the panel shows a green overall status and green check rows.
- If any check fails, the panel shows a red overall status, red failed rows, and detail messages.
- Operators/support/admin can read the panel; mutation permissions are not required.

## Testing

- Route test: unauthenticated/unauthorized requests are denied; authorized admin/support/operator can fetch report JSON.
- Client static test: admin API helper includes `/api/admin/risk-check`.
- Page static test: Admin page loads `getAdminRiskChecklist`, stores `riskReport`, and renders risk check labels/status.
- Regression: focused tests, full `npm test`, `npm run lint`, `npm run build`, `npm run risk:check`, and `git diff --check`.
