# scrapling-extractor

Parser-only sidecar (Scrapling 0.4.15 base package, no fetchers) that turns a bid detail page's HTML into structured fields. The crawler fetches pages itself; this service never makes outbound requests.

- Local (the way to reach it from a host-run `npm run dev`): `./run-local.sh` (needs python3.12)
  → http://localhost:8091; set `SCRAPLING_EXTRACTOR_URL=http://localhost:8091` in `frontend/.env.local`.
  Host runs bind to `127.0.0.1` by default (`EXTRACTOR_HOST` overrides the bind address).
- Docker: `docker compose up scrapling-extractor` — **internal-only**, no host port is published.
  The `app` container reaches it over compose DNS at `http://scrapling-extractor:8091`; from the
  host, use `docker compose exec scrapling-extractor …` (or `run-local.sh`), not `localhost:8091`.
  The service has no authentication and must never be exposed publicly.
  The image sets `EXTRACTOR_HOST=0.0.0.0` for access on the private container network.
- API: `GET /health`, `POST /extract {url, html, fields, selectors}`,
  `POST /extract-list {url, html, item_selector, selectors, fields, max_items, auto_save}`
- Tests: `.venv/bin/python -m pytest tests`

Real portal samples and the per-source selector notes live in `tests/fixtures/live/README.md`.

## `POST /extract` — one detail page → fields

Request `{url, html, fields, selectors}`; response `{fields, attachments, diagnostics}`. `fields`
is a subset of `description, attachments, category, contact, published_date`; `selectors` maps any
of them to a CSS (or XPath, when it starts with `/` or `(`) override.

## `POST /extract-list` — one list page → rows (contract C2)

```json
{
  "url": "https://www.bidnetdirect.com/colorado/solicitations/open-bids",
  "html": "<html>…</html>",
  "item_selector": null,
  "selectors": {"title": null, "url": null, "published_date": null, "deadline_date": null,
                "source_bid_id": null, "issuer_name": null},
  "fields": ["title", "url", "published_date", "deadline_date", "source_bid_id", "issuer_name"],
  "max_items": 200,
  "auto_save": true
}
```
```json
200 {
  "items": [{"title": "RFP 26-034 FNS Point-of-Sale Computer Hardware",
             "url": "https://www.bidnetdirect.com/colorado/solicitations/open-bids/RFP-26-034-…/0000425954?…",
             "published_date": "05/28/2026", "deadline_date": "07/16/2026",
             "source_bid_id": "0000425954", "issuer_name": null}],
  "diagnostics": {"title": "heuristic", "url": "heuristic", "published_date": "heuristic",
                  "deadline_date": "heuristic", "source_bid_id": "heuristic", "issuer_name": "not_found"},
  "item_selector_used": "tr.mets-table-row",
  "empty_state": {"detected": false, "marker": null}
}
```

- Only `url` and `html` are required. `fields` defaults to all six, `max_items` to 200 (1–500),
  `auto_save` to true. Same error envelope as `/extract`: `INVALID_REQUEST` 400, 413 past the
  2 MiB html cap, `EXTRACT_FAILED` 500.
- **Rows.** With `item_selector` the caller's selector decides. Without one, the service picks the
  repeated sibling group (same parent, tag and class signature) holding the most detail-looking
  anchors — ties go to the higher hit ratio, then to `tr`/`li`/`article` over `div`, then to the
  outermost group. `item_selector_used` reports a CSS selector naming what was chosen, so an
  operator can pin it in the source's `fetch_config.list_extraction.item_selector`.
- **Fields.** Per field: caller selector → heuristic → `not_found` (reported in `diagnostics`,
  aggregated across the rows). The heuristics read the row's detail anchor (title, url), the
  table's column headers when the row is a `<tr>` ("Description" → title, "Organization Name" →
  issuer, "Bid Opening Date" → deadline), and label-or-class-tagged dates inside the row
  ("Published 05/28/2026", `class="sol-closing-date"`). `url` is always absolute, resolved against
  the request `url`. `source_bid_id` comes from a long numeric path segment (`…/0000425954`), else
  from an id-looking query parameter (`?docId=IL-BIDBUY-2026-001`), else from an id column.
- **Empty lists.** `empty_state.detected` is true when the page carries an explicit empty-list
  phrase ("There are no open bids at this time.", "No results found", …); `marker` is the sentence
  it matched. On such a page, and unless the caller pinned an `item_selector`, the row heuristic is
  skipped and `items` is `[]` — a page that says it has no bids must not be turned into rows built
  from its own chrome. Confirming the tenant (that the page really is the source's) is the
  crawler's job, not this service's (contract C1).
- Adaptive selectors (`auto_save`/`auto_match`) use the same per-host Scrapling store as
  `/extract`; set `auto_save: false` to query without writing to it.

List fixtures for the tests live in `tests/fixtures/list/` (copies of the crawler's own
`crawler/tests/fixtures/*_open_bids.html`, plus a synthetic card page) and the real empty-state
page is `tests/fixtures/live/bidnet_erie_no_open_bids.html`.
