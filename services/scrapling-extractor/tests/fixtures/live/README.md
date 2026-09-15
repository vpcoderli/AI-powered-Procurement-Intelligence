# Live detail-page fixtures

Captured **2026-09-15** with a single polite `curl` per page (standard browser User-Agent,
≥3 s spacing). Every kept file is the real portal response with only `<script>` blocks
removed; nothing else was edited. `expectations.json` pins substrings copied from each page
at capture time and is consumed by `tests/test_live_fixtures.py`.

## Kept fixtures (server-rendered, publicly reachable without login)

| Fixture | Source | Captured URL |
|---|---|---|
| `il_bidbuy_detail.html` | `il_bidbuy` (Periscope BuySpeed) | `https://www.bidbuy.illinois.gov/bso/external/bidDetail.sda?docId=27-493ISP-ADMIN-B-54102&external=true&parentUrl=close` |
| `or_oregonbuys_detail.html` | `or_state_procurement` (Periscope BuySpeed) | `https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-X24129-00017971&external=true&parentUrl=close` |
| `pa_emarketplace_detail.html` | `pa_state_procurement` (ASP.NET WebForms) | `https://www.emarketplace.state.pa.us/Solicitations.aspx?SID=6100066394-1` |

### What the heuristics get with no selectors, and which selectors each source needs

**IL BidBuy** — everything heuristic; no selectors required.
- `description` ← "Description:" table label (BuySpeed's one-line description).
- `contact` ← "Info Contact:" cell ("Contact Amanda Olinger at (217) 524-8437" → name
  `Amanda Olinger`, phone `(217) 524-8437`; the leading "Contact"/trailing "at" are stripped
  by `_clean_contact_name`).
- `attachments` ← "File Attachments:" container: `javascript:downloadFile('1809878')`
  links are returned with `url: null` + `raw_href` (never fabricated); the crawler resolves
  them through the source's `attachment_url_template` (spec §4.3), which for BuySpeed is
  `bidDetail.sda?downloadFileNbr={n}&docId={docId}&currentPage=1&mode=download&parentUrl=close`.
- `category` ← "NIGP Code:" rows when present; `published_date` — the page carries no
  posted date (only "Bid Opening Date", which is the deadline) → `not_found` is correct.

**OregonBuys** — same platform as IL; one selector.
- `description`, `attachments` (javascript link, as above), `category` ("NIGP Code:" →
  `948-07 Administration Services, Health`) all heuristic.
- `contact` needs a selector: the page's first "Contact" text is a long Aon contact list, so
  the heuristic returns junk. Use the "Purchaser:" cell:
  `//td[normalize-space(.)='Purchaser:']/following-sibling::td[1]` → `Steve Norman`.
  (The same XPath works on any BuySpeed portal, IL included.)

**PA eMarketplace** — description and attachments heuristic; three selectors.
- `description` ← "Description:" label (`#ctl00_MainBody_lblDesc`).
- `attachments` ← `FileDownload.aspx?file=…/Solicitation_1.pdf` links: the document
  extension is only in the query string / link text, which is why `_attachments` also
  matches on the anchor text. 5+ absolute URLs.
- `category` → `#ctl00_MainBody_lblTypes` (`IFB`); the heuristic labels don't cover PA's
  "Types:" wording.
- `published_date` → `#ctl00_MainBody_lblDatePre` (`09/14/26`, "Date Prepared").
- `contact` → `#ctl00_MainBody_lblEmail` (email only; the name/phone sit in sibling spans
  `lblPhone`… — extend to a container selector if a name is wanted).

These selector sets are what Task 11's admin configuration should ship as defaults for the
three sources.

## Portals whose detail pages are NOT server-rendered — no fixture, no extraction test

Verified live on 2026-09-15 by fetching one real `source_url` from each source:

| Source | Finding | Disposition |
|---|---|---|
| `ca_caleprocure` (`/event/{bu}/{id}`) | InFlight SPA shell; body text is only "California eProcurement Portal", event content loads via JS | 二期：浏览器渲染 |
| `fl_mfmp` (`/search/bids/detail/{id}`) | 1 KB Angular shell (`<app-root>`) | 二期：浏览器渲染 |
| `tx_esbd` (`/esbd/{id}`) | "Javascript is disabled on your browser" shell | 二期：浏览器渲染 |
| `ny_contract_reporter` (`/ads/{id}`) | Redirects to the NYSCR login page ("Login to your account to access NYSCR resources") | 需要 vendor 账号；不抓取 |
| `wa_state_procurement` (`Search_BidDetails.aspx?ID=`) | Redirects to the WEBS vendor login page | 需要 vendor 账号；不抓取 |

Login-gated pages must not be fetched by the enrichment path; JS-rendered ones need the
browser-rendering phase (out of scope for this sidecar, which runs the Scrapling parser only).
