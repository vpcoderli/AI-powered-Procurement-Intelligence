# browser-downloader

Headless-Chromium sidecar (Playwright 1.63.0, Python 3.12) that downloads a bid attachment which
the portal only hands out through a form/JS-driven click — Illinois BidBuy's
`bidDetail.sdo?downloadFileNbr=…` being the motivating case, where a plain GET returns an HTML
session-error page. The crawler calls it in `mode=browser`; everything else keeps downloading
directly with `requests`.

It also renders a public page for the crawler (`POST /render`, contract C3) when a portal tenant
builds its solicitation list in JavaScript and the server-rendered HTML holds no rows.

It opens one public page, clicks one element (or none, for `/render`), returns what it got, and
forgets everything. It never logs in, never fills a field, never stores a file.

## API

`GET /health`
```json
200 {"ok": true, "browser": "chromium", "playwright": "1.63.0"}
503 {"ok": false, "error": "chromium is not installed (run: python -m playwright install chromium)"}
```

`POST /download`
```json
{
  "page_url": "https://www.bidbuy.illinois.gov/bidDetail.sdo?docId=27-444DHS-P",
  "link": {"href_contains": "1807333", "text": "Solicitation.pdf", "selector": null},
  "timeout_seconds": 30,
  "max_bytes": 52428800,
  "allowed_hosts": ["www.bidbuy.illinois.gov"]
}
```
- Success: `200` with the **binary body** plus `X-Download-Filename`, `X-Download-Content-Type`,
  `X-Download-Final-Url`, `X-Download-Byte-Size` (`Content-Type` mirrors the sniffed type).
- Failure: `{"error": {"code", "message"}}` with
  `INVALID_REQUEST (400) | LOGIN_WALL (403) | OFF_HOST (403) | LINK_NOT_FOUND (404) |
  TOO_LARGE (413) | NAVIGATION_FAILED (502) | BROWSER_ERROR (500) | TIMEOUT (504)`.

Link resolution order: `selector` (CSS, or XPath when it starts with `//`) → first `a`/`button`/
`input[type=submit|button|image]` whose `href` or `onclick` contains `href_contains` → element whose
normalized text equals `text` exactly. Clicking may produce either a Playwright `download` event or
a navigation whose response carries `Content-Disposition: attachment`; both are returned as the
download.

`timeout_seconds` (1–300, default 30) covers navigation *and* the wait for the download.
`max_bytes` is clamped to `BROWSER_DOWNLOADER_MAX_BYTES` (default 50 MB) and enforced twice: against
`Content-Length` when the portal declares one, and again while reading the file.

`POST /render` (contract C3)
```json
{
  "page_url": "https://www.bidnetdirect.com/erie-county-ny/solicitations/open-bids",
  "allowed_hosts": ["www.bidnetdirect.com"],
  "timeout_seconds": 30,
  "wait_for": {"selector": "#bid-list", "network_idle": false}
}
```
- Success: `200 {"final_url": "…", "status": 200, "title": "…", "html": "<html>…</html>"}` — the
  document **after** JavaScript ran, for portal tenants whose solicitation list is built client
  side; the crawler hands it to the Scrapling sidecar's `POST /extract-list`.
- Failure: the same envelope and codes as `/download` —
  `INVALID_REQUEST (400) | LOGIN_WALL (403) | OFF_HOST (403) | TOO_LARGE (413) |
  NAVIGATION_FAILED (502) | BROWSER_ERROR (500) | TIMEOUT (504)`.
- Only `page_url` is required. `wait_for` is applied after `domcontentloaded`: `selector` waits for
  that element to attach and reports `TIMEOUT` if it never does; `network_idle` waits for the
  network to go quiet. Both may be set; with neither, the document is read at `domcontentloaded`.
  `timeout_seconds` (1–300, default 30) covers navigation *and* the waits.
- The rendered document is capped at 2 MiB (`TOO_LARGE`) — the same cap the Scrapling sidecar
  applies to `html` — and a page that looks like a login wall returns `LOGIN_WALL` **instead of**
  its HTML. Redirects are re-checked against `allowed_hosts` after the waits, so a page that
  navigates itself off-host fails rather than being returned.
- It renders and reads. There is no field for a click, a form fill or a credential, and `/render`
  shares `/download`'s process-wide single-job lock, browser User-Agent and navigation guards.

## Boundaries (enforced in code, pinned by tests)

- **No credentials, ever.** The request schema has no field for a username, password or form fill,
  and the service only ever calls `click()`. If the loaded page has a password/email input together
  with a login heading or a form posting to a login route, it returns `LOGIN_WALL` *before* clicking
  anything. That rule is copied from `crawler/apsi_crawler/content_quality.is_login_html` (the
  sidecar must not import the crawler package — keep the two copies in sync).
- **No off-host navigation.** Every navigation request is intercepted; anything whose hostname is
  not in `allowed_hosts` (exact, case-insensitive, port-agnostic match; the `page_url` host is
  implicitly allowed) is aborted and the request fails with `OFF_HOST`. The final page URL and the
  download URL are re-checked afterwards.
- **No CAPTCHA or WAF work.** No solving, no stealth plugins, no retry-until-through behaviour.
- **One browser job at a time** (process-wide lock shared by `/download` and `/render`), with
  the crawler's own browser User-Agent.
- **Nothing is persisted.** Playwright's temp file is read under the cap and deleted; only the
  response body leaves the process.
- **No authentication on the HTTP surface.** It binds `127.0.0.1` by default and the container
  publishes no host port — it must never be exposed publicly. Anyone who can reach it can make the
  host fetch arbitrary allow-listed URLs.
- One JSON log line per request on stderr (`event` — `browser_download` or `browser_render` —
  plus `host`, `outcome`, `status`, `byte_size`, `duration_ms`). Never request or response bodies.

## Run it

```bash
./run-local.sh                       # python3.12 venv + playwright install chromium (~150 MB), binds 127.0.0.1:8092
curl -s http://127.0.0.1:8092/health
```

Docker: built from this directory (base image `mcr.microsoft.com/playwright/python:v1.63.0-jammy`,
which already contains Chromium and its system libraries; expect a ~2 GB image). The image sets
`BROWSER_DOWNLOADER_HOST=0.0.0.0` for the private compose network and runs as `pwuser`. Compose
publishes no `ports:`; the crawler reaches it at `http://browser-downloader:8092`.

| Env var | Default | Notes |
| --- | --- | --- |
| `BROWSER_DOWNLOADER_HOST` | `127.0.0.1` | `0.0.0.0` in the image only |
| `BROWSER_DOWNLOADER_PORT` | `8092` | |
| `BROWSER_DOWNLOADER_MAX_BYTES` | `52428800` | hard cap; a larger `max_bytes` in a request is clamped |
| `BROWSER_DOWNLOADER_LOG` | unset | `1` also emits the stdlib access log |

## Tests

```bash
.venv/bin/python -m pytest -q tests
```

`tests/test_guards.py`, `tests/test_link_resolution.py`, `tests/test_server.py` and the validation,
cap and route classes of `tests/test_render.py` need neither Playwright nor a browser (CI installs
no browser and they still run). `tests/test_browser_download.py` and `tests/test_render.py`'s
`TestBrowserRender` drive real Chromium against throwaway loopback HTTP servers and **skip
themselves** when Playwright or Chromium is missing. No test ever contacts a portal.
