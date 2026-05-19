# APSi IL BidBuy, Browser/HTML Handling, and Attachments Design

## Goal

Implement the next three crawler capabilities as a sequenced delivery: Illinois BidBuy live ingestion, a reusable browser/HTML handling layer, and first-stage attachment discovery/extraction.

## Confirmed Direction

Use approach A: build a vertical IL BidBuy adapter first, extract only the reusable HTML handling needed by that adapter, then add attachment discovery once real bid detail pages can supply links.

This keeps each stage independently testable. It avoids a broad scraping framework before the project has a concrete second HTML use case, while still preventing IL-specific parsing from becoming tangled inside one large spider.

## Current Context

The crawler already has:

- Live source registration through `Source.live_fetcher`.
- `fetch-state` CLI with `--fixture-json`.
- CA, TX, NY, and FL live adapters.
- FL uses a real public JSON API; TX and NY currently fail clearly on direct non-JSON public page responses.
- Shared state bid normalization through `normalize_state_opportunity`.
- `attachments` carried in normalized Python bid dictionaries.
- Crawler SQLite storage for `bids` and `crawler_logs`.

The frontend already has:

- A `bid_attachments` table and repository support for bid detail attachments.
- Seeded mock attachments.
- Bid detail UI that displays attachment lists.

Illinois BidBuy public references:

- BidBuy home: `https://www.bidbuy.illinois.gov/bso/`
- Open Bids search page: `https://www.bidbuy.illinois.gov/bso/view/search/external/advancedSearchBid.xhtml?openBids=true`

## Scope

This delivery has three stages.

### Stage 1: IL BidBuy Live Adapter

Add `il_bidbuy` as a live-supported source.

The first implementation will fetch and parse the public Open Bids page. The adapter should support deterministic replay from recorded HTML and normalize visible listing rows into APSi bid records. If the live page requires additional session state, JavaScript execution, or anti-automation behavior, the adapter must fail clearly and the failure should drive Stage 2 rather than being hidden by brittle parsing.

### Stage 2: Minimal Browser/HTML Handling Layer

Add a small crawler-side HTML utility layer for public procurement pages.

This layer should provide:

- HTML loading from live HTTP or fixture file.
- Stable table extraction helpers.
- Relative URL resolution.
- Text normalization helpers.
- Source-specific parser functions that are easy to test.
- Clear source-specific errors when expected selectors or columns are absent.

This stage is not a full browser automation system. It should create the smallest reusable layer needed for IL and later TX/NY public-page work. Browser automation with Playwright remains a later extension point if static HTML is insufficient.

For this delivery, "browser/HTML handling" means deterministic HTML fetch, fixture replay, selector/table parsing, URL resolution, and a clear extension boundary for a future browser-backed fetcher.

### Stage 3: Attachment Discovery and First-Stage Extraction

Add first-stage attachment handling.

The crawler should discover attachment links from source detail pages or fixture detail HTML, normalize them into bid dictionaries, and persist them into SQLite when tables are available. This stage should save attachment metadata first:

- `name`
- `url`
- `size_label`
- `mime_type`
- `sort_order`

Actual file downloading, PDF/DOCX text extraction, and AI summarization are out of scope for this stage unless the HTML page already exposes plain text that can be captured as `full_description`.

## Non-Goals

This delivery will not add:

- Login or authenticated vendor workflows.
- Full Playwright/browser automation unless IL cannot be handled with public HTML.
- Anti-bot bypassing.
- Bulk attachment file downloads.
- PDF/DOCX parsing.
- AI document summaries.
- Frontend redesign.
- Real SMTP/email delivery.

## Architecture

### Source Adapter Contract

IL should follow the established state live adapter interface:

```python
fetch_il_bidbuy_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    fixture_json=None,
)
```

`fixture_json` may remain useful for normalized replay, but `fixture_html` should be the main deterministic path for testing the public Open Bids HTML page.

### HTML Utility Boundary

Create a crawler utility module rather than embedding all parsing in `il_bidbuy.py`.

Recommended boundary:

- `crawler/apsi_crawler/html/public_page.py`
  - `read_html_fixture(path)`
  - `fetch_html(url, session=None, timeout=30, params=None)`
  - `normalize_space(value)`
  - `absolute_url(base_url, href)`
  - `extract_table_rows(html, required_headers)`

The utility layer should use the standard library when reasonable. If table parsing becomes too brittle, use BeautifulSoup only if it is already available or add it deliberately with tests and requirements updates.

### IL Parser Boundary

Keep IL-specific mapping in `crawler/apsi_crawler/spiders/il_bidbuy.py`.

The IL parser should map public Open Bids columns to raw state opportunity fields:

- Source ID: `Bid Solicitation #`
- Title/description: `Description`
- Issuer: `Organization Name`
- Deadline: `Bid Opening Date`
- Status: `Status`
- Alternate ID: `Alternate Id`
- Source URL: detail link when present, otherwise Open Bids page URL.

The final bid shape must continue through `normalize_state_opportunity`, resulting in:

- `source = "Illinois BidBuy"`
- `issuer_type = "state"`
- `state_code = "IL"`
- `dedupe_key = "il_bidbuy:<source_bid_id>"`

### Attachment Persistence

The Python crawler currently stores bid rows but does not persist bid attachments to SQLite. Add storage support in the crawler so bid dictionaries with `attachments` can be written to a `bid_attachments` table when that table exists.

Persistence behavior:

- Delete existing attachments for a bid before inserting the current attachment list.
- Use stable IDs, such as `<bid_id>:attachment:<index + 1>`.
- Preserve `sort_order`.
- Skip invalid attachment records without URL only if the parser explicitly marks them invalid; otherwise fail source-specific parsing tests.
- Keep backwards compatibility for crawler test databases that do not include `bid_attachments`.

## Data Flow

1. `fetch-state --source il_bidbuy` asks the registry for the IL live fetcher.
2. The IL fetcher loads live HTML or fixture HTML.
3. The HTML utility extracts Open Bids rows.
4. The IL parser maps rows to raw opportunity dictionaries.
5. Detail-page attachment discovery optionally enriches each opportunity with `attachments`.
6. `normalize_state_opportunity` creates APSi bid dictionaries.
7. SQLite storage upserts bids and writes attachments when the table exists.
8. `crawler_logs` records live/replay metadata and counts.

## Error Handling

Use source-specific errors:

- `IlBidBuyError` for IL adapter failures.
- `HtmlPageError` or a similarly small utility error for generic HTML helper failures.
- `AttachmentExtractionError` only if attachment parsing becomes its own module.

Expected failure cases:

- Non-200 HTTP response.
- Network exception.
- Non-HTML or empty response.
- Missing expected table headers.
- Row missing bid solicitation number.
- Detail page requested but unavailable.
- Attachment row with missing URL when parsing a known attachment table.

Errors should be clear enough for crawler logs and tests.

## Testing

Tests should cover:

- Registry reports IL as live-supported after Stage 1.
- Remaining unsupported examples use a source outside the five current state fixtures only if needed.
- IL HTML fixture replay normalizes one or more Open Bids rows.
- IL parser handles table rows with repeated columns and blank optional fields.
- Missing required table headers raise an IL/HTML-specific error.
- Missing source ID raises `IlBidBuyError`.
- HTTP failure and request exception paths are wrapped.
- `fetch-state --source il_bidbuy --fixture-html ...` writes a bid and success crawler log.
- Attachment discovery from a detail HTML fixture returns normalized attachment metadata.
- SQLite storage writes, replaces, and preserves bid attachments when the table exists.
- Existing CA/TX/NY/FL live adapter tests continue to pass.
- Frontend attachment repository tests continue to pass.

## Acceptance Criteria

- IL no longer appears unsupported in the live registry.
- A developer can replay IL Open Bids from an HTML fixture through `fetch-state`.
- The shared HTML layer has unit tests and is not tied to IL-only names.
- The crawler can persist discovered attachments into `bid_attachments` when the table exists.
- Existing bid imports without attachments remain compatible.
- `cd crawler && python3 -m pytest` passes.
- `cd frontend && npm test` passes.
- `cd frontend && npm run lint` passes.
- `cd frontend && npm run build` passes.

## Remaining After This Delivery

After these three stages, remaining work will be:

1. Browser automation with Playwright for portals that cannot be handled through public HTTP/HTML.
2. PDF/DOCX download and text extraction.
3. AI summaries and compliance/risk extraction from documents.
4. Real SMTP/email delivery.
5. Production scheduling, retries, and health alerting.
