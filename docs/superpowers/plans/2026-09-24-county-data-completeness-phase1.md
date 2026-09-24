# County Data Completeness — Phase 1 (Shared Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BidNet county/city data trustworthy before ~950 tenants are switched on: every bid carries a lifecycle (open → closed → awarded), its solicitation number and an explicit "members only" marker; lists are paged completely; delisted bids close automatically; a new `township` level exists end to end; and the worker spends a per-platform request budget instead of bursting.

**Architecture:** The Python crawler gains a BidNet list-page reader (number, lifecycle, next page) and a paginated list stage that fetches each page once, keeps Scrapling as the main row parser and overlays the reader's fields by bid id. `fetch-task` reports `metadata.pagination` (including `complete`). The TS importers merge lifecycle fields in `persistence-merge.ts` and, only when a run proves its open list complete, close the source's other open bids (id prefix `<source_id>:`). The worker loop gains a per-platform tick budget, a pause registry and activity-tiered cadence.

**Tech Stack:** Python 3 (stdlib + requests, pytest), TypeScript / Next.js 16.2.6, Drizzle ORM (SQLite), mysql2 hand-written SQL, Vitest, Tailwind/shadcn.

Spec: `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` (§5 is this phase).

## Global Constraints

- Public boundary only: never log in, never create accounts, never bypass WAF/CAPTCHA. BidNet members-only fields (issuing organization, description, documents, contact) are marked, never fetched.
- Scrapling stays the **main** list path whenever `SCRAPLING_EXTRACTOR_URL` is configured (user decision 2026-09-16). Pagination must not add requests: one fetch per page, the reader and the sidecar parse the same HTML.
- Dual runtime: every server change implements both the SQLite (Drizzle) and the MySQL (hand-written SQL) branch. New columns go into the first `sqlite.exec` CREATE TABLE block **and** an `addXColumn` call **and** `mysqlColumnMigrations` **and** `schema.ts`.
- Lifecycle delisting applies only when `metadata.pagination.list_kind === "open"` and `metadata.pagination.complete === true` (BidNet in this phase). Every other adapter behaves exactly as before.
- A source's bids are selected by id prefix `<source_id>:` using `id LIKE ? ESCAPE '!'` — never by the `source` label.
- `is_active` must always equal `lifecycle_status === 'open'` after any write.
- Platform budget default `bidnet=60` requests/hour, overridable with `CRAWLER_PLATFORM_BUDGETS` (e.g. `bidnet=60,bonfire=30`, `unlimited` allowed); tick allowance = `max(1, floor(perHour × tickMs / 3_600_000))`; pause after a throttle signature `CRAWLER_PLATFORM_PAUSE_MS` (default 1_800_000).
- Activity tiers: sources at county/city/township/special_district level with `consecutive_empty_runs >= 3` are scheduled at most weekly.
- i18n: `zh` is typed as `typeof en`; `t()` never interpolates — resolve `{platform}` / `{fields}` with `.replace()`.
- Tests run offline: fixtures only, no live portal, no live MySQL (the opt-in integration suite is the only exception and creates/drops its own schema).
- Vitest: `globals: false` — import `describe/it/expect` explicitly.
- Commit per task with explicit pathspecs; never stage `.DS_Store`, `services/.DS_Store` or `ops-evidence/`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `crawler/apsi_crawler/spiders/co_bidnet.py` | 1 | BidNet row reader: number, region, lifecycle, dates, next page, list URLs, members-only marker |
| `crawler/apsi_crawler/content_quality.py` | 1 | Empty-list phrases for closed/awarded lists |
| `crawler/tests/test_bidnet_list_pages.py` (new) | 1 | Reader tests against the 2026-09-24 Denver fixtures |
| `crawler/tests/fixtures/bidnet_denver_{open,closed,awarded}_bids_2026_09_24.html` | — | Already committed with this plan |
| `crawler/apsi_crawler/normalizers/state_bids.py` | 2 | Pass `lifecycle_status` / `awarded_date` / `solicitation_number` through; `is_active` follows lifecycle |
| `crawler/apsi_crawler/errors.py` | 3 | `VerifiedEmptyListError.pagination` |
| `crawler/apsi_crawler/list_extraction.py` | 3 | `resolve_pagination_request`, `run_paginated_list_extraction` |
| `crawler/apsi_crawler/adapters/registry.py` | 3 | `ListHtmlAdapter.page_url` / `.page_reader` |
| `crawler/tests/test_list_pagination.py` (new) | 3 | Paged stage tests |
| `crawler/apsi_crawler/cli.py` | 4 | `fetch-task`: paged routing, `metadata.pagination`, nullable `limit` |
| `frontend/src/lib/bid-lifecycle.ts` (new) | 5 | Lifecycle status type + parser shared by server and UI |
| `frontend/src/server/db/{migrate,schema,mysql}.ts` | 5 | New columns, MySQL column + data migrations |
| `frontend/src/server/crawler/lifecycle.ts` (new) | 6 | Lifecycle merge, delisting predicate, LIKE pattern, delisted payload |
| `frontend/src/server/crawler/{persistence-merge,sqlite-json-importer,mysql-json-importer}.ts` | 6 | Merge + delisting in both dialects |
| `frontend/src/server/crawler/state-runner.ts` | 7 | Task payload: `list_kind`, `start_page`, `max_pages`, `stop_before`, nullable `limit`, `listPagesFor` |
| `frontend/src/server/crawler/{source-registry,scheduler,source-health-repository,source-health-outcome}.ts` | 8 | `consecutive_empty_runs`, activity tiers |
| `frontend/src/server/crawler/platform-budget.ts` (new) | 9 | Budget parsing, tick budget, pause registry, `requestsMadeOf` |
| `frontend/src/server/crawler/configured-runner.ts`, `frontend/scripts/crawler-worker.ts` | 9 | Spend the budget, pause on throttle |
| `frontend/scripts/register-sources.ts`, `frontend/src/components/admin/JurisdictionBatchRunPanel.tsx`, `frontend/src/app/api/crawler/state/run/route.ts`, dictionaries | 10 | `township` level |
| `frontend/src/lib/bid-access.ts` (new), `frontend/src/server/bids/{domain,repository,service}.ts`, `frontend/src/lib/mock-data.ts`, `frontend/src/components/bids/BidAccessNotice.tsx` (new), `frontend/src/app/bids/[id]/page.tsx`, dictionaries | 11 | Detail page: number, lifecycle, members-only notice; search by number |
| `frontend/scripts/fixtures/bidnet-lifecycle-pipeline.py` (new), `frontend/src/server/crawler/bidnet-lifecycle.integration.test.ts` (new), `frontend/package.json` | 12 | Cross-language lifecycle integration |
| `CLAUDE.md`, `docs/architecture/crawler-enrichment-flow.md`, `docs/transferability/environment-variables.md`, `docs/operations/bid-lifecycle-and-crawl-budget.md` (new) | 13 | Docs |

**Waves (disjoint files within a wave, run in parallel):**
- Wave A: Task 1, Task 5, Task 7, Task 10
- Wave B: Task 2 (after 1), Task 6 (after 5), Task 8 (after 5, 10), Task 11 (after 5, 10)
- Wave C: Task 3 (after 1, 2), Task 9 (after 7, 8)
- Wave D: Task 4 (after 3)
- Wave E: Task 12 (after 4, 6, 7), then Task 13 (after all)
- Wave F: Task 14 — controller only (verification, local MySQL migration, live acceptance)

---

### Task 1: BidNet list-page reader

**Files:**
- Modify: `crawler/apsi_crawler/spiders/co_bidnet.py`
- Modify: `crawler/apsi_crawler/content_quality.py:143-149`
- Modify: `crawler/tests/test_content_quality_empty_state.py:73-83`
- Create: `crawler/tests/test_bidnet_list_pages.py`

**Interfaces:**
- Produces (Python, `apsi_crawler.spiders.co_bidnet`):
  - `BIDNET_ORIGIN = "https://www.bidnetdirect.com"`
  - `BIDNET_LIST_KINDS = ("open", "closed", "awarded")`
  - `BIDNET_DETAIL_ACCESS = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}`
  - `BidnetListPage = namedtuple("BidnetListPage", ("records", "next_url", "next_page"))`
  - `bidnet_list_url(base_url, list_kind="open", page=1) -> str` (ValueError on unknown kind / page < 1)
  - `bidnet_next_page(html) -> (next_url | None, next_page | None)`
  - `read_bidnet_list_page(source, html, list_kind="open") -> BidnetListPage` — records are raw dicts with keys `source_bid_id, title, description, published_date, deadline_date, awarded_date, solicitation_number, region, lifecycle_status, list_kind, detail_access, issuer_name, source_url, attachments`
  - `parse_bidnet_list_html(source, html, query=None, limit=25, issuer_name=None, list_kind="open")` (signature extended, behavior otherwise unchanged)

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_bidnet_list_pages.py`:

```python
"""BidNet list-page reader (spec 2026-09-24 §5.2) against pages captured on 2026-09-24."""

import re
from pathlib import Path

import pytest

from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.spiders.co_bidnet import (
    BIDNET_DETAIL_ACCESS,
    bidnet_list_url,
    bidnet_next_page,
    parse_bidnet_list_html,
    read_bidnet_list_page,
)

FIXTURES = Path(__file__).parent / "fixtures"
OPEN = (FIXTURES / "bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
CLOSED = (FIXTURES / "bidnet_denver_closed_bids_2026_09_24.html").read_text(encoding="utf-8")
AWARDED = (FIXTURES / "bidnet_denver_awarded_bids_2026_09_24.html").read_text(encoding="utf-8")
DENVER_URL = (
    "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
    "/solicitations/open-bids"
)


def _denver():
    label = "City and County of Denver General Services Purchasing (BidNet)"
    return TaskSource(
        id="bidnet_co_denver",
        name=label,
        source_label=label,
        jurisdiction="county",
        state_code="CO",
        base_url=DENVER_URL,
        fetch_config={"base_url": DENVER_URL},
    )


def _without_next_link(html):
    """The last page keeps the next-page wrapper but empties it."""
    return re.sub(
        r"(mets-page-navigation-next[^>]*>).*?(</div>)", r"\1\2", html, count=1, flags=re.S
    )


def test_open_list_rows_carry_number_region_dates_and_the_members_only_marker():
    page = read_bidnet_list_page(_denver(), OPEN, "open")

    assert len(page.records) == 6
    first = page.records[0]
    assert first["source_bid_id"] == "0000437489"
    assert first["solicitation_number"] == "11205A"
    assert first["title"] == "Green Infrastructure Custom Stormwater Inlets, Covers & Associated Frames (DOTI"
    assert first["region"] == "Colorado"
    assert first["published_date"] == "09/22/2026"
    assert first["deadline_date"] == "10/13/2026"
    assert first["awarded_date"] is None
    assert first["lifecycle_status"] == "open"
    assert first["list_kind"] == "open"
    assert first["detail_access"] == BIDNET_DETAIL_ACCESS
    assert first["source_url"].startswith("https://www.bidnetdirect.com/colorado/solicitations/open-bids/")
    assert page.next_url is None and page.next_page is None


def test_closed_list_rows_are_closed_and_an_awarded_row_is_awarded():
    page = read_bidnet_list_page(_denver(), CLOSED, "closed")

    assert len(page.records) == 25
    first = page.records[0]
    assert (first["source_bid_id"], first["solicitation_number"]) == ("0000436158", "0147A_2026")
    assert first["lifecycle_status"] == "closed"
    assert first["deadline_date"] == "09/23/2026"
    awarded = next(record for record in page.records if record["source_bid_id"] == "0000419153")
    assert awarded["lifecycle_status"] == "awarded"
    assert awarded["deadline_date"] == "05/08/2026"
    assert awarded["awarded_date"] == "07/09/2026"


def test_closed_list_links_the_next_page():
    assert bidnet_next_page(CLOSED) == (
        "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
        "/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER",
        2,
    )


def test_the_last_page_has_no_next_page():
    assert bidnet_next_page(_without_next_link(CLOSED)) == (None, None)


def test_a_group_list_next_link_with_a_path_page_number_is_followed():
    html = (
        '<div class="mets-page-navigation-control mets-page-navigation-next">'
        ' <a data-page-size="25" href="/colorado/solicitations/open-bids/page2" class="next">'
        "<span>Next</span></a></div>"
    )
    assert bidnet_next_page(html) == ("https://www.bidnetdirect.com/colorado/solicitations/open-bids/page2", 2)


def test_awarded_list_rows_carry_the_award_date_not_a_deadline():
    page = read_bidnet_list_page(_denver(), AWARDED, "awarded")

    first = page.records[0]
    assert (first["source_bid_id"], first["solicitation_number"]) == ("0000404383", "11189")
    assert first["lifecycle_status"] == "awarded"
    assert first["awarded_date"] == "09/15/2026"
    assert first["deadline_date"] is None
    assert first["published_date"] == "11/17/2025"


def test_markup_without_dated_span_classes_keeps_the_positional_dates():
    html = (
        '<table><tr class="mets-table-row"><td><a href="/private/supplier/solicitations/4512345/detail">'
        'Street sweeping</a></td><td><span class="date-value">09/01/2026</span></td>'
        '<td><span class="date-value">09/30/2026</span></td></tr></table>'
    )
    open_record = read_bidnet_list_page(_denver(), html, "open").records[0]
    awarded_record = read_bidnet_list_page(_denver(), html, "awarded").records[0]

    assert (open_record["published_date"], open_record["deadline_date"]) == ("09/01/2026", "09/30/2026")
    assert open_record["solicitation_number"] is None
    assert (awarded_record["deadline_date"], awarded_record["awarded_date"]) == (None, "09/30/2026")


@pytest.mark.parametrize(
    ("kind", "page", "expected"),
    [
        ("open", 1, DENVER_URL),
        (
            "closed",
            1,
            "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
            "/solicitations/closed-bids?selectedContent=BUYER",
        ),
        (
            "awarded",
            3,
            "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
            "/solicitations/awarded-bids?pageNumber=3&selectedContent=BUYER",
        ),
    ],
)
def test_list_url_for_each_kind_and_page(kind, page, expected):
    assert bidnet_list_url(DENVER_URL, kind, page) == expected


def test_list_url_from_a_root_alias_tenant():
    assert bidnet_list_url(
        "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids", "closed", 2
    ) == "https://www.bidnetdirect.com/city-of-aurora/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER"


@pytest.mark.parametrize(("kind", "page"), [("pending", 1), ("open", 0)])
def test_list_url_rejects_unknown_kinds_and_pages(kind, page):
    with pytest.raises(ValueError):
        bidnet_list_url(DENVER_URL, kind, page)


def test_parse_keeps_the_selected_list_kind_in_the_raw_payload():
    bids = parse_bidnet_list_html(_denver(), CLOSED, limit=100, list_kind="closed")

    assert len(bids) == 25
    assert bids[0]["raw_payload"]["lifecycle_status"] == "closed"
    assert bids[0]["raw_payload"]["solicitation_number"] == "0147A_2026"
    assert bids[0]["raw_payload"]["detail_access"] == BIDNET_DETAIL_ACCESS
```

In `crawler/tests/test_content_quality_empty_state.py`, extend the parametrized phrase list of `test_recognizes_every_contract_phrase`:

```python
@pytest.mark.parametrize(
    "phrase",
    [
        "There are no open bids at this time.",
        "There are no open solicitations posted.",
        "No solicitations are currently available.",
        "No solicitations available.",
        "No results found.",
        "There are currently no open opportunities.",
        "There are no closed bids at this time.",
        "There are no awarded bids at this time.",
    ],
)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_bidnet_list_pages.py tests/test_content_quality_empty_state.py`
Expected: FAIL — `ImportError: cannot import name 'BIDNET_DETAIL_ACCESS'` and the two new phrase cases fail.

- [ ] **Step 3: Implement the reader**

In `crawler/apsi_crawler/content_quality.py` replace `_EMPTY_LIST_RE`:

```python
_EMPTY_LIST_RE = re.compile(
    r"no open bids"
    r"|no closed bids"
    r"|no awarded bids"
    r"|no open solicitations"
    r"|no solicitations (?:are )?(?:currently )?available"
    r"|no results found"
    r"|there are currently no",
    re.I,
)
```

In `crawler/apsi_crawler/spiders/co_bidnet.py`:

1. Imports: add `from collections import namedtuple` (next to `import re`).
2. After `CO_BIDNET_URL = ...` add:

```python
BIDNET_ORIGIN = "https://www.bidnetdirect.com"

#: The three public tenant lists (verified 2026-09-24 on Denver): `open-bids` is the stored
#: base_url; `closed-bids` and `awarded-bids` are linked from every tenant page.
BIDNET_LIST_KINDS = ("open", "closed", "awarded")
_LIST_KIND_PATHS = {"open": "open-bids", "closed": "closed-bids", "awarded": "awarded-bids"}

#: Locked behind BidNet membership on every detail page (verified 2026-09-24): issuing
#: organization, description, bid documents and buyer contact. Carried on each record so the UI
#: can say so instead of rendering blanks -- we never log in to fetch them.
BIDNET_DETAIL_ACCESS = {"restricted": ["description", "documents", "contact"], "platform": "BidNet"}

BidnetListPage = namedtuple("BidnetListPage", ("records", "next_url", "next_page"))

_ROW_RE = re.compile(r'<tr[^>]+class="[^"]*mets-table-row[^"]*"[^>]*>(.*?)</tr>', re.I | re.S)
_LINK_RE = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S)
_SOL_NUM_RE = re.compile(r'class="sol-num"[^>]*>(.*?)</div>', re.I | re.S)
_REGION_RE = re.compile(r'class="sol-region-item"[^>]*>(.*?)</span>', re.I | re.S)
_PUBLISHED_RE = re.compile(r'class="sol-publication-date".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_CLOSING_RE = re.compile(r'class="sol-closing-date[^"]*".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_AWARDED_RE = re.compile(r'class="sol-award-date[^"]*".*?class="date-value"[^>]*>([^<]+)<', re.I | re.S)
_DATE_VALUE_RE = re.compile(r'class="date-value"[^>]*>([^<]+)</span>', re.I)
_BID_ID_RE = re.compile(r"/(\d{7,})(?:/|\?|$)")
# The last page keeps the `mets-page-navigation-next` wrapper but empties it.
_NEXT_BLOCK_RE = re.compile(r"mets-page-navigation-next[^>]*>(.*?)</div>", re.I | re.S)
_HREF_RE = re.compile(r'href="([^"]+)"', re.I)
_PAGE_NUMBER_RE = re.compile(r'data-page-number="(\d+)"', re.I)
_PAGE_PARAM_RE = re.compile(r"(?:[?&]pageNumber=|/page)(\d+)", re.I)
```

3. Replace `_records_from_html` with:

```python
def _match_text(pattern, text):
    match = pattern.search(text)
    return (_strip_tags(match.group(1)) or None) if match else None


def _lifecycle_for(list_kind, awarded_date):
    if list_kind == "open":
        return "open"
    # A closed-list row that was later awarded shows both dates (Denver 50018, 2026-09-24).
    return "awarded" if awarded_date or list_kind == "awarded" else "closed"


def _record_from_row(row_html, issuer_name, list_kind):
    link_match = _LINK_RE.search(row_html)
    if not link_match:
        return None
    href = link_match.group(1).replace("&amp;", "&")
    title = _strip_tags(link_match.group(2))
    dates = [value.strip() for value in _DATE_VALUE_RE.findall(row_html)]
    published = _match_text(_PUBLISHED_RE, row_html) or (dates[0] if dates else None)
    closing = _match_text(_CLOSING_RE, row_html)
    awarded = _match_text(_AWARDED_RE, row_html)
    if closing is None and awarded is None and len(dates) > 1:
        # Markup without the dated-span classes (trimmed pages, older fixtures): the second date is
        # the closing date on the open and closed lists and the award date on the awarded list.
        if list_kind == "awarded":
            awarded = dates[1]
        else:
            closing = dates[1]
    bid_id = _BID_ID_RE.search(href)
    return {
        "source_bid_id": bid_id.group(1) if bid_id else href,
        "title": title,
        "description": title,
        "published_date": published,
        "deadline_date": closing,
        "awarded_date": awarded,
        "solicitation_number": _match_text(_SOL_NUM_RE, row_html),
        "region": _match_text(_REGION_RE, row_html),
        "lifecycle_status": _lifecycle_for(list_kind, awarded),
        "list_kind": list_kind,
        "detail_access": {
            "restricted": list(BIDNET_DETAIL_ACCESS["restricted"]),
            "platform": BIDNET_DETAIL_ACCESS["platform"],
        },
        "issuer_name": issuer_name,
        "source_url": absolute_url(BIDNET_ORIGIN, href),
        "attachments": [],
    }


def _records_from_html(html, issuer_name, list_kind="open"):
    records = []
    for match in _ROW_RE.finditer(html or ""):
        record = _record_from_row(match.group(1), issuer_name, list_kind)
        if record is not None:
            records.append(record)
    return records


def bidnet_next_page(html):
    """`(absolute next-page URL, page number)` from the pagination block, `(None, None)` on the last page."""
    block = _NEXT_BLOCK_RE.search(html or "")
    if not block:
        return None, None
    href = _HREF_RE.search(block.group(1))
    if not href:
        return None, None
    url = absolute_url(BIDNET_ORIGIN, unescape(href.group(1)))
    number = _PAGE_NUMBER_RE.search(block.group(1)) or _PAGE_PARAM_RE.search(url)
    return url, int(number.group(1)) if number else None


def read_bidnet_list_page(source, html, list_kind="open"):
    """One fetched BidNet list page: its raw records and where the next page is."""
    next_url, next_page = bidnet_next_page(html)
    return BidnetListPage(_records_from_html(html, source.source_label, list_kind), next_url, next_page)


def bidnet_list_url(base_url, list_kind="open", page=1):
    """The tenant list URL for a list kind and page, derived from the tenant's stored open-bids URL.

    Page 1 of the open list is the stored URL itself, byte for byte, so existing sources fetch
    exactly what they always fetched. Other pages use BidNet's own `pageNumber` link format
    (verified on Denver's closed and awarded lists, 2026-09-24).
    """
    if list_kind not in _LIST_KIND_PATHS:
        raise ValueError("list_kind must be one of: {0}".format(", ".join(BIDNET_LIST_KINDS)))
    page = int(page)
    if page < 1:
        raise ValueError("page must be 1 or greater")
    if list_kind == "open" and page == 1:
        return base_url
    root = re.split(r"/solicitations(?:/|\?|$)", base_url, maxsplit=1)[0].rstrip("/")
    params = (["pageNumber={0}".format(page)] if page > 1 else []) + ["selectedContent=BUYER"]
    return "{0}/solicitations/{1}?{2}".format(root, _LIST_KIND_PATHS[list_kind], "&".join(params))
```

4. Change `parse_bidnet_list_html`:

```python
def parse_bidnet_list_html(source, html, query=None, limit=25, issuer_name=None, list_kind="open"):
    """Parse an already-fetched BidNet list page (also the scrapling path's fallback parser)."""
    records = _records_from_html(html, issuer_name or source.source_label, list_kind)
    if not records:
        empty = detect_empty_list(html, source.source_label)
        if empty["detected"]:
            # Legitimate "nothing listed right now" — the CLI decides whether the tenant proof is
            # strong enough to call this a zero-row success.
            raise VerifiedEmptyListError(empty["marker"], empty["tenant_confirmed"], method="adapter")
        raise CoBidnetError(f"{source.id} BidNet page did not contain open solicitations")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    if limit is not None:
        records = records[: int(limit)]
    return [normalize_state_opportunity(record, source) for record in records]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_bidnet_list_pages.py tests/test_content_quality_empty_state.py tests/test_fetch_task_cli.py tests/test_list_extraction.py tests/test_adapter_registry.py`
Expected: PASS (existing BidNet tests keep passing: records gained keys, nothing was removed).

- [ ] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/spiders/co_bidnet.py crawler/apsi_crawler/content_quality.py crawler/tests/test_bidnet_list_pages.py crawler/tests/test_content_quality_empty_state.py
git commit -m "feat(crawler): read BidNet list numbers, lifecycle and next page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Normalizer passes the lifecycle fields through

**Files:**
- Modify: `crawler/apsi_crawler/normalizers/state_bids.py`
- Modify: `crawler/tests/test_state_normalizers.py` (append)

**Interfaces:**
- Consumes: raw records from Task 1 (`lifecycle_status`, `awarded_date`, `solicitation_number`).
- Produces: every normalized bid dict gains `lifecycle_status` (`open`/`closed`/`awarded`, default `open`), `awarded_date` (str|None), `solicitation_number` (str|None); `is_active` is `1` exactly when `lifecycle_status == "open"`.

- [ ] **Step 1: Write the failing tests**

Append to `crawler/tests/test_state_normalizers.py`:

```python
def test_lifecycle_fields_default_to_an_open_bid_without_a_number():
    bid = normalize_state_opportunity({"id": "X-1", "title": "Road repair"}, get_source("ca_caleprocure"))

    assert bid["lifecycle_status"] == "open"
    assert bid["is_active"] == 1
    assert bid["awarded_date"] is None
    assert bid["solicitation_number"] is None


def test_lifecycle_fields_pass_through_and_drive_is_active():
    raw = {
        "id": "0000419153",
        "title": "Hearing Officers",
        "lifecycle_status": "awarded",
        "awarded_date": "07/09/2026",
        "solicitation_number": " 50018 ",
    }
    bid = normalize_state_opportunity(raw, get_source("ca_caleprocure"))

    assert bid["lifecycle_status"] == "awarded"
    assert bid["is_active"] == 0
    assert bid["awarded_date"] == "07/09/2026"
    assert bid["solicitation_number"] == "50018"


def test_an_unknown_lifecycle_value_is_treated_as_open():
    bid = normalize_state_opportunity(
        {"id": "X-2", "title": "Paving", "lifecycle_status": "pending"}, get_source("ca_caleprocure")
    )
    assert (bid["lifecycle_status"], bid["is_active"]) == ("open", 1)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_state_normalizers.py`
Expected: FAIL with `KeyError: 'lifecycle_status'`.

- [ ] **Step 3: Implement**

In `crawler/apsi_crawler/normalizers/state_bids.py` add after `_first_present`:

```python
_LIFECYCLE_STATUSES = ("open", "closed", "awarded")


def _lifecycle_status(raw):
    value = (_clean_text(raw.get("lifecycle_status")) or "").lower()
    return value if value in _LIFECYCLE_STATUSES else "open"
```

In `normalize_state_opportunity`, compute `lifecycle_status = _lifecycle_status(raw)` before the `return`, replace `"is_active": 1,` with `"is_active": 1 if lifecycle_status == "open" else 0,` and add, after `"source_url": source_url,`:

```python
        "lifecycle_status": lifecycle_status,
        "awarded_date": _first_present(raw, ("awarded_date",)),
        "solicitation_number": _first_present(raw, ("solicitation_number",)),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/normalizers/state_bids.py crawler/tests/test_state_normalizers.py
git commit -m "feat(crawler): carry bid lifecycle, award date and number through normalization

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Paginated list stage

**Files:**
- Modify: `crawler/apsi_crawler/errors.py`
- Modify: `crawler/apsi_crawler/adapters/registry.py`
- Modify: `crawler/apsi_crawler/list_extraction.py`
- Create: `crawler/tests/test_list_pagination.py`

**Interfaces:**
- Consumes: Task 1 (`read_bidnet_list_page`, `bidnet_list_url`, `parse_bidnet_list_html`), Task 2 (normalized lifecycle fields).
- Produces:
  - `VerifiedEmptyListError(marker, tenant_confirmed, method="adapter", message=None, pagination=None)`; attribute `.pagination` (dict|None).
  - `ListHtmlAdapter` fields `(name, list_url, fetch_list_html, parse_list_html, page_url, page_reader)` — the last two default to `None`; `page_url(source, list_kind, page) -> str`, `page_reader(source, html, list_kind) -> BidnetListPage`.
  - `list_extraction.LIST_KINDS`, `DEFAULT_LIST_PAGES = 4`, `MAX_LIST_PAGES = 50`
  - `resolve_pagination_request(payload) -> {"list_kind", "start_page", "max_pages", "stop_before": date|None}` (ValueError for bad kind/date)
  - `run_paginated_list_extraction(source, list_adapter, config, request, query=None, limit=None, session=None, extractor=None, renderer=None, timeout=30) -> (bids, list_stats, pagination)` where `pagination = {"list_kind", "start_page", "pages_fetched", "next_page", "stopped_reason", "requests_made", "complete"}` and `stopped_reason ∈ {"exhausted", "max_pages", "window", "limit"}`.
  - `ListPageReadError(Exception)`.

- [ ] **Step 1: Write the failing tests**

Create `crawler/tests/test_list_pagination.py`:

```python
"""Paged list stage (spec 2026-09-24 §5.2/§5.3): one fetch per page, Scrapling main path."""

import re
from datetime import date
from pathlib import Path

import pytest

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.list_extraction import (
    ListExtractionError,
    resolve_list_extraction_config,
    resolve_pagination_request,
    run_paginated_list_extraction,
)

FIXTURES = Path(__file__).parent / "fixtures"
OPEN = (FIXTURES / "bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
CLOSED = (FIXTURES / "bidnet_denver_closed_bids_2026_09_24.html").read_text(encoding="utf-8")
ERIE = (FIXTURES / "bidnet_erie_no_open_bids.html").read_text(encoding="utf-8")
DENVER = "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
PAGE_TWO = DENVER + "/solicitations/closed-bids?pageNumber=2&selectedContent=BUYER"


def _source(label="City and County of Denver General Services Purchasing (BidNet)", base_url=DENVER + "/solicitations/open-bids"):
    return TaskSource(
        id="bidnet_co_denver", name=label, source_label=label, jurisdiction="county",
        state_code="CO", base_url=base_url, fetch_config={"base_url": base_url},
    )


class PagedFetcher:
    """Serves saved pages by URL through the real BidNet list adapter and records every request."""

    def __init__(self, pages):
        self.pages = pages
        self.urls = []

    def adapter(self):
        return registry.BIDNET_LIST_HTML_ADAPTER._replace(fetch_list_html=self.fetch)

    def fetch(self, source, url, session=None, timeout=30):
        self.urls.append(url)
        return self.pages[url], url, 200


def _closed_two_pages():
    # Page 2 is the saved open page: it has no next link, so it is the last page.
    return PagedFetcher({DENVER + "/solicitations/closed-bids?selectedContent=BUYER": CLOSED, PAGE_TWO: OPEN})


def _adapter_config():
    return resolve_list_extraction_config({}, "", True)


def _scrapling_config():
    return resolve_list_extraction_config({}, "http://extractor.test", True)


def _request(**overrides):
    request = {"list_kind": "closed", "start_page": 1, "max_pages": 4, "stop_before": None}
    request.update(overrides)
    return request


class Extractor:
    def __init__(self, items_for=None, error=None):
        self.items_for = items_for
        self.error = error

    def extract_list(self, html, url, item_selector=None, selectors=None, max_items=200, timeout=None):
        if self.error:
            raise self.error
        return {"items": self.items_for(html), "diagnostics": {"title": "heuristic"}, "empty_state": {"detected": False, "marker": None}}


def _sidecar_items(html, drop=()):
    items = []
    for match in re.finditer(r'href="([^"]*/(\d{7,})\?[^"]*)"[^>]*>(.*?)</a>', html, re.S):
        if match.group(2) in drop:
            continue
        items.append({"title": re.sub(r"<[^>]+>", "", match.group(3)).strip(), "url": "https://www.bidnetdirect.com" + match.group(1).replace("&amp;", "&"),
                      "published_date": None, "deadline_date": None, "source_bid_id": match.group(2), "issuer_name": None})
    return items


def test_follows_next_links_until_the_last_page():
    fetcher = _closed_two_pages()

    bids, stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request())

    assert fetcher.urls == [DENVER + "/solicitations/closed-bids?selectedContent=BUYER", PAGE_TWO]
    assert len(bids) == 31
    assert stats == {"method": "adapter", "items": 31, "diagnostics": {}, "rendered": False, "extractor": None, "fallback_reason": None}
    assert pagination == {
        "list_kind": "closed", "start_page": 1, "pages_fetched": 2, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 2, "complete": True,
    }
    assert bids[0]["solicitation_number"] == "0147A_2026"
    assert bids[0]["lifecycle_status"] == "closed"


def test_stops_at_max_pages_and_reports_where_to_resume():
    fetcher = _closed_two_pages()

    bids, _stats, pagination = run_paginated_list_extraction(_source(), fetcher.adapter(), _adapter_config(), _request(max_pages=1))

    assert len(fetcher.urls) == 1 and len(bids) == 25
    assert (pagination["stopped_reason"], pagination["next_page"], pagination["complete"]) == ("max_pages", 2, False)


def test_stop_before_ends_the_walk_once_a_whole_page_is_older():
    fetcher = _closed_two_pages()
    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(stop_before=date(2026, 10, 1))
    )
    assert (pagination["stopped_reason"], pagination["pages_fetched"], pagination["complete"]) == ("window", 1, False)

    fetcher = _closed_two_pages()
    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), fetcher.adapter(), _adapter_config(), _request(stop_before=date(2026, 1, 1))
    )
    assert (pagination["stopped_reason"], pagination["pages_fetched"]) == ("exhausted", 2)


@pytest.mark.parametrize(("query", "limit"), [(None, 10), ("guardrails", None)])
def test_limit_or_query_makes_the_run_incomplete(query, limit):
    bids, _stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _adapter_config(), _request(), query=query, limit=limit
    )
    assert pagination["complete"] is False
    assert len(bids) == (10 if limit else 1)


def test_scrapling_rows_get_the_reader_number_and_lifecycle():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(), extractor=Extractor(_sidecar_items)
    )

    assert stats["method"] == "scrapling" and stats["extractor"] == "http://extractor.test"
    assert pagination["complete"] is True
    first = next(bid for bid in bids if bid["source_bid_id"] == "0000436158")
    assert (first["solicitation_number"], first["lifecycle_status"], first["deadline_date"]) == ("0147A_2026", "closed", "09/23/2026")


def test_a_sidecar_that_misses_a_row_makes_the_run_incomplete():
    extractor = Extractor(lambda html: _sidecar_items(html, drop=("0000436158",)))

    _bids, _stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(), extractor=extractor
    )
    assert pagination["complete"] is False


def test_sidecar_failure_falls_back_to_the_reader_rows_per_page():
    bids, stats, pagination = run_paginated_list_extraction(
        _source(), _closed_two_pages().adapter(), _scrapling_config(), _request(),
        extractor=Extractor(error=ListExtractionError("extractor request failed: refused")),
    )
    assert stats["method"] == "adapter_fallback"
    assert stats["fallback_reason"].startswith("extractor_unreachable")
    assert len(bids) == 31 and pagination["complete"] is True


def test_an_empty_first_page_is_a_verified_empty_list_with_complete_pagination():
    label = "Erie County, NY (BidNet)"
    fetcher = PagedFetcher({"https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids": ERIE})

    with pytest.raises(VerifiedEmptyListError) as error:
        run_paginated_list_extraction(
            _source(label, "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"),
            fetcher.adapter(), _adapter_config(), _request(list_kind="open"),
        )

    assert error.value.tenant_confirmed is True
    assert error.value.method == "adapter"
    assert error.value.pagination == {
        "list_kind": "open", "start_page": 1, "pages_fetched": 1, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 1, "complete": True,
    }


def test_resolve_pagination_request_defaults_clamps_and_rejects():
    assert resolve_pagination_request({}) == {"list_kind": "open", "start_page": 1, "max_pages": 4, "stop_before": None}
    assert resolve_pagination_request({"max_pages": 999, "start_page": 0})["max_pages"] == 50
    assert resolve_pagination_request({"start_page": 0})["start_page"] == 1
    assert resolve_pagination_request({"stop_before": "2024-09-24"})["stop_before"] == date(2024, 9, 24)
    with pytest.raises(ValueError):
        resolve_pagination_request({"list_kind": "pending"})
    with pytest.raises(ValueError):
        resolve_pagination_request({"stop_before": "09/24/2024"})


def test_only_the_bidnet_list_adapter_is_paginated():
    assert registry.BIDNET_LIST_HTML_ADAPTER.page_reader is not None
    assert registry.GENERIC_LIST_HTML_ADAPTER.page_reader is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_list_pagination.py`
Expected: FAIL — `ImportError: cannot import name 'resolve_pagination_request'`.

- [ ] **Step 3: Implement**

`crawler/apsi_crawler/errors.py` — extend `VerifiedEmptyListError.__init__`:

```python
    def __init__(self, marker, tenant_confirmed, method="adapter", message=None, pagination=None):
        super().__init__(
            message
            or "list page reports an empty result ({0}; tenant_confirmed={1})".format(marker, tenant_confirmed)
        )
        self.marker = marker
        self.tenant_confirmed = bool(tenant_confirmed)
        self.method = method
        # Set by the paged list stage: an empty first page is a complete, one-page walk.
        self.pagination = pagination
```

`crawler/apsi_crawler/adapters/registry.py`:

```python
from apsi_crawler.spiders.co_bidnet import (
    bidnet_list_url,
    fetch_bidnet_list_html,
    fetch_bidnet_opportunities,
    parse_bidnet_list_html,
    read_bidnet_list_page,
)
...
# `page_url` / `page_reader` are set only for adapters that can read their own pagination; the
# paged list stage (list_extraction.run_paginated_list_extraction) runs exactly for those.
ListHtmlAdapter = namedtuple(
    "ListHtmlAdapter",
    ("name", "list_url", "fetch_list_html", "parse_list_html", "page_url", "page_reader"),
    defaults=(None, None),
)
...
def _bidnet_page_url(source, list_kind, page):
    return bidnet_list_url(_bidnet_list_url(source), list_kind, page)


BIDNET_LIST_HTML_ADAPTER = ListHtmlAdapter(
    "bidnet",
    _bidnet_list_url,
    fetch_bidnet_list_html,
    parse_bidnet_list_html,
    _bidnet_page_url,
    read_bidnet_list_page,
)
```

`crawler/apsi_crawler/list_extraction.py`:

1. Imports: add `from datetime import date, datetime`; import `detect_empty_list` is not needed.
2. After `_DIAGNOSTIC_VALUES` add:

```python
LIST_KINDS = ("open", "closed", "awarded")
DEFAULT_LIST_PAGES = 4
MAX_LIST_PAGES = 50
_MAX_START_PAGE = 100000
_READER_FIELDS = ("solicitation_number", "region", "lifecycle_status", "list_kind", "detail_access")


class ListPageReadError(Exception):
    """The page reader and the adapter parser disagree about whether a page has rows."""
```

3. Give `_fetch_list_html` an explicit URL:

```python
def _fetch_list_html(source, list_adapter, config, session, renderer, timeout, url=None):
    url = url or list_adapter.list_url(source)
```
(the rest of the function is unchanged).

4. Append:

```python
def _iso_date(value):
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _list_date(record, list_kind):
    """The date a list is ordered by: award date on the awarded list, closing date otherwise."""
    value = record.get("awarded_date" if list_kind == "awarded" else "deadline_date")
    try:
        return datetime.strptime(str(value).strip(), "%m/%d/%Y").date()
    except (TypeError, ValueError):
        return None


def resolve_pagination_request(payload):
    """`list_kind` / `start_page` / `max_pages` / `stop_before` from a fetch-task payload.

    Numbers clamp like every other knob here; a list kind or date the crawler cannot act on
    raises ValueError, which fetch-task reports as a failed run instead of guessing.
    """
    payload = payload or {}
    list_kind = payload.get("list_kind") or "open"
    if list_kind not in LIST_KINDS:
        raise ValueError("list_kind must be one of: {0}".format(", ".join(LIST_KINDS)))
    stop_before = payload.get("stop_before")
    if stop_before is not None:
        stop_before = _iso_date(stop_before)
        if stop_before is None:
            raise ValueError("stop_before must be an ISO yyyy-mm-dd date")
    return {
        "list_kind": list_kind,
        "start_page": _clamp(payload.get("start_page"), 1, _MAX_START_PAGE, 1, int),
        "max_pages": _clamp(payload.get("max_pages"), 1, MAX_LIST_PAGES, DEFAULT_LIST_PAGES, int),
        "stop_before": stop_before,
    }


def _overlay_reader_fields(record, reader_record):
    """Sidecar row + what only the adapter's reader knows about the same bid on the same page."""
    if not reader_record:
        return record
    merged = dict(record)
    for field in _READER_FIELDS:
        if reader_record.get(field) is not None:
            merged[field] = reader_record[field]
    # The reader knows which date is which (the awarded list's second date is an award date,
    # which generic heuristics read as a deadline).
    merged["deadline_date"] = reader_record.get("deadline_date")
    merged["awarded_date"] = reader_record.get("awarded_date")
    if not merged.get("published_date"):
        merged["published_date"] = reader_record.get("published_date")
    return merged


def _page_bids(source, config, extractor, html, final_url, reading):
    """Rows of one fetched page: `(bids, method, diagnostics, fallback_reason)`."""
    if config["mode"] != "scrapling":
        return [normalize_state_opportunity(record, source) for record in reading.records], "adapter", {}, None
    by_id = {record["source_bid_id"]: record for record in reading.records}
    try:
        payload = validate_list_extraction(
            extractor.extract_list(
                html,
                final_url,
                item_selector=config["item_selector"],
                selectors=config["selectors"] or None,
                max_items=config["max_items"],
            )
        )
        records = [record for record in (_record_from_item(item, source) for item in payload["items"][: config["max_items"]]) if record]
        if records:
            merged = [_overlay_reader_fields(record, by_id.get(record["source_bid_id"])) for record in records]
            return [normalize_state_opportunity(record, source) for record in merged], "scrapling", payload.get("diagnostics", {}), None
        reason = "no_items: extractor returned no usable rows"
    except ListExtractionError as error:
        reason = "{0}: {1}".format(getattr(error, "reason", "extractor_unreachable"), error)
    return [normalize_state_opportunity(record, source) for record in reading.records], "adapter_fallback", {}, reason


def _raise_empty_first_page(source, list_adapter, html, config, request):
    """Page 1 had no rows at all: the adapter's parser decides, as the single-page stage does."""
    pagination = {
        "list_kind": request["list_kind"], "start_page": request["start_page"], "pages_fetched": 1,
        "next_page": None, "stopped_reason": "exhausted", "requests_made": 1, "complete": True,
    }
    method = "scrapling" if config["mode"] == "scrapling" else "adapter"
    try:
        list_adapter.parse_list_html(source, html, query=None, limit=1)
    except VerifiedEmptyListError as error:
        raise VerifiedEmptyListError(error.marker, error.tenant_confirmed, method=method, pagination=pagination) from error
    raise ListPageReadError("{0}: the page reader found no rows the adapter parser could read".format(source.id))


def run_paginated_list_extraction(
    source,
    list_adapter,
    config,
    request,
    query=None,
    limit=None,
    session=None,
    extractor=None,
    renderer=None,
    timeout=30,
):
    """Page through one list of an adapter that can read its own pagination.

    Returns `(bids, metadata.listExtraction, metadata.pagination)`. Each page is fetched exactly
    once. Rows come from the sidecar in scrapling mode (the adapter's parser is the per-page
    fallback) and from the adapter's parser otherwise; the adapter's page reader supplies the
    number, the lifecycle and the next page. `complete` is true only when the walk reached a page
    without a next link, nothing was cut by `limit`/`query`, and every row the reader saw is in
    the result -- the one condition under which the importers may close delisted bids.
    """
    list_kind = request["list_kind"]
    extractor_url = config.get("extractor_url")
    if config["mode"] == "scrapling" and extractor is None:
        extractor = ListExtractorClient(extractor_url)

    url = list_adapter.page_url(source, list_kind, request["start_page"])
    page_number = request["start_page"]
    bids, methods = [], []
    diagnostics, fallback_reason = None, None
    covered, rendered, pages_fetched = True, False, 0
    stopped_reason, next_page = "exhausted", None

    while True:
        html, final_url, page_rendered = _fetch_list_html(source, list_adapter, config, session, renderer, timeout, url=url)
        pages_fetched += 1
        rendered = rendered or page_rendered
        reading = list_adapter.page_reader(source, html, list_kind)
        page_bids, method, page_diagnostics, reason = _page_bids(source, config, extractor, html, final_url, reading)
        if pages_fetched == 1 and not page_bids and not reading.records:
            _raise_empty_first_page(source, list_adapter, html, config, request)

        methods.append(method)
        diagnostics = page_diagnostics if diagnostics is None else diagnostics
        fallback_reason = fallback_reason or reason
        page_ids = {bid["source_bid_id"] for bid in page_bids}
        if any(record["source_bid_id"] not in page_ids for record in reading.records):
            covered = False
        bids.extend(page_bids)

        stop_before = request["stop_before"]
        if stop_before and reading.records and all(
            (_list_date(record, list_kind) or date.max) < stop_before for record in reading.records
        ):
            stopped_reason = "window"
            break
        if reading.next_url is None:
            break
        if pages_fetched >= request["max_pages"]:
            stopped_reason = "max_pages"
            next_page = reading.next_page or page_number + 1
            break
        url = reading.next_url
        page_number = reading.next_page or page_number + 1

    truncated = False
    if query:
        query_text = query.lower()
        bids = [bid for bid in bids if query_text in " ".join(str(value) for value in bid.values()).lower()]
        truncated = True
    if limit is not None and len(bids) > int(limit):
        bids = bids[: int(limit)]
        truncated = True
        stopped_reason = "limit"

    overall = "adapter_fallback" if "adapter_fallback" in methods else methods[0]
    stats = _stats(
        overall,
        len(bids),
        diagnostics or {},
        rendered,
        extractor_url if config["mode"] == "scrapling" else None,
        fallback_reason,
    )
    pagination = {
        "list_kind": list_kind,
        "start_page": request["start_page"],
        "pages_fetched": pages_fetched,
        "next_page": next_page,
        "stopped_reason": stopped_reason,
        "requests_made": pages_fetched,
        "complete": stopped_reason == "exhausted" and covered and not truncated,
    }
    return bids, stats, pagination
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q`
Expected: PASS (all suites, including `test_list_extraction.py` — the single-page path is untouched).

- [ ] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/errors.py crawler/apsi_crawler/adapters/registry.py crawler/apsi_crawler/list_extraction.py crawler/tests/test_list_pagination.py
git commit -m "feat(crawler): page through BidNet lists once per page on the Scrapling main path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `fetch-task` reports pagination

**Files:**
- Modify: `crawler/apsi_crawler/cli.py:314-452` (`run_list_stage`, `fetch_task`)
- Modify: `crawler/tests/test_fetch_task_cli.py` (append)

**Interfaces:**
- Consumes: Task 3 (`resolve_pagination_request`, `run_paginated_list_extraction`, `VerifiedEmptyListError.pagination`).
- Produces (fetch-task JSON contract, spec §5.3): request keys `list_kind`, `start_page`, `max_pages`, `stop_before`, nullable `limit`; result `metadata.pagination` = `{list_kind, start_page, pages_fetched, next_page, stopped_reason, requests_made, complete}` — present only for paged adapters. `complete` is forced `false` when a date window was applied; `requests_made` includes enrichment detail fetches.

- [ ] **Step 1: Write the failing tests**

Append to `crawler/tests/test_fetch_task_cli.py`:

```python
DENVER_OPEN = Path(__file__).parent / "fixtures" / "bidnet_denver_open_bids_2026_09_24.html"
DENVER_TASK = {
    "task_id": "tsk_denver",
    "source_id": "bidnet_co_denver",
    "label": "City and County of Denver General Services Purchasing (BidNet)",
    "state_code": "CO",
    "provider_family": "bidnet",
    "fetch_config": {
        "base_url": "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing/solicitations/open-bids"
    },
    "limit": None,
}


def test_bidnet_tasks_report_complete_pagination_and_lifecycle_fields(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, DENVER_OPEN.read_text(encoding="utf-8"))

    exit_code, result = _run(DENVER_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["metadata"]["pagination"] == {
        "list_kind": "open", "start_page": 1, "pages_fetched": 1, "next_page": None,
        "stopped_reason": "exhausted", "requests_made": 1, "complete": True,
    }
    assert len(result["bids"]) == 6
    first = result["bids"][0]
    assert (first["solicitation_number"], first["lifecycle_status"], first["is_active"]) == ("11205A", "open", 1)
    assert first["raw_payload"]["detail_access"]["platform"] == "BidNet"


def test_a_date_window_makes_a_bidnet_run_incomplete(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, DENVER_OPEN.read_text(encoding="utf-8"))

    _code, result = _run(dict(DENVER_TASK, date_range={"from": "2026-09-01", "to": None}), monkeypatch, capsys)

    assert result["metadata"]["pagination"]["complete"] is False


def test_an_explicit_limit_below_the_row_count_makes_the_run_incomplete(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, DENVER_OPEN.read_text(encoding="utf-8"))

    _code, result = _run(dict(DENVER_TASK, limit=3), monkeypatch, capsys)

    assert len(result["bids"]) == 3
    assert result["metadata"]["pagination"]["complete"] is False
    assert result["metadata"]["pagination"]["stopped_reason"] == "limit"


def test_a_verified_empty_bidnet_page_reports_complete_pagination(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, ERIE_FIXTURE.read_text(encoding="utf-8"))

    _code, result = _run(ERIE_TASK, monkeypatch, capsys)

    assert result["status"] == "success"
    assert result["metadata"]["pagination"]["complete"] is True


def test_an_unknown_list_kind_fails_the_task(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, DENVER_OPEN.read_text(encoding="utf-8"))

    exit_code, result = _run(dict(DENVER_TASK, list_kind="pending"), monkeypatch, capsys)

    assert exit_code == 1
    assert result["errorCode"] == "ValueError"


def test_non_paged_sources_keep_the_default_limit_and_report_no_pagination(monkeypatch, capsys):
    seen = []

    def adapter(source, query=None, limit=25, **kwargs):
        seen.append(limit)
        return [{"id": f"{source.id}:1", "title": "Road Repair", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "plain_limit_source", adapter)

    _code, result = _run(
        {"task_id": "tsk_pl", "source_id": "plain_limit_source", "label": "Plain", "state_code": "CA", "fetch_config": {}, "limit": None},
        monkeypatch,
        capsys,
    )

    assert seen == [25]
    assert "pagination" not in result["metadata"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_fetch_task_cli.py`
Expected: FAIL — the new tests find no `pagination` key; `seen == [25]` fails because `int(None or 25)` is already 25 but `"pagination"`/`limit=3` assertions fail.

- [ ] **Step 3: Implement**

In `crawler/apsi_crawler/cli.py`:

1. Import: extend the `apsi_crawler.list_extraction` import with `resolve_pagination_request` and `run_paginated_list_extraction`.
2. Replace `run_list_stage`:

```python
def run_list_stage(source, adapter, payload, query, limit):
    """Produce the list-stage bids, `metadata.listExtraction` and (paged adapters) `metadata.pagination`.

    Scrapling is the MAIN path whenever the sidecar is configured and the adapter can hand over
    raw list HTML; otherwise (and on any sidecar problem) the adapter's own parser runs. Paged
    adapters (BidNet) walk the list page by page on the same rule, one request per page.
    """
    fetch_config = payload.get("fetch_config")
    list_adapter = resolve_list_html_adapter(source.id, payload.get("provider_family"))
    config = resolve_list_extraction_config(
        fetch_config,
        os.environ.get("SCRAPLING_EXTRACTOR_URL", "").strip(),
        list_adapter is not None,
    )
    if list_adapter is not None and list_adapter.page_reader is not None:
        request = resolve_pagination_request(payload)
        return run_paginated_list_extraction(source, list_adapter, config, request, query=query, limit=limit)

    single_page_limit = limit if limit is not None else 25
    if config["mode"] != "scrapling":
        bids = adapter(source, query=query, limit=single_page_limit)
        return bids, _adapter_list_stats(bids), None

    bids, stats = run_list_extraction(source, list_adapter, config, query=query, limit=single_page_limit)
    return bids, stats, None
```

3. In `fetch_task` replace the `limit` line:

```python
    raw_limit = payload.get("limit")
    limit = int(raw_limit) if raw_limit not in (None, "") else None
```

4. In the empty-state branch, after `metadata["emptyState"] = error.as_metadata()` add:

```python
            if error.pagination is not None:
                metadata["pagination"] = dict(error.pagination)
```

5. Replace `bids, list_stats = run_list_stage(source, adapter, payload, query, limit)` with `bids, list_stats, pagination = run_list_stage(source, adapter, payload, query, limit)`.

6. After `if date_filter_stats is not None: metadata["dateFilter"] = date_filter_stats` add:

```python
        if pagination is not None:
            # A date window drops rows the walk did see, so the run can no longer prove which
            # open bids disappeared; enrichment detail fetches hit the same platform budget.
            if date_filter_stats is not None:
                pagination["complete"] = False
            pagination["requests_made"] += int(enrichment_stats.get("attempted") or 0)
            metadata["pagination"] = pagination
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q`
Expected: PASS (all suites; the four existing BidNet fetch-task tests still pass unchanged).

- [ ] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/cli.py crawler/tests/test_fetch_task_cli.py
git commit -m "feat(crawler): report list pagination and completeness from fetch-task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lifecycle columns and shared lifecycle type

**Files:**
- Create: `frontend/src/lib/bid-lifecycle.ts`, `frontend/src/lib/bid-lifecycle.test.ts`
- Modify: `frontend/src/server/db/migrate.ts` (bids + data_sources CREATE TABLE in the first block; `addBidColumn` / `addDataSourceColumn` calls; backfill)
- Modify: `frontend/src/server/db/schema.ts` (bids ~line 489, dataSources ~line 1375)
- Modify: `frontend/src/server/db/mysql.ts` (`mysqlColumnMigrations`, new `mysqlDataMigrationStatements`, `runMysqlMigrations`)
- Modify: `frontend/src/server/db/schema.test.ts`, `frontend/src/server/db/mysql.test.ts` (append)

**Interfaces:**
- Produces:
  - `BID_LIFECYCLE_STATUSES`, `type BidLifecycleStatus = "open" | "closed" | "awarded"`, `bidLifecycleStatusOf(value: unknown): BidLifecycleStatus | null` in `@/lib/bid-lifecycle`.
  - Columns `bids.lifecycle_status` (TEXT NOT NULL DEFAULT 'open'), `bids.awarded_date` (TEXT), `bids.solicitation_number` (TEXT), `data_sources.consecutive_empty_runs` (INTEGER NOT NULL DEFAULT 0); Drizzle props `lifecycleStatus`, `awardedDate`, `solicitationNumber`, `consecutiveEmptyRuns`.
  - `mysqlDataMigrationStatements(): string[]` exported from `@/server/db/mysql`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/bid-lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BID_LIFECYCLE_STATUSES, bidLifecycleStatusOf } from "./bid-lifecycle";

describe("bidLifecycleStatusOf", () => {
  it("accepts exactly the three lifecycle statuses", () => {
    expect(BID_LIFECYCLE_STATUSES).toEqual(["open", "closed", "awarded"]);
    for (const status of BID_LIFECYCLE_STATUSES) expect(bidLifecycleStatusOf(status)).toBe(status);
  });

  it("rejects anything else", () => {
    for (const value of ["", "Open", "pending", null, undefined, 1]) expect(bidLifecycleStatusOf(value)).toBeNull();
  });
});
```

Append to `frontend/src/server/db/schema.test.ts` (it already imports `createTestDatabase`, `runMigrations`, `describe/it/expect`):

```ts
describe("bid lifecycle migration (2026-09-24 phase 1)", () => {
  it("adds the lifecycle columns to bids and the empty-run counter to data_sources", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const bidColumns = testDb.db.$client.prepare("PRAGMA table_info(bids)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      const lifecycle = bidColumns.find((column) => column.name === "lifecycle_status");
      expect(lifecycle).toMatchObject({ notnull: 1, dflt_value: "'open'" });
      expect(bidColumns.map((column) => column.name)).toEqual(expect.arrayContaining(["awarded_date", "solicitation_number"]));

      const sourceColumns = testDb.db.$client.prepare("PRAGMA table_info(data_sources)").all() as Array<{ name: string; dflt_value: string | null; notnull: number }>;
      expect(sourceColumns.find((column) => column.name === "consecutive_empty_runs")).toMatchObject({ notnull: 1, dflt_value: "0" });
    } finally {
      await testDb.cleanup();
    }
  });

  it("closes inactive rows left open by an older database, idempotently", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const now = "2026-09-24T00:00:00.000Z";
      testDb.db.$client.prepare(`
        INSERT INTO bids (id, source, source_bid_id, dedupe_key, title, description, issuer_name, issuer_type,
          state_code, source_url, is_active, lifecycle_status, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES ('s:1', 'S', '1', 's:1', 'T', '', 'I', 'state', 'CO', 'https://x', 0, 'open', ?, ?, ?, ?)
      `).run(now, now, now, now);

      runMigrations(testDb.db);
      runMigrations(testDb.db);

      const row = testDb.db.$client.prepare("SELECT lifecycle_status AS status FROM bids WHERE id = 's:1'").get() as { status: string };
      expect(row.status).toBe("closed");
    } finally {
      await testDb.cleanup();
    }
  });
});
```

Append to `frontend/src/server/db/mysql.test.ts` (add `mysqlDataMigrationStatements` to its import from `./mysql`):

```ts
describe("mysql migrations cover the bid lifecycle columns (2026-09-24 phase 1)", () => {
  it("adds the lifecycle and empty-run columns to existing databases", () => {
    const joined = mysqlColumnMigrationStatements().join("\n");
    expect(joined).toContain("bids ADD COLUMN lifecycle_status LONGTEXT NOT NULL DEFAULT ('open')");
    expect(joined).toContain("bids ADD COLUMN awarded_date LONGTEXT");
    expect(joined).toContain("bids ADD COLUMN solicitation_number LONGTEXT");
    expect(joined).toContain("data_sources ADD COLUMN consecutive_empty_runs INT NOT NULL DEFAULT 0");
  });

  it("backfills closed lifecycle for inactive rows", () => {
    expect(mysqlDataMigrationStatements()).toEqual([
      "UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'",
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/bid-lifecycle.test.ts src/server/db/schema.test.ts src/server/db/mysql.test.ts`
Expected: FAIL (module not found; missing columns; missing export).

- [ ] **Step 3: Implement**

`frontend/src/lib/bid-lifecycle.ts`:

```ts
/** A bid's place in its lifecycle (spec 2026-09-24 §5.1). `is_active` is exactly `status === "open"`. */
export const BID_LIFECYCLE_STATUSES = ["open", "closed", "awarded"] as const;

export type BidLifecycleStatus = (typeof BID_LIFECYCLE_STATUSES)[number];

export function bidLifecycleStatusOf(value: unknown): BidLifecycleStatus | null {
  return typeof value === "string" && (BID_LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as BidLifecycleStatus)
    : null;
}
```

`frontend/src/server/db/migrate.ts`:
- In the first `sqlite.exec` block, bids CREATE TABLE: after `fips_code TEXT,` add
  ```
      lifecycle_status TEXT NOT NULL DEFAULT 'open',
      awarded_date TEXT,
      solicitation_number TEXT,
  ```
- In the same block, data_sources CREATE TABLE: after `consecutive_failures INTEGER NOT NULL DEFAULT 0,` add `      consecutive_empty_runs INTEGER NOT NULL DEFAULT 0,`
- After `addBidColumn("fips_code", "TEXT");` add:
  ```ts
  addBidColumn("lifecycle_status", "TEXT NOT NULL DEFAULT 'open'");
  addBidColumn("awarded_date", "TEXT");
  addBidColumn("solicitation_number", "TEXT");
  // Rows written before lifecycle tracking: an inactive bid is not open. Idempotent, so it runs
  // on every migration (spec 2026-09-24 §5.1).
  sqlite.exec("UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'");
  ```
- After `addDataSourceColumn("fetch_config", "TEXT");` add `addDataSourceColumn("consecutive_empty_runs", "INTEGER NOT NULL DEFAULT 0");`

`frontend/src/server/db/schema.ts`:
- bids: after `fipsCode: text("fips_code"),` add
  ```ts
    lifecycleStatus: text("lifecycle_status").notNull().default("open"),
    awardedDate: text("awarded_date"),
    solicitationNumber: text("solicitation_number"),
  ```
- dataSources: after `consecutiveFailures: integer("consecutive_failures").notNull().default(0),` add `  consecutiveEmptyRuns: integer("consecutive_empty_runs").notNull().default(0),`

`frontend/src/server/db/mysql.ts`:
- Append to `mysqlColumnMigrations` (before the closing `];`):
  ```ts
  // Bid lifecycle + activity tiers (spec 2026-09-24 phase 1).
  { tableName: "bids", columnName: "lifecycle_status", definition: "LONGTEXT NOT NULL DEFAULT ('open')" },
  { tableName: "bids", columnName: "awarded_date", definition: "LONGTEXT" },
  { tableName: "bids", columnName: "solicitation_number", definition: "LONGTEXT" },
  { tableName: "data_sources", columnName: "consecutive_empty_runs", definition: "INT NOT NULL DEFAULT 0" },
  ```
- After `mysqlIndexMigrationStatements` add:
  ```ts
  /** Idempotent data fixes that run after every column and index migration. */
  export function mysqlDataMigrationStatements(): string[] {
    return ["UPDATE bids SET lifecycle_status = 'closed' WHERE is_active = 0 AND lifecycle_status = 'open'"];
  }
  ```
- In `runMysqlMigrations`, after the index-migration loop and before the `INSERT INTO mysql_migrations`:
  ```ts
  for (const statement of mysqlDataMigrationStatements()) {
    await pool.query(statement);
    appliedStatements += 1;
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/bid-lifecycle.test.ts src/server/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/bid-lifecycle.ts frontend/src/lib/bid-lifecycle.test.ts frontend/src/server/db/migrate.ts frontend/src/server/db/schema.ts frontend/src/server/db/mysql.ts frontend/src/server/db/schema.test.ts frontend/src/server/db/mysql.test.ts
git commit -m "feat(db): add bid lifecycle columns and the empty-run counter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Lifecycle merge and delisting in both importers

**Files:**
- Create: `frontend/src/server/crawler/lifecycle.ts`, `frontend/src/server/crawler/lifecycle.test.ts`
- Modify: `frontend/src/server/crawler/persistence-merge.ts` (end of `mergePersistedBid`)
- Modify: `frontend/src/server/crawler/sqlite-json-importer.ts`
- Modify: `frontend/src/server/crawler/mysql-json-importer.ts`
- Modify: `frontend/src/server/crawler/sqlite-json-importer.test.ts`, `frontend/src/server/crawler/mysql-json-importer.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 (`bidLifecycleStatusOf`, columns); fetch-task `metadata.pagination` (Task 4 contract).
- Produces (`@/server/crawler/lifecycle`):
  - `mergeLifecycleFields(incoming, existing?) -> { lifecycle_status, is_active, awarded_date, deadline_date, solicitation_number }`
  - `readListPagination(metadata) -> { listKind: string; complete: boolean; requestsMade: number | null } | null`
  - `delistingApplies(payload: CrawlerJsonRunPayload): boolean`
  - `sourceBidIdLikePattern(sourceId: string): string` (escape char `!`)
  - `delistedRawPayload(raw: unknown, at: string): string`
  - `withLifecycleMetadata(payload, delisted: number): CrawlerJsonRunPayload`
  - `CrawlerJsonImportResult.delistedCount?: number` (present only when delisting ran)

- [ ] **Step 1: Write the failing tests**

`frontend/src/server/crawler/lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  delistedRawPayload,
  delistingApplies,
  mergeLifecycleFields,
  readListPagination,
  sourceBidIdLikePattern,
  withLifecycleMetadata,
} from "./lifecycle";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

function run(metadata: Record<string, unknown> | null, status: "success" | "failure" = "success"): CrawlerJsonRunPayload {
  return { source: "bidnet_co_denver", runId: "r", status, startedAt: "2026-09-24T00:00:00.000Z", metadata, bids: [] };
}

describe("mergeLifecycleFields", () => {
  it("keeps is_active equal to an open lifecycle", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "open" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
    expect(mergeLifecycleFields({ lifecycle_status: "closed" })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({ is_active: 0 })).toMatchObject({ lifecycle_status: "closed", is_active: 0 });
    expect(mergeLifecycleFields({})).toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("never downgrades an awarded bid to closed, but lets the open list reopen it", () => {
    expect(mergeLifecycleFields({ lifecycle_status: "closed" }, { lifecycle_status: "awarded", awarded_date: "07/09/2026" }))
      .toMatchObject({ lifecycle_status: "awarded", is_active: 0, awarded_date: "07/09/2026" });
    expect(mergeLifecycleFields({ lifecycle_status: "open" }, { lifecycle_status: "awarded" })).toMatchObject({ lifecycle_status: "open", is_active: 1 });
  });

  it("keeps the previous deadline, award date and number when the incoming row lacks them", () => {
    expect(mergeLifecycleFields(
      { lifecycle_status: "awarded", awarded_date: "08/06/2026", deadline_date: null },
      { deadline_date: "07/01/2026", solicitation_number: "1026A" },
    )).toEqual({ lifecycle_status: "awarded", is_active: 0, awarded_date: "08/06/2026", deadline_date: "07/01/2026", solicitation_number: "1026A" });
  });
});

describe("delistingApplies", () => {
  it("needs a successful, complete walk of the open list", () => {
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: true } }))).toBe(true);
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: false } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: "closed", complete: true } }))).toBe(false);
    expect(delistingApplies(run({ pagination: { list_kind: "open", complete: true } }, "failure"))).toBe(false);
    expect(delistingApplies(run({}))).toBe(false);
    expect(delistingApplies(run(null))).toBe(false);
  });
});

describe("readListPagination", () => {
  it("reads the request count when it is a non-negative number", () => {
    expect(readListPagination({ pagination: { list_kind: "open", complete: true, requests_made: 3 } })).toEqual({ listKind: "open", complete: true, requestsMade: 3 });
    expect(readListPagination({ pagination: { requests_made: "x" } })).toEqual({ listKind: "open", complete: false, requestsMade: null });
    expect(readListPagination({})).toBeNull();
  });
});

describe("sourceBidIdLikePattern", () => {
  it("escapes LIKE wildcards so one source never matches another", () => {
    expect(sourceBidIdLikePattern("bidnet_co_denver")).toBe("bidnet!_co!_denver:%");
    expect(sourceBidIdLikePattern("a%b!c")).toBe("a!%b!!c:%");
  });
});

describe("delistedRawPayload", () => {
  it("records why and when the bid closed without losing the crawler payload", () => {
    const next = JSON.parse(delistedRawPayload(JSON.stringify({ title: "T", lifecycle: { note: "x" } }), "2026-09-24T01:00:00.000Z"));
    expect(next).toEqual({ title: "T", lifecycle: { note: "x", closed_reason: "delisted", closed_observed_at: "2026-09-24T01:00:00.000Z" } });
    expect(JSON.parse(delistedRawPayload("not json", "t"))).toEqual({ lifecycle: { closed_reason: "delisted", closed_observed_at: "t" } });
  });
});

describe("withLifecycleMetadata", () => {
  it("adds the delisted count to the logged metadata", () => {
    expect(withLifecycleMetadata(run({ mode: "live" }), 2).metadata).toEqual({ mode: "live", lifecycle: { delisted: 2 } });
  });
});
```

Append to `frontend/src/server/crawler/sqlite-json-importer.test.ts` (inside the file, as a new `describe`; add `and`/`like` are NOT needed — the test reads rows through `testDb.db.select()`):

```ts
describe("bid lifecycle in the SQLite importer (2026-09-24 phase 1)", () => {
  let testDb: TestDatabase;
  beforeEach(async () => { testDb = await createTestDatabase({ seed: false }); });
  afterEach(async () => { await testDb.cleanup(); });

  const T0 = "2026-09-24T00:00:00.000Z";
  const T1 = "2026-09-25T00:00:00.000Z";

  function bid(sourceId: string, id: string, extra: Record<string, unknown> = {}) {
    return {
      id: `${sourceId}:${id}`, source: `${sourceId} (BidNet)`, source_bid_id: id, dedupe_key: `${sourceId}:${id}`,
      title: `Bid ${id}`, description: "", issuer_name: "Agency", issuer_type: "state", state_code: "CO",
      source_url: `https://www.bidnetdirect.com/x/${id}`, lifecycle_status: "open", is_active: 1,
      solicitation_number: `N-${id}`, first_seen_at: T0, last_seen_at: T0, created_at: T0, updated_at: T0, ...extra,
    };
  }

  function payload(sourceId: string, rows: Record<string, unknown>[], complete: boolean, at = T0): CrawlerJsonRunPayload {
    return {
      source: sourceId, runId: `run_${at}_${rows.length}_${complete}`, status: "success", startedAt: at, finishedAt: at,
      metadata: { pagination: { list_kind: "open", complete, requests_made: 1 } }, bids: rows,
    };
  }

  function row(id: string) {
    return testDb.db.select().from(bids).where(eq(bids.id, id)).get();
  }

  it("closes open bids missing from a complete open list and records why", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1"), bid("bidnet_co_denver", "2")], true));
    const result = importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1")], true, T1));

    expect(result.delistedCount).toBe(1);
    expect(row("bidnet_co_denver:1")).toMatchObject({ lifecycleStatus: "open", isActive: 1, solicitationNumber: "N-1" });
    expect(row("bidnet_co_denver:2")).toMatchObject({ lifecycleStatus: "closed", isActive: 0, updatedAt: T1 });
    expect(JSON.parse(row("bidnet_co_denver:2")!.rawPayload!)).toMatchObject({ lifecycle: { closed_reason: "delisted", closed_observed_at: T1 } });
    const log = testDb.db.select().from(crawlerLogs).all().find((entry) => entry.startedAt === T1);
    expect(JSON.parse(log!.metadata!)).toMatchObject({ lifecycle: { delisted: 1 } });
  });

  it("never closes anything after an incomplete run", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1"), bid("bidnet_co_denver", "2")], true));
    const result = importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1")], false, T1));

    expect(result).not.toHaveProperty("delistedCount");
    expect(row("bidnet_co_denver:2")).toMatchObject({ lifecycleStatus: "open", isActive: 1 });
  });

  it("scopes delisting to the source's own id prefix", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver_2", [bid("bidnet_co_denver_2", "9")], true));
    importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1")], true, T1));

    expect(row("bidnet_co_denver_2:9")).toMatchObject({ lifecycleStatus: "open" });
  });

  it("closes every open bid when a verified empty tenant proves the list complete", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, payload("bidnet_co_denver", [bid("bidnet_co_denver", "1")], true));
    importCrawlerJsonRunIntoSqlite(testDb.db, {
      ...payload("bidnet_co_denver", [], true, T1),
      metadata: { emptyState: { verified: true, marker: "There are no open bids at this time.", tenant_confirmed: true, method: "adapter" }, pagination: { list_kind: "open", complete: true } },
    });

    expect(row("bidnet_co_denver:1")).toMatchObject({ lifecycleStatus: "closed", isActive: 0 });
  });

  it("keeps an awarded bid awarded when a closed-list row arrives later", () => {
    importCrawlerJsonRunIntoSqlite(testDb.db, { ...payload("bidnet_co_denver", [bid("bidnet_co_denver", "5", { lifecycle_status: "awarded", is_active: 0, awarded_date: "07/09/2026" })], false), metadata: { pagination: { list_kind: "awarded", complete: false } } });
    importCrawlerJsonRunIntoSqlite(testDb.db, { ...payload("bidnet_co_denver", [bid("bidnet_co_denver", "5", { lifecycle_status: "closed", is_active: 0 })], false, T1), metadata: { pagination: { list_kind: "closed", complete: false } } });

    expect(row("bidnet_co_denver:5")).toMatchObject({ lifecycleStatus: "awarded", awardedDate: "07/09/2026", isActive: 0 });
  });
});
```

Append to `frontend/src/server/crawler/mysql-json-importer.test.ts`:

1. In `createFakeMysql`'s `execute`, before the final `return`, add:
```ts
    if (sql.includes("UPDATE bids SET lifecycle_status = 'closed'")) {
      const [rawPayload, updatedAt, id] = values as [string, string, string];
      const current = bids.get(String(id));
      if (current) bids.set(String(id), { ...current, lifecycle_status: "closed", is_active: 0, raw_payload: rawPayload, updated_at: updatedAt });
    }
```
2. In `query`, before the final `return [[], undefined];`, add:
```ts
    if (sql.includes("lifecycle_status = 'open'") && sql.includes("LIKE ?")) {
      const prefix = String(values[0]).replace(/:%$/, ":").replace(/!(.)/g, "$1");
      return [[...bids.values()].filter((row) => String(row.id).startsWith(prefix) && (row.lifecycle_status ?? "open") === "open"), undefined];
    }
```
3. New describe:
```ts
describe("bid lifecycle in the MySQL importer (2026-09-24 phase 1)", () => {
  const T0 = "2026-09-24T00:00:00.000Z";
  const T1 = "2026-09-25T00:00:00.000Z";
  function bid(id: string) {
    return {
      id: `bidnet_co_denver:${id}`, source: "Denver (BidNet)", source_bid_id: id, dedupe_key: `bidnet_co_denver:${id}`,
      title: `Bid ${id}`, description: "", issuer_name: "Denver", issuer_type: "state", state_code: "CO",
      source_url: `https://www.bidnetdirect.com/x/${id}`, lifecycle_status: "open", is_active: 1, solicitation_number: `N-${id}`,
      first_seen_at: T0, last_seen_at: T0, created_at: T0, updated_at: T0,
    };
  }
  function run(rows: Record<string, unknown>[], complete: boolean, at: string): CrawlerJsonRunPayload {
    return { source: "bidnet_co_denver", runId: `run_${at}`, status: "success", startedAt: at, finishedAt: at, metadata: { pagination: { list_kind: "open", complete } }, bids: rows };
  }

  it("writes the lifecycle columns and closes delisted bids inside the transaction", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, run([bid("1"), bid("2")], true, T0));
    const result = await importCrawlerJsonRunIntoMysql(mysql, run([bid("1")], true, T1));

    expect(result.delistedCount).toBe(1);
    expect(mysql.bids.get("bidnet_co_denver:1")).toMatchObject({ lifecycle_status: "open", is_active: 1, solicitation_number: "N-1" });
    expect(mysql.bids.get("bidnet_co_denver:2")).toMatchObject({ lifecycle_status: "closed", is_active: 0, updated_at: T1 });
    expect(JSON.parse(String(mysql.bids.get("bidnet_co_denver:2")!.raw_payload))).toMatchObject({ lifecycle: { closed_reason: "delisted" } });
  });

  it("leaves open bids alone after an incomplete run", async () => {
    const mysql = createFakeMysql();
    await importCrawlerJsonRunIntoMysql(mysql, run([bid("1"), bid("2")], true, T0));
    const result = await importCrawlerJsonRunIntoMysql(mysql, run([bid("1")], false, T1));

    expect(result).not.toHaveProperty("delistedCount");
    expect(mysql.bids.get("bidnet_co_denver:2")).toMatchObject({ lifecycle_status: "open" });
  });
});
```
(`createFakeMysql` already exposes its `bids` map on the returned store; if it does not, add `bids` to the returned object.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/lifecycle.test.ts src/server/crawler/sqlite-json-importer.test.ts src/server/crawler/mysql-json-importer.test.ts`
Expected: FAIL (module `./lifecycle` missing; lifecycle columns not written).

- [ ] **Step 3: Implement**

`frontend/src/server/crawler/lifecycle.ts`:

```ts
import { bidLifecycleStatusOf, type BidLifecycleStatus } from "@/lib/bid-lifecycle";
import type { CrawlerJsonRunPayload } from "./mysql-json-importer";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function activeFlag(value: unknown) {
  return !(value === false || value === 0 || value === "0");
}

/**
 * Lifecycle status, activity and the three lifecycle columns of a merged bid (spec 2026-09-24
 * §5.1). `is_active` always equals an open lifecycle; an awarded bid is never downgraded to
 * closed; a missing deadline / award date / number never erases a known one.
 */
export function mergeLifecycleFields(incoming: JsonRecord, existing: JsonRecord = {}): JsonRecord {
  const incomingStatus: BidLifecycleStatus =
    bidLifecycleStatusOf(incoming.lifecycle_status) ?? (activeFlag(incoming.is_active) ? "open" : "closed");
  const status: BidLifecycleStatus =
    incomingStatus === "closed" && bidLifecycleStatusOf(existing.lifecycle_status) === "awarded" ? "awarded" : incomingStatus;
  return {
    lifecycle_status: status,
    is_active: status === "open" ? 1 : 0,
    awarded_date: text(incoming.awarded_date) || text(existing.awarded_date) || null,
    deadline_date: text(incoming.deadline_date) || text(existing.deadline_date) || null,
    solicitation_number: text(incoming.solicitation_number) || text(existing.solicitation_number) || null,
  };
}

export function readListPagination(metadata: unknown): { listKind: string; complete: boolean; requestsMade: number | null } | null {
  const pagination = record(record(metadata).pagination);
  if (Object.keys(pagination).length === 0) return null;
  const requests = Number(pagination.requests_made);
  return {
    listKind: typeof pagination.list_kind === "string" ? pagination.list_kind : "open",
    complete: pagination.complete === true,
    requestsMade: pagination.requests_made !== undefined && Number.isFinite(requests) && requests >= 0 ? requests : null,
  };
}

/** True only when this run proves which of the source's open bids are still listed. */
export function delistingApplies(payload: CrawlerJsonRunPayload): boolean {
  if (payload.status !== "success") return false;
  const pagination = readListPagination(payload.metadata);
  return pagination !== null && pagination.listKind === "open" && pagination.complete;
}

/** `LIKE ? ESCAPE '!'` pattern for every bid id of one source (`<source_id>:<source_bid_id>`). */
export function sourceBidIdLikePattern(sourceId: string): string {
  return `${sourceId.replace(/[!%_]/g, (character) => `!${character}`)}:%`;
}

export function delistedRawPayload(raw: unknown, at: string): string {
  const parsed = record(raw);
  return JSON.stringify({
    ...parsed,
    lifecycle: { ...record(parsed.lifecycle), closed_reason: "delisted", closed_observed_at: at },
  });
}

export function withLifecycleMetadata(payload: CrawlerJsonRunPayload, delisted: number): CrawlerJsonRunPayload {
  return { ...payload, metadata: { ...(payload.metadata ?? {}), lifecycle: { delisted } } };
}
```

`frontend/src/server/crawler/persistence-merge.ts`: add `import { mergeLifecycleFields } from "./lifecycle";` and, as the last statement of `mergePersistedBid` before `return merged;`:

```ts
  Object.assign(merged, mergeLifecycleFields(incoming, existing));
```

`frontend/src/server/crawler/mysql-json-importer.ts`:
- `CrawlerJsonImportResult`: add `delistedCount?: number;`
- `bidColumns`: append `"lifecycle_status", "awarded_date", "solicitation_number",` after `"fips_code",`.
- `valueByColumn`: replace the final `return optionalString(row.fips_code);` with:
  ```ts
  if (column === "fips_code") return optionalString(row.fips_code);
  if (column === "lifecycle_status") return stringValue(row.lifecycle_status, "open");
  if (column === "awarded_date") return optionalString(row.awarded_date);
  return optionalString(row.solicitation_number);
  ```
- Add imports `mysqlSelectMany` (already imported) and `{ delistedRawPayload, delistingApplies, sourceBidIdLikePattern, withLifecycleMetadata } from "./lifecycle"`, and a helper:
  ```ts
  async function delistMissingOpenBids(mysql: MysqlCrawlerImportStore, sourceId: string, seen: Set<string>, at: string) {
    const rows = await mysqlSelectMany<{ id: string; raw_payload: unknown }>(
      mysql,
      "SELECT id, raw_payload FROM bids WHERE id LIKE ? ESCAPE '!' AND lifecycle_status = 'open' FOR UPDATE",
      [sourceBidIdLikePattern(sourceId)],
    );
    let delisted = 0;
    for (const row of rows) {
      if (seen.has(String(row.id))) continue;
      await mysqlExecute(
        mysql,
        "UPDATE bids SET lifecycle_status = 'closed', is_active = 0, raw_payload = ?, updated_at = ? WHERE id = ?",
        [delistedRawPayload(row.raw_payload, at), at, row.id] as never[],
      );
      delisted += 1;
    }
    return delisted;
  }
  ```
- In `importCrawlerJsonRunIntoMysql`: create `const seen = new Set<string>();`, add `seen.add(result.id);` after each `upsertBid`, then replace the log/commit/return lines with:
  ```ts
    const delisted = delistingApplies(payload)
      ? await delistMissingOpenBids(connection, payload.source, seen, payload.finishedAt ?? payload.startedAt)
      : null;
    const counts = { fetchedCount: bidRows.length, insertedCount, updatedCount };
    await insertCrawlerLog(connection, delisted === null ? payload : withLifecycleMetadata(payload, delisted), counts);
    await checkLease(true);
    await connection.commit();
    return { ...counts, logCount: 1, ...(delisted === null ? {} : { delistedCount: delisted }) };
  ```

`frontend/src/server/crawler/sqlite-json-importer.ts`:
- Imports: `import { and, eq, sql } from "drizzle-orm";` and `{ delistedRawPayload, delistingApplies, sourceBidIdLikePattern, withLifecycleMetadata } from "./lifecycle"`.
- `type SqliteImportStore = Pick<AppDatabase, "select" | "insert" | "update">;`
- `bidUpdateValues`: after `fipsCode: optionalString(row.fips_code),` add
  ```ts
    lifecycleStatus: stringValue(row.lifecycle_status, "open"),
    awardedDate: optionalString(row.awarded_date),
    solicitationNumber: optionalString(row.solicitation_number),
  ```
- Helper:
  ```ts
  function delistMissingOpenBids(db: SqliteImportStore, sourceId: string, seen: Set<string>, at: string) {
    const rows = db
      .select({ id: bids.id, rawPayload: bids.rawPayload })
      .from(bids)
      .where(and(sql`${bids.id} LIKE ${sourceBidIdLikePattern(sourceId)} ESCAPE '!'`, eq(bids.lifecycleStatus, "open")))
      .all();
    let delisted = 0;
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      db.update(bids)
        .set({ lifecycleStatus: "closed", isActive: 0, rawPayload: delistedRawPayload(row.rawPayload, at), updatedAt: at })
        .where(eq(bids.id, row.id))
        .run();
      delisted += 1;
    }
    return delisted;
  }
  ```
- In the transaction: `const seen = new Set<string>();`, `seen.add(result.id);` after each upsert, then:
  ```ts
      const delisted = delistingApplies(payload)
        ? delistMissingOpenBids(transaction, payload.source, seen, payload.finishedAt ?? payload.startedAt)
        : null;
      const counts = { fetchedCount: bidRows.length, insertedCount, updatedCount };
      insertCrawlerLog(transaction, delisted === null ? payload : withLifecycleMetadata(payload, delisted), counts);
      checkLease();
      return { ...counts, logCount: 1, ...(delisted === null ? {} : { delistedCount: delisted }) };
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/server/crawler`
Expected: PASS (existing importer tests unaffected: `delistedCount` only appears when a complete open-list run was imported).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/crawler/lifecycle.ts frontend/src/server/crawler/lifecycle.test.ts frontend/src/server/crawler/persistence-merge.ts frontend/src/server/crawler/sqlite-json-importer.ts frontend/src/server/crawler/mysql-json-importer.ts frontend/src/server/crawler/sqlite-json-importer.test.ts frontend/src/server/crawler/mysql-json-importer.test.ts
git commit -m "feat(crawler): track bid lifecycle and close delisted bids after complete runs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Task payload carries the pagination request

**Files:**
- Modify: `frontend/src/server/crawler/state-runner.ts:12-58`
- Modify: `frontend/src/server/crawler/state-runner.test.ts:31-75`

**Interfaces:**
- Produces: `DEFAULT_LIST_PAGES = 4`, `listPagesFor(source: Pick<CrawlableSource, "fetchConfig">): number` (reads `fetch_config.list_pages`, integer 1..50); `CrawlTaskPayload` gains `list_kind`, `start_page`, `max_pages`, `stop_before`, and `limit: number | null`; `CrawlTaskOptions` gains `listKind?`, `startPage?`, `maxPages?`, `stopBefore?`.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/server/crawler/state-runner.test.ts`, change the first expectation's `limit: 25,` to `limit: null,` and add the four new keys to that `toEqual` object:

```ts
      limit: null,
      query: null,
      date_range: null,
      list_kind: "open",
      start_page: 1,
      max_pages: 4,
      stop_before: null,
```

Add (import `listPagesFor` alongside `buildCrawlTaskPayload`):

```ts
  it("reads the per-source page budget from fetch_config.list_pages", () => {
    expect(listPagesFor(source({ fetchConfig: { list_pages: 8 } }))).toBe(8);
    expect(listPagesFor(source({ fetchConfig: { list_pages: 0 } }))).toBe(4);
    expect(listPagesFor(source({ fetchConfig: { list_pages: "9" } }))).toBe(4);
    expect(listPagesFor(source({ fetchConfig: { list_pages: 51 } }))).toBe(4);
    expect(buildCrawlTaskPayload(source({ fetchConfig: { list_pages: 8 } }), { taskId: "t" }).max_pages).toBe(8);
  });

  it("passes an explicit history request through", () => {
    const payload = buildCrawlTaskPayload(source(), { taskId: "t", listKind: "awarded", startPage: 5, maxPages: 2, stopBefore: "2024-09-24" });
    expect(payload).toMatchObject({ list_kind: "awarded", start_page: 5, max_pages: 2, stop_before: "2024-09-24" });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/state-runner.test.ts`
Expected: FAIL (`limit` is 25, new keys missing, `listPagesFor` not exported).

- [ ] **Step 3: Implement**

In `frontend/src/server/crawler/state-runner.ts`:

```ts
export type CrawlTaskListKind = "open" | "closed" | "awarded";

/** Pages a paged adapter (BidNet) may walk per run unless `fetch_config.list_pages` says otherwise. */
export const DEFAULT_LIST_PAGES = 4;

export function listPagesFor(source: Pick<CrawlableSource, "fetchConfig">): number {
  const raw = source.fetchConfig?.list_pages;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 50 ? raw : DEFAULT_LIST_PAGES;
}
```

`CrawlTaskPayload`: change `limit: number;` to `limit: number | null;` (doc: `null` = the adapter default; paged adapters then cap only by pages) and add:

```ts
  /** Which public list to walk (spec 2026-09-24 §5.3); only paged adapters read these. */
  list_kind: CrawlTaskListKind;
  start_page: number;
  max_pages: number;
  /** ISO yyyy-mm-dd: stop once a whole page is older (history backfill). */
  stop_before: string | null;
```

`CrawlTaskOptions`: add `listKind?: CrawlTaskListKind; startPage?: number; maxPages?: number; stopBefore?: string | null;`

`buildCrawlTaskPayload` return: `limit: options.limit ?? null,` and after `date_range`:

```ts
    list_kind: options.listKind ?? "open",
    start_page: options.startPage ?? 1,
    max_pages: options.maxPages ?? listPagesFor(source),
    stop_before: options.stopBefore ?? null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/server/crawler src/app/api/crawler src/server/admin/source-precheck.test.ts`
Expected: PASS. If a route/precheck test pins `limit: 25` for a payload built without an explicit limit, update that single expectation to `limit: null` (Python still applies 25 for single-page adapters).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/crawler/state-runner.ts frontend/src/server/crawler/state-runner.test.ts
git commit -m "feat(crawler): send list kind, page range and page budget with each task

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Include any test file changed in Step 4 in the same `git add`.)

---

### Task 8: Activity tiers and the empty-run counter

**Files:**
- Modify: `frontend/src/server/crawler/source-registry.ts`
- Modify: `frontend/src/server/crawler/scheduler.ts`
- Modify: `frontend/src/server/crawler/source-health-repository.ts:17-36`
- Modify: `frontend/src/server/crawler/source-health-outcome.ts`
- Modify: `frontend/src/server/crawler/{scheduler,source-health-repository,source-health-outcome}.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 (`consecutive_empty_runs`), Task 10 (`township` in `JURISDICTION_ORDER`).
- Produces: `CrawlableSource.consecutiveEmptyRuns?: number`; `LOCAL_JURISDICTION_LEVELS: ReadonlySet<string>`; `QUIET_SOURCE_EMPTY_RUNS = 3`; `effectiveIntervalMs(source) -> number | null`; `recordSourceSuccess(db, sourceId, at, outcome?: { emptyVerified?: boolean })` and `recordSourceSuccessInMysql(pool, sourceId, at, outcome?)`; `isVerifiedEmptyRun(result: RunCrawlerSourceOnceResult): boolean`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/server/crawler/scheduler.test.ts` (import `effectiveIntervalMs`, `QUIET_SOURCE_EMPTY_RUNS`):

```ts
describe("activity tiers (spec 2026-09-24 §5.5)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("checks a quiet local source weekly and a busy one on its own cadence", () => {
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "county", consecutiveEmptyRuns: QUIET_SOURCE_EMPTY_RUNS }))).toBe(7 * DAY);
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "township", consecutiveEmptyRuns: 5 }))).toBe(7 * DAY);
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "city", consecutiveEmptyRuns: 2 }))).toBe(DAY);
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "county" }))).toBe(DAY);
  });

  it("never stretches state or federal sources, and never shortens a slower cadence", () => {
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "state", consecutiveEmptyRuns: 9 }))).toBe(DAY);
    expect(effectiveIntervalMs(source({ jurisdictionLevel: "county", cadence: "weekly", consecutiveEmptyRuns: 9 }))).toBe(7 * DAY);
    expect(effectiveIntervalMs(source({ cadence: "manual" }))).toBeNull();
  });

  it("leaves a quiet county out of today's due list", () => {
    const yesterday = new Date(NOW.getTime() - 25 * 60 * 60 * 1000).toISOString();
    const due = selectDueSources([
      source({ id: "busy", jurisdictionLevel: "county", lastSuccessAt: yesterday }),
      source({ id: "quiet", jurisdictionLevel: "county", lastSuccessAt: yesterday, consecutiveEmptyRuns: 3 }),
    ], NOW);
    expect(due.map((entry) => entry.id)).toEqual(["busy"]);
  });
});
```

Append to `frontend/src/server/crawler/source-health-repository.test.ts` (reuse its existing SQLite setup helpers; if the file creates sources with a local `insertSource`, use it):

```ts
describe("consecutive empty runs", () => {
  it("counts verified-empty successes and resets on a run with bids", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const now = "2026-09-24T00:00:00.000Z";
      testDb.db.insert(dataSources).values({ id: "bidnet_co_boulder", label: "Boulder", issuerType: "county", stateCode: "CO", isEnabled: 1, cadence: "daily", createdAt: now, updatedAt: now }).run();
      const count = () => testDb.db.select().from(dataSources).where(eq(dataSources.id, "bidnet_co_boulder")).get()!.consecutiveEmptyRuns;

      recordSourceSuccess(testDb.db, "bidnet_co_boulder", now, { emptyVerified: true });
      recordSourceSuccess(testDb.db, "bidnet_co_boulder", now, { emptyVerified: true });
      expect(count()).toBe(2);
      recordSourceSuccess(testDb.db, "bidnet_co_boulder", now);
      expect(count()).toBe(0);
    } finally {
      await testDb.cleanup();
    }
  });

  it("uses the same rule in MySQL", async () => {
    const executed: Array<{ sql: string; values: unknown[] }> = [];
    const pool = { query: async () => [[], undefined], execute: async (sql: string, values: unknown[] = []) => { executed.push({ sql, values }); return [{}, undefined]; } } as never;
    await recordSourceSuccessInMysql(pool, "s", "t", { emptyVerified: true });
    await recordSourceSuccessInMysql(pool, "s", "t");
    expect(executed[0].sql).toContain("consecutive_empty_runs = consecutive_empty_runs + 1");
    expect(executed[1].sql).toContain("consecutive_empty_runs = 0");
  });
});
```

Append to `frontend/src/server/crawler/source-health-outcome.test.ts` (import `isVerifiedEmptyRun`):

```ts
describe("isVerifiedEmptyRun", () => {
  const base = { ok: true as const, source: "s", status: "success" as const, alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 }, notification: { queued: 0, sent: 0, skipped: 0, failed: 0 } };
  it("is true only for a zero-row success that carries a verified empty state", () => {
    expect(isVerifiedEmptyRun({ ...base, runner: { ok: true, source: "s", status: "success", stdout: "", stderr: "", fetchedCount: 0, payload: { metadata: { emptyState: { verified: true } } } } })).toBe(true);
    expect(isVerifiedEmptyRun({ ...base, runner: { ok: true, source: "s", status: "success", stdout: "", stderr: "", fetchedCount: 3, payload: { metadata: {} } } })).toBe(false);
    expect(isVerifiedEmptyRun({ ok: false, source: "s", status: "blocked", reason: "x" } as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/scheduler.test.ts src/server/crawler/source-health-repository.test.ts src/server/crawler/source-health-outcome.test.ts`
Expected: FAIL (exports missing).

- [ ] **Step 3: Implement**

`source-registry.ts`:
- `CrawlableSource`: add `/** Verified-empty successes in a row (spec 2026-09-24 §5.5); absent in older fixtures. */ consecutiveEmptyRuns?: number;`
- `toCrawlableSource`: add `consecutiveEmptyRuns: row.consecutiveEmptyRuns ?? 0,`
- `MysqlSourceRow`: add `consecutiveEmptyRuns?: number | string | null;`
- `MYSQL_SOURCE_COLUMNS`: append `,\n  consecutive_empty_runs AS consecutiveEmptyRuns` after `consecutive_failures AS consecutiveFailures`.
- `toCrawlableSourceFromMysqlRow`: add `consecutiveEmptyRuns: Number(row.consecutiveEmptyRuns ?? 0),`

`scheduler.ts` (after `JURISDICTION_ORDER`):

```ts
/** Levels activity tiering applies to (spec 2026-09-24 §5.5). */
export const LOCAL_JURISDICTION_LEVELS: ReadonlySet<string> = new Set(["county", "city", "township", "special_district"]);
/** A local source verified empty this many runs in a row is checked weekly until bids reappear. */
export const QUIET_SOURCE_EMPTY_RUNS = 3;

export function effectiveIntervalMs(
  source: Pick<CrawlableSource, "cadence" | "jurisdictionLevel" | "consecutiveEmptyRuns">,
): number | null {
  const interval = cadenceIntervalMs(source.cadence);
  if (interval === null) return null;
  const quiet = LOCAL_JURISDICTION_LEVELS.has(source.jurisdictionLevel ?? "") &&
    (source.consecutiveEmptyRuns ?? 0) >= QUIET_SOURCE_EMPTY_RUNS;
  return quiet ? Math.max(interval, CADENCE_INTERVAL_MS.weekly) : interval;
}
```
and in `nextDueAt` replace `const interval = cadenceIntervalMs(source.cadence);` with `const interval = effectiveIntervalMs(source);`.

`source-health-repository.ts` (add `sql` to the `drizzle-orm` import):

```ts
export interface SourceSuccessOutcome {
  /** The run succeeded with zero rows because the tenant verifiably lists nothing. */
  emptyVerified?: boolean;
}

export function recordSourceSuccess(db: AppDatabase, sourceId: string, at: string, outcome: SourceSuccessOutcome = {}): void {
  db.update(dataSources)
    .set({
      lastSuccessAt: at,
      consecutiveFailures: 0,
      consecutiveEmptyRuns: outcome.emptyVerified ? sql`${dataSources.consecutiveEmptyRuns} + 1` : 0,
      updatedAt: at,
    })
    .where(eq(dataSources.id, sourceId))
    .run();
}

export async function recordSourceSuccessInMysql(
  pool: MysqlHealthStore,
  sourceId: string,
  at: string,
  outcome: SourceSuccessOutcome = {},
): Promise<void> {
  await mysqlExecute(
    pool,
    `UPDATE data_sources
     SET last_success_at = ?, consecutive_failures = 0,
         consecutive_empty_runs = ${outcome.emptyVerified ? "consecutive_empty_runs + 1" : "0"},
         updated_at = ?
     WHERE id = ?`,
    [at, at, sourceId] as never[],
  );
}
```

`source-health-outcome.ts`:

```ts
/** A successful run whose zero rows are a verified, tenant-confirmed empty list. */
export function isVerifiedEmptyRun(result: RunCrawlerSourceOnceResult): boolean {
  if (!result.ok) return false;
  const metadata = result.runner.payload?.metadata;
  return result.runner.fetchedCount === 0 &&
    Boolean(metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).emptyState);
}
```
and in `recordSourceHealthOutcome` pass `{ emptyVerified: isVerifiedEmptyRun(result) }` as the fourth argument to both `recordSourceSuccessInMysql` and `recordSourceSuccess`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/server/crawler`
Expected: PASS. If an existing test pins the old `recordSourceSuccessInMysql` SQL text, update it to the new statement.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/crawler/source-registry.ts frontend/src/server/crawler/scheduler.ts frontend/src/server/crawler/source-health-repository.ts frontend/src/server/crawler/source-health-outcome.ts frontend/src/server/crawler/scheduler.test.ts frontend/src/server/crawler/source-health-repository.test.ts frontend/src/server/crawler/source-health-outcome.test.ts
git commit -m "feat(crawler): check verified-empty local sources weekly until bids reappear

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Platform request budget and pause

**Files:**
- Create: `frontend/src/server/crawler/platform-budget.ts`, `frontend/src/server/crawler/platform-budget.test.ts`
- Modify: `frontend/src/server/crawler/scheduler.ts` (`SchedulerOptions`, cap filter)
- Modify: `frontend/src/server/crawler/configured-runner.ts`
- Modify: `frontend/scripts/crawler-worker.ts:236-262`
- Modify: `frontend/src/server/crawler/configured-runner.test.ts` (append)

**Interfaces:**
- Consumes: Task 7 (`listPagesFor`), Task 8 (scheduler edits land first), `isPlatformThrottleSignature` from `platform-deferral.ts`.
- Produces (`@/server/crawler/platform-budget`): `DEFAULT_PLATFORM_BUDGETS`, `DEFAULT_PLATFORM_PAUSE_MS`, `DEFAULT_TICK_MS`, `platformBudgetsFromEnv(env?) -> Map<string, number | null>`, `platformPauseMs(env?) -> number`, `class PlatformTickBudget { budgetedFamilies(); isBudgeted(family); reserve(family, cost): number | null; settle(family, reserved, actual) }`, `class PlatformPauseRegistry { pause(family, untilMs); pausedUntil(family, nowMs): number | null }`, `requestsMadeOf(result) -> number | null`. `SchedulerOptions.uncappedFamilies?: ReadonlySet<string>`. `RunConfiguredCrawlerSourcesOnceOptions` gains `platformBudgets?`, `tickMs?`, `platformPauses?`, `clock?`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/server/crawler/platform-budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_PAUSE_MS,
  PlatformPauseRegistry,
  PlatformTickBudget,
  platformBudgetsFromEnv,
  platformPauseMs,
  requestsMadeOf,
} from "./platform-budget";

const HOUR = 60 * 60 * 1000;

describe("platformBudgetsFromEnv", () => {
  it("defaults BidNet to 60 requests an hour and layers the environment on top", () => {
    expect(platformBudgetsFromEnv({})).toEqual(new Map([["bidnet", 60]]));
    expect(platformBudgetsFromEnv({ CRAWLER_PLATFORM_BUDGETS: "bidnet=30, bonfire=unlimited, bad=x, =5" }))
      .toEqual(new Map<string, number | null>([["bidnet", 30], ["bonfire", null]]));
  });
});

describe("platformPauseMs", () => {
  it("reads a non-negative override and otherwise pauses 30 minutes", () => {
    expect(platformPauseMs({})).toBe(DEFAULT_PLATFORM_PAUSE_MS);
    expect(platformPauseMs({ CRAWLER_PLATFORM_PAUSE_MS: "60000" })).toBe(60_000);
    expect(platformPauseMs({ CRAWLER_PLATFORM_PAUSE_MS: "-1" })).toBe(DEFAULT_PLATFORM_PAUSE_MS);
  });
});

describe("PlatformTickBudget", () => {
  it("gives each tick its share of the hourly budget, at least one request", () => {
    const budget = new PlatformTickBudget(new Map([["bidnet", 60], ["tiny", 1], ["free", null]]), 15 * 60 * 1000);
    expect(budget.budgetedFamilies()).toEqual(new Set(["bidnet", "tiny"]));
    expect(budget.reserve("bidnet", 15)).toBe(15);
    expect(budget.reserve("bidnet", 1)).toBeNull();
    expect(budget.reserve("tiny", 4)).toBe(1);
    expect(budget.isBudgeted("free")).toBe(false);
    expect(budget.reserve("free", 99)).toBe(99);
  });

  it("refunds what a run did not use and charges what it used beyond the reservation", () => {
    const budget = new PlatformTickBudget(new Map([["bidnet", 8]]), HOUR);
    const reserved = budget.reserve("bidnet", 4)!;
    budget.settle("bidnet", reserved, 1);
    expect(budget.reserve("bidnet", 7)).toBe(7);
    budget.settle("bidnet", 7, 9);
    expect(budget.reserve("bidnet", 1)).toBeNull();
  });
});

describe("PlatformPauseRegistry", () => {
  it("pauses a platform until the given time", () => {
    const pauses = new PlatformPauseRegistry();
    pauses.pause("bidnet", 1_000);
    expect(pauses.pausedUntil("bidnet", 999)).toBe(1_000);
    expect(pauses.pausedUntil("bidnet", 1_000)).toBeNull();
    expect(pauses.pausedUntil(null, 0)).toBeNull();
  });
});

describe("requestsMadeOf", () => {
  it("reads metadata.pagination.requests_made from a finished run", () => {
    const runner = (metadata: unknown) => ({ ok: true, source: "s", status: "success", stdout: "", stderr: "", payload: { metadata } });
    expect(requestsMadeOf({ ok: true, source: "s", status: "success", runner: runner({ pagination: { requests_made: 2 } }) } as never)).toBe(2);
    expect(requestsMadeOf({ ok: true, source: "s", status: "success", runner: runner({}) } as never)).toBeNull();
    expect(requestsMadeOf({ ok: false, source: "s", status: "deferred", reason: "x" } as never)).toBeNull();
  });
});
```

Append to `frontend/src/server/crawler/configured-runner.test.ts` inside the `"runConfiguredCrawlerSourcesOnce reads sources from the database"` describe (it has `insertSource`, `noopMatcher`, `noopNotifier`):

```ts
  it("stops starting a platform's sources once the tick budget is spent", async () => {
    for (const id of ["bidnet_a", "bidnet_b", "bidnet_c"]) insertSource(id, { providerFamily: "bidnet", lastSuccessAt: null });
    const attempted: string[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db, owner: "test", now: new Date(NOW), matcher: noopMatcher, notifier: noopNotifier,
      platformDeferral: { minIntervalMs: 0 }, platformBudgets: new Map([["bidnet", 8]]), tickMs: 60 * 60 * 1000,
      runCrawlerSourceOnce: (async (_db: AppDatabase, options: RunCrawlerSourceOnceOptions) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });
    // Each run reserves 4 pages and reports no request count, so 8 covers two runs.
    expect(attempted).toEqual(["bidnet_a", "bidnet_b"]);
  });

  it("refunds unused pages so cheap runs keep going", async () => {
    for (const id of ["bidnet_a", "bidnet_b", "bidnet_c"]) insertSource(id, { providerFamily: "bidnet", lastSuccessAt: null });
    const attempted: string[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db, owner: "test", now: new Date(NOW), matcher: noopMatcher, notifier: noopNotifier,
      platformDeferral: { minIntervalMs: 0 }, platformBudgets: new Map([["bidnet", 5]]), tickMs: 60 * 60 * 1000,
      runCrawlerSourceOnce: (async (_db: AppDatabase, options: RunCrawlerSourceOnceOptions) => {
        attempted.push(options.source);
        return {
          ok: true, source: options.source, status: "success",
          runner: { ok: true, source: options.source, status: "success", stdout: "", stderr: "", fetchedCount: 1, payload: { metadata: { pagination: { requests_made: 1 } } } },
          alertMatching: { evaluatedAlerts: 0, matchedAlerts: 0, updatedAlerts: 0 }, notification: { queued: 0, sent: 0, skipped: 0, failed: 0 },
        };
      }) as never,
    });
    expect(attempted).toEqual(["bidnet_a", "bidnet_b"]);
  });

  it("keeps a throttled platform paused across ticks that share a pause registry", async () => {
    insertSource("bidnet_a", { providerFamily: "bidnet", lastSuccessAt: null });
    insertSource("bidnet_b", { providerFamily: "bidnet", lastSuccessAt: null });
    const pauses = new PlatformPauseRegistry();
    let clock = 0;
    const attempted: string[] = [];
    const run = () => runConfiguredCrawlerSourcesOnce({
      database: testDb.db, owner: "test", now: new Date(NOW), matcher: noopMatcher, notifier: noopNotifier,
      platformDeferral: { minIntervalMs: 0 }, platformPauses: pauses, clock: () => clock,
      runCrawlerSourceOnce: (async (_db: AppDatabase, options: RunCrawlerSourceOnceOptions) => {
        attempted.push(options.source);
        return { ok: false, source: options.source, status: "failure", runner: { ok: false, source: options.source, status: "failure", stdout: "", stderr: "challenge", errorCode: "BidNetChallengeError" } };
      }) as never,
    });

    await run();
    expect(attempted).toEqual(["bidnet_a"]);
    clock = 29 * 60 * 1000;
    await run();
    expect(attempted).toEqual(["bidnet_a"]);
    clock = 31 * 60 * 1000;
    await run();
    expect(attempted[1]).toBeDefined();
  });

  it("lets a budgeted platform run past the ten-per-tick cap", async () => {
    for (let index = 0; index < 12; index += 1) insertSource(`bidnet_${String(index).padStart(2, "0")}`, { providerFamily: "bidnet", lastSuccessAt: null });
    const attempted: string[] = [];
    await runConfiguredCrawlerSourcesOnce({
      database: testDb.db, owner: "test", now: new Date(NOW), matcher: noopMatcher, notifier: noopNotifier,
      platformDeferral: { minIntervalMs: 0 }, platformBudgets: new Map([["bidnet", 1000]]), tickMs: 60 * 60 * 1000,
      runCrawlerSourceOnce: (async (_db: AppDatabase, options: RunCrawlerSourceOnceOptions) => {
        attempted.push(options.source);
        return { ok: true, source: options.source, status: "success" };
      }) as never,
    });
    expect(attempted).toHaveLength(12);
  });
```
(import `PlatformPauseRegistry` from `./platform-budget` at the top of the test file.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/server/crawler/platform-budget.test.ts src/server/crawler/configured-runner.test.ts`
Expected: FAIL (module missing; options ignored).

- [ ] **Step 3: Implement**

`frontend/src/server/crawler/platform-budget.ts`:

```ts
/**
 * Per-platform request budget (spec 2026-09-24 §5.5). A shared platform (BidNet) sees every
 * tenant run as traffic from one client, so the worker spends an hourly request budget per
 * `provider_family` instead of a fixed number of sources per tick, and pauses a platform after
 * a throttle signature. Never bypasses anything: it only decides when we ask again.
 */

import type { RunCrawlerSourceOnceResult } from "./orchestrator";

export const DEFAULT_PLATFORM_BUDGETS: Readonly<Record<string, number>> = { bidnet: 60 };
export const DEFAULT_PLATFORM_PAUSE_MS = 30 * 60 * 1000;
export const DEFAULT_TICK_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** `CRAWLER_PLATFORM_BUDGETS=bidnet=60,bonfire=30,foo=unlimited` over the defaults; null = unlimited. */
export function platformBudgetsFromEnv(env: Record<string, string | undefined> = process.env): Map<string, number | null> {
  const budgets = new Map<string, number | null>(Object.entries(DEFAULT_PLATFORM_BUDGETS));
  for (const entry of (env.CRAWLER_PLATFORM_BUDGETS ?? "").split(",")) {
    const [family = "", value = ""] = entry.split("=").map((part) => part.trim());
    if (!family || !value) continue;
    if (value.toLowerCase() === "unlimited") {
      budgets.set(family, null);
      continue;
    }
    const perHour = Number(value);
    if (Number.isInteger(perHour) && perHour > 0) budgets.set(family, perHour);
  }
  return budgets;
}

export function platformPauseMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CRAWLER_PLATFORM_PAUSE_MS?.trim();
  const value = Number(raw);
  return raw && Number.isFinite(value) && value >= 0 ? value : DEFAULT_PLATFORM_PAUSE_MS;
}

/** One tick's share of each budgeted platform's hourly request budget. */
export class PlatformTickBudget {
  private readonly allowance = new Map<string, number>();
  private readonly remainingByFamily = new Map<string, number>();

  constructor(budgets: Map<string, number | null>, tickMs: number) {
    for (const [family, perHour] of budgets) {
      if (perHour === null) continue;
      const share = Math.max(1, Math.floor((perHour * tickMs) / HOUR_MS));
      this.allowance.set(family, share);
      this.remainingByFamily.set(family, share);
    }
  }

  budgetedFamilies(): Set<string> {
    return new Set(this.allowance.keys());
  }

  isBudgeted(family: string | null): family is string {
    return family !== null && this.allowance.has(family);
  }

  /** Reserve up to `cost` requests (never more than a whole tick); null = wait for the next tick. */
  reserve(family: string, cost: number): number | null {
    const remaining = this.remainingByFamily.get(family);
    if (remaining === undefined) return cost;
    const needed = Math.min(cost, this.allowance.get(family)!);
    if (remaining < needed) return null;
    this.remainingByFamily.set(family, remaining - needed);
    return needed;
  }

  /** Refund what a run did not use, or charge what it used beyond its reservation. */
  settle(family: string, reserved: number, actual: number): void {
    const remaining = this.remainingByFamily.get(family);
    if (remaining === undefined) return;
    this.remainingByFamily.set(family, Math.max(0, remaining + reserved - actual));
  }
}

/** Platform pauses outlive a tick: the worker keeps one registry for its whole lifetime. */
export class PlatformPauseRegistry {
  private readonly until = new Map<string, number>();

  pause(family: string, untilMs: number): void {
    this.until.set(family, Math.max(untilMs, this.until.get(family) ?? 0));
  }

  pausedUntil(family: string | null, nowMs: number): number | null {
    if (!family) return null;
    const until = this.until.get(family);
    if (until === undefined) return null;
    if (until <= nowMs) {
      this.until.delete(family);
      return null;
    }
    return until;
  }
}

/** `metadata.pagination.requests_made` of a finished run, or null when the run did not report it. */
export function requestsMadeOf(result: RunCrawlerSourceOnceResult): number | null {
  if (result.status !== "success" && result.status !== "failure") return null;
  const metadata = result.runner?.payload?.metadata;
  const pagination = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).pagination : null;
  if (!pagination || typeof pagination !== "object") return null;
  const value = Number((pagination as Record<string, unknown>).requests_made);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
```

`scheduler.ts`: `SchedulerOptions` gains `/** Families spending a request budget are not capped per tick; the budget limits them. */ uncappedFamilies?: ReadonlySet<string>;` and the cap filter becomes:

```ts
  return interleaved.filter((s) => {
    if (s.providerFamily === null || options?.uncappedFamilies?.has(s.providerFamily)) return true;
    const count = familyCounts.get(s.providerFamily) ?? 0;
    if (count >= cap) return false;
    familyCounts.set(s.providerFamily, count + 1);
    return true;
  });
```

`configured-runner.ts`:
- Imports: `import { isPlatformThrottleSignature } from "./platform-deferral";` (extend the existing import), `import { DEFAULT_TICK_MS, PlatformPauseRegistry, PlatformTickBudget, platformBudgetsFromEnv, platformPauseMs, requestsMadeOf } from "./platform-budget";`, `import { listPagesFor } from "./state-runner";` (extend the existing import).
- Options:
  ```ts
  /** Hourly request budgets per provider_family (spec 2026-09-24 §5.5); defaults from CRAWLER_PLATFORM_BUDGETS over `bidnet=60`. */
  platformBudgets?: Map<string, number | null>;
  /** Length of one worker tick: a tick may spend budget × tickMs / 1 h. Defaults to 15 minutes. */
  tickMs?: number;
  /** The worker passes one registry for its lifetime so a pause outlives a tick; default: fresh per call. */
  platformPauses?: PlatformPauseRegistry;
  /** Wall clock for pauses (tests). */
  clock?: () => number;
  ```
- In `runConfiguredCrawlerSourcesOnce`, replace `const dueSources = selectDueSources(allSources, now);` and the loop header with:
  ```ts
  const budget = new PlatformTickBudget(options.platformBudgets ?? platformBudgetsFromEnv(), options.tickMs ?? DEFAULT_TICK_MS);
  const pauses = options.platformPauses ?? new PlatformPauseRegistry();
  const clock = options.clock ?? (() => Date.now());
  const pauseMs = platformPauseMs();
  const skipped = new Map<string, { paused: number; budget: number }>();
  const skip = (family: string, reason: "paused" | "budget") => {
    const counts = skipped.get(family) ?? { paused: 0, budget: 0 };
    counts[reason] += 1;
    skipped.set(family, counts);
  };

  const dueSources = selectDueSources(allSources, now, { uncappedFamilies: budget.budgetedFamilies() });
  const results: RunCrawlerSourceOnceResult[] = [];
  const platform = new PlatformDeferralTracker(options.platformDeferral);

  for (const source of dueSources) {
    const family = source.providerFamily;
    const isSamGov = source.id === "sam_gov" || source.issuerType === "federal";
    // Same-tick throttle first: the existing C7 behavior reports these as `deferred` results.
    const throttledBy = platform.deferredBy(source);
    if (throttledBy) {
      results.push(platformDeferredResult(source.id, throttledBy));
      continue;
    }
    // Paused by an earlier tick, or out of this tick's budget: not contacted, not a result,
    // still due next tick.
    if (family && pauses.pausedUntil(family, clock()) !== null) {
      skip(family, "paused");
      continue;
    }
    const reserved = budget.isBudgeted(family) ? budget.reserve(family, listPagesFor(source)) : null;
    if (budget.isBudgeted(family) && reserved === null) {
      skip(family, "budget");
      continue;
    }
    await platform.waitForPlatformSlot(source);
  ```
  (the `let result…try…catch` block stays as is) and after `results.push(result);`:
  ```ts
    if (reserved !== null && family) budget.settle(family, reserved, requestsMadeOf(result) ?? reserved);
    platform.observe(source, result);
    if (family && isPlatformThrottleSignature(result)) pauses.pause(family, clock() + pauseMs);
  ```
  (remove the old standalone `platform.observe(source, result);`). After the loop, before `return results;`:
  ```ts
  for (const [family, counts] of skipped) {
    console.info(JSON.stringify({ event: "crawler_platform_sources_skipped", family, ...counts }));
  }
  ```

`frontend/scripts/crawler-worker.ts`: import `PlatformPauseRegistry` from `../src/server/crawler/platform-budget`; before the `while` loop add `const platformPauses = new PlatformPauseRegistry();` and pass `platformPauses, tickMs: intervalMs(),` in the `runConfiguredCrawlerSourcesOnce({...})` call.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/server/crawler scripts/crawler-worker.test.ts`
Expected: PASS (existing deferral tests use ≤ 2 BidNet sources, well within the default budget).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/server/crawler/platform-budget.ts frontend/src/server/crawler/platform-budget.test.ts frontend/src/server/crawler/scheduler.ts frontend/src/server/crawler/configured-runner.ts frontend/src/server/crawler/configured-runner.test.ts frontend/scripts/crawler-worker.ts
git commit -m "feat(crawler): spend a per-platform request budget and pause after throttling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: `township` level end to end

**Files:**
- Modify: `frontend/scripts/register-sources.ts:22`, `frontend/scripts/register-sources.test.ts`
- Modify: `frontend/src/server/crawler/scheduler.ts:20`, `frontend/src/server/crawler/scheduler.test.ts`
- Modify: `frontend/src/components/admin/JurisdictionBatchRunPanel.tsx:25,156`, `frontend/src/components/admin/JurisdictionBatchRunPanel.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/en.ts:1210`, `frontend/src/lib/i18n/dictionaries/zh.ts:1212`
- Modify: `frontend/src/app/api/crawler/state/run/route.ts:69` (comment)

**Interfaces:**
- Produces: `township` accepted by `validateCandidate`; `JURISDICTION_ORDER = ["federal", "state", "county", "city", "township", "special_district"]`; `BATCH_JURISDICTION_LEVELS` includes `"township"` (after `"city"`); i18n key `admin.batchRunLevel_township`.

- [ ] **Step 1: Write the failing tests**

`register-sources.test.ts` — add to `describe("validateCandidate")`:
```ts
  it("accepts the township level", () => {
    expect(validateCandidate(candidate({ jurisdictionLevel: "township", issuerType: "township" }))).toEqual([]);
  });
```
`scheduler.test.ts`:
```ts
describe("township ordering", () => {
  it("runs townships after cities and before special districts", () => {
    const due = selectDueSources([
      source({ id: "sd", jurisdictionLevel: "special_district" }),
      source({ id: "twp", jurisdictionLevel: "township" }),
      source({ id: "city", jurisdictionLevel: "city" }),
    ], NOW);
    expect(due.map((entry) => entry.id)).toEqual(["city", "twp", "sd"]);
  });
});
```
`JurisdictionBatchRunPanel.test.ts`: in `batchJurisdictionLevelOf` add `expect(batchJurisdictionLevelOf(adminSource({ jurisdictionLevel: "township" }))).toBe("township");` and add `township: 0,` to the `countBatchEntriesByLevel` expectation (after `city: 1,`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts src/server/crawler/scheduler.test.ts src/components/admin/JurisdictionBatchRunPanel.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `register-sources.ts`: `const VALID_JURISDICTION_LEVELS = new Set(["federal", "state", "county", "city", "township", "special_district"]);`
- `scheduler.ts`: `const JURISDICTION_ORDER = ["federal", "state", "county", "city", "township", "special_district"];`
- `JurisdictionBatchRunPanel.tsx`: `export const BATCH_JURISDICTION_LEVELS = ["federal", "state", "county", "city", "township", "special_district"] as const;` and `const counts = { federal: 0, state: 0, county: 0, city: 0, township: 0, special_district: 0 };`
- `en.ts` after `batchRunLevel_city: "City",`: `    batchRunLevel_township: "Township / town",`
- `zh.ts` after `batchRunLevel_city: "市",`: `    batchRunLevel_township: "镇/镇区",`
- `route.ts:69` comment: `(state, county, city, township, special_district)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts src/server/crawler/scheduler.test.ts src/components/admin && npm run i18n:check`
Expected: PASS; i18n check reports no new findings.

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/register-sources.ts frontend/scripts/register-sources.test.ts frontend/src/server/crawler/scheduler.ts frontend/src/server/crawler/scheduler.test.ts frontend/src/components/admin/JurisdictionBatchRunPanel.tsx frontend/src/components/admin/JurisdictionBatchRunPanel.test.ts frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts frontend/src/app/api/crawler/state/run/route.ts
git commit -m "feat(sources): add the township jurisdiction level

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Detail page — number, lifecycle, members-only notice

**Files:**
- Create: `frontend/src/lib/bid-access.ts`, `frontend/src/lib/bid-access.test.ts`, `frontend/src/components/bids/BidAccessNotice.tsx`
- Modify: `frontend/src/server/bids/domain.ts`, `frontend/src/server/bids/repository.ts` (`toBid`, `toBidFromMysql`, `MysqlBidRow`, both MySQL SELECT lists), `frontend/src/server/bids/service.ts` (`matchesKeyword`), `frontend/src/lib/mock-data.ts` (`Bid`)
- Modify: `frontend/src/app/bids/[id]/page.tsx`, `frontend/src/app/bids/[id]/page.test.ts`
- Modify: `frontend/src/lib/i18n/dictionaries/{en,zh}.ts` (`detail` section)
- Modify: `frontend/src/server/bids/repository.test.ts`, `frontend/src/server/bids/service.test.ts` (append)

**Interfaces:**
- Consumes: Task 5 (`bidLifecycleStatusOf`, columns).
- Produces: `type BidDetailAccess = { platform: string; restricted: Array<"description" | "documents" | "contact"> }`, `detailAccessFromRawPayload(raw: unknown): BidDetailAccess | null` in `@/lib/bid-access`; server `Bid` gains `solicitationNumber: string`, `lifecycleStatus: BidLifecycleStatus`, `awardedDate: string`, `detailAccess: BidDetailAccess | null`; client `Bid` (mock-data) gains the same four as optional; `<BidAccessNotice access sourceUrl />`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/bid-access.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { detailAccessFromRawPayload } from "./bid-access";

describe("detailAccessFromRawPayload", () => {
  it("reads the platform and the restricted fields from raw_payload", () => {
    const raw = JSON.stringify({ detail_access: { platform: "BidNet", restricted: ["description", "documents", "contact"] } });
    expect(detailAccessFromRawPayload(raw)).toEqual({ platform: "BidNet", restricted: ["description", "documents", "contact"] });
  });

  it("ignores unknown fields and returns null when nothing usable is restricted", () => {
    expect(detailAccessFromRawPayload({ detail_access: { platform: "BidNet", restricted: ["documents", "price"] } })).toEqual({ platform: "BidNet", restricted: ["documents"] });
    expect(detailAccessFromRawPayload({ detail_access: { platform: "BidNet", restricted: [] } })).toBeNull();
    expect(detailAccessFromRawPayload({ detail_access: { restricted: ["documents"] } })).toBeNull();
    expect(detailAccessFromRawPayload("not json")).toBeNull();
    expect(detailAccessFromRawPayload(null)).toBeNull();
  });
});
```

Append to `frontend/src/server/bids/repository.test.ts` (use its existing SQLite setup; insert with Drizzle):
```ts
describe("bid lifecycle fields (2026-09-24 phase 1)", () => {
  it("maps number, lifecycle, award date and members-only access onto the Bid", async () => {
    const testDb = await createTestDatabase({ seed: false });
    try {
      const now = "2026-09-24T00:00:00.000Z";
      testDb.db.insert(bids).values({
        id: "bidnet_co_denver:0000419153", source: "Denver (BidNet)", sourceBidId: "0000419153", dedupeKey: "bidnet_co_denver:0000419153",
        title: "Hearing Officers", description: "", issuerName: "Denver", issuerType: "state", stateCode: "CO",
        sourceUrl: "https://www.bidnetdirect.com/x", isActive: 0, lifecycleStatus: "awarded", awardedDate: "07/09/2026",
        solicitationNumber: "50018", rawPayload: JSON.stringify({ detail_access: { platform: "BidNet", restricted: ["description", "documents", "contact"] } }),
        firstSeenAt: now, lastSeenAt: now, createdAt: now, updatedAt: now,
      }).run();

      const bid = await getBidByIdFromRepository(testDb.db, "bidnet_co_denver:0000419153");
      expect(bid).toMatchObject({
        solicitationNumber: "50018", lifecycleStatus: "awarded", awardedDate: "07/09/2026", isActive: false,
        detailAccess: { platform: "BidNet", restricted: ["description", "documents", "contact"] },
      });
    } finally {
      await testDb.cleanup();
    }
  });
});
```

Append inside `describe("bid service")` in `frontend/src/server/bids/service.test.ts` (the repository is mocked there; `cloneBids`, `repositoryListBids` and `referenceDate` already exist):
```ts
  it("finds a bid by its solicitation number", async () => {
    repositoryListBids.mockImplementationOnce(async () => [
      { ...cloneBids()[0], id: "bidnet_co_denver:0000435942", title: "Jail and Courthouse Security Systems", solicitationNumber: "1049A-2026" } as Bid,
    ]);

    const result = await queryBidsFromDatabase({ injected: true } as never, { q: "1049a-2026" }, { referenceDate });

    expect(result.bids.map((bid) => bid.id)).toEqual(["bidnet_co_denver:0000435942"]);
  });
```

Append to `frontend/src/app/bids/[id]/page.test.ts`:
```ts
  it("shows the solicitation number, a non-open lifecycle and the members-only notice", () => {
    const page = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    expect(page).toContain('import { BidAccessNotice } from "@/components/bids/BidAccessNotice"');
    expect(page).toContain("bid.detailAccess ? (");
    expect(page).toContain('t("detail.solicitationNumber")');
    expect(page).toContain("detail.lifecycle_");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/bid-access.test.ts src/server/bids "src/app/bids/[id]/page.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/lib/bid-access.ts`:
```ts
/** Detail fields a platform shows only to its registered members (spec 2026-09-24 §5.6). */
export const RESTRICTABLE_DETAIL_FIELDS = ["description", "documents", "contact"] as const;
export type RestrictableDetailField = (typeof RESTRICTABLE_DETAIL_FIELDS)[number];

export interface BidDetailAccess {
  platform: string;
  restricted: RestrictableDetailField[];
}

export function detailAccessFromRawPayload(raw: unknown): BidDetailAccess | null {
  let value = raw;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const access = (value as Record<string, unknown>).detail_access;
  if (!access || typeof access !== "object" || Array.isArray(access)) return null;
  const { platform, restricted } = access as Record<string, unknown>;
  const fields = Array.isArray(restricted)
    ? restricted.filter((field): field is RestrictableDetailField => (RESTRICTABLE_DETAIL_FIELDS as readonly unknown[]).includes(field))
    : [];
  if (typeof platform !== "string" || !platform.trim() || fields.length === 0) return null;
  return { platform: platform.trim(), restricted: fields };
}
```

`frontend/src/server/bids/domain.ts`: import `type { BidLifecycleStatus } from "@/lib/bid-lifecycle"` and `type { BidDetailAccess } from "@/lib/bid-access"`; add to `Bid` after `isActive: boolean;`:
```ts
  solicitationNumber: string;
  lifecycleStatus: BidLifecycleStatus;
  awardedDate: string;
  /** Platform-locked detail fields, e.g. BidNet members-only description/documents/contact. */
  detailAccess: BidDetailAccess | null;
```

`frontend/src/server/bids/repository.ts`:
- Imports: `bidLifecycleStatusOf` from `@/lib/bid-lifecycle`, `detailAccessFromRawPayload` from `@/lib/bid-access`.
- `MysqlBidRow`: add `lifecycleStatus: string | null; awardedDate: string | null; solicitationNumber: string | null;`
- Both MySQL SELECT lists (the list query near line 303 and the by-id query near line 389): after `is_active AS isActive,` add `lifecycle_status AS lifecycleStatus, awarded_date AS awardedDate, solicitation_number AS solicitationNumber,`.
- `toBid` and `toBidFromMysql`: after `isActive: row.isActive === 1,` add
  ```ts
    solicitationNumber: row.solicitationNumber ?? "",
    lifecycleStatus: bidLifecycleStatusOf(row.lifecycleStatus) ?? (row.isActive === 1 ? "open" : "closed"),
    awardedDate: row.awardedDate ?? "",
    detailAccess: detailAccessFromRawPayload(row.rawPayload),
  ```

`frontend/src/server/bids/service.ts` `matchesKeyword`: add `bid.solicitationNumber ?? "",` after `bid.title,` (bids built from older fixtures may not carry the field).

`frontend/src/lib/mock-data.ts` `Bid`: add
```ts
  solicitationNumber?: string;
  lifecycleStatus?: "open" | "closed" | "awarded";
  awardedDate?: string;
  detailAccess?: { platform: string; restricted: Array<"description" | "documents" | "contact"> } | null;
```

`frontend/src/components/bids/BidAccessNotice.tsx`:
```tsx
"use client";

import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BidDetailAccess } from "@/lib/bid-access";
import { useLanguage } from "@/lib/i18n/LanguageContext";

/** Says which detail fields the platform keeps for its members, instead of rendering blanks. */
export function BidAccessNotice({ access, sourceUrl }: { access: BidDetailAccess; sourceUrl: string }) {
  const { t } = useLanguage();
  const fields = access.restricted.map((field) => t(`detail.restrictedField_${field}`)).join(t("detail.restrictedFieldSeparator"));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2 break-words">
        <Lock size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t("detail.restrictedAccessBody").replace("{fields}", fields).replace("{platform}", access.platform)}</span>
      </p>
      {sourceUrl ? (
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="break-all">
            <ExternalLink className="mr-2 h-4 w-4" /> {t("detail.viewOnPlatform").replace("{platform}", access.platform)}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
```

i18n — `en.ts` `detail` section, after `noAttachments`:
```ts
    solicitationNumber: "Solicitation #",
    lifecycle_open: "Open",
    lifecycle_closed: "Closed",
    lifecycle_awarded: "Awarded",
    restrictedAccessBody: "The {fields} are only available to registered {platform} members.",
    restrictedField_description: "description",
    restrictedField_documents: "bid documents",
    restrictedField_contact: "buyer contact",
    restrictedFieldSeparator: ", ",
    viewOnPlatform: "View on {platform}",
```
`zh.ts` `detail` section, same position:
```ts
    solicitationNumber: "招标编号",
    lifecycle_open: "进行中",
    lifecycle_closed: "已截止",
    lifecycle_awarded: "已授标",
    restrictedAccessBody: "{fields}仅对 {platform} 注册会员开放。",
    restrictedField_description: "正文",
    restrictedField_documents: "招标文件",
    restrictedField_contact: "采购联系人",
    restrictedFieldSeparator: "、",
    viewOnPlatform: "在 {platform} 查看",
```

`page.tsx`:
- Import `import { BidAccessNotice } from "@/components/bids/BidAccessNotice";`
- In the title section, after the issuer `<span>`:
  ```tsx
          {bid.solicitationNumber ? (
            <span className="break-words text-sm font-medium text-slate-500">
              {t("detail.solicitationNumber")} {bid.solicitationNumber}
            </span>
          ) : null}
          {bid.lifecycleStatus && bid.lifecycleStatus !== "open" ? (
            <Badge variant="outline" className="rounded-md border-slate-300 bg-slate-100 px-2.5 py-1 font-medium text-slate-700">
              {t(`detail.lifecycle_${bid.lifecycleStatus}`)}{bid.awardedDate ? ` · ${bid.awardedDate}` : ""}
            </Badge>
          ) : null}
  ```
- In the Description `CardContent`, before the `<div className="prose …">`:
  ```tsx
          {bid.detailAccess ? (
            <div className="mb-4">
              <BidAccessNotice access={bid.detailAccess} sourceUrl={bid.sourceUrl} />
            </div>
          ) : null}
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib src/server/bids "src/app/bids/[id]/page.test.ts" && npm run i18n:check && npm run lint`
Expected: PASS; no new i18n findings; lint clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/bid-access.ts frontend/src/lib/bid-access.test.ts frontend/src/components/bids/BidAccessNotice.tsx frontend/src/server/bids/domain.ts frontend/src/server/bids/repository.ts frontend/src/server/bids/service.ts frontend/src/lib/mock-data.ts "frontend/src/app/bids/[id]/page.tsx" "frontend/src/app/bids/[id]/page.test.ts" frontend/src/lib/i18n/dictionaries/en.ts frontend/src/lib/i18n/dictionaries/zh.ts frontend/src/server/bids/repository.test.ts frontend/src/server/bids/service.test.ts
git commit -m "feat(bids): show solicitation number, lifecycle and the members-only notice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Cross-language lifecycle integration

**Files:**
- Create: `frontend/scripts/fixtures/bidnet-lifecycle-pipeline.py`
- Create: `frontend/src/server/crawler/bidnet-lifecycle.integration.test.ts`
- Modify: `frontend/package.json` (`test:crawler-integration` runs both integration files)

**Interfaces:**
- Consumes: Tasks 1–4 (real reader, paged stage, fetch-task), Tasks 5–7 (importers), the real Scrapling extractor server (`services/scrapling-extractor/server.py` `create_server`).
- Produces: JSON `{ "first": CrawlerJsonRunPayload, "second": CrawlerJsonRunPayload, "removedId": "bidnet_co_denver:0000436007" }` on stdout.

- [ ] **Step 1: Write the fixture script**

`frontend/scripts/fixtures/bidnet-lifecycle-pipeline.py`:

```python
"""Offline cross-language fixture: saved BidNet list -> real reader + real Scrapling sidecar -> CLI JSON.

Run 1 serves Denver's saved open list; run 2 serves the same page with one row removed. Only
the portal transport is replaced; no public portal is contacted.
"""

import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "crawler"))
sys.path.insert(0, str(ROOT / "services" / "scrapling-extractor"))

from apsi_crawler import cli  # noqa: E402
from apsi_crawler.html.public_page import FetchedPage  # noqa: E402
from server import create_server  # noqa: E402

REMOVED = "0000436007"


def main():
    page = (ROOT / "crawler/tests/fixtures/bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
    without_row, removed = re.subn(r'<tr data-index="\d+"[^>]*>(?:(?!</tr>).)*' + REMOVED + r".*?</tr>", "", page, count=1, flags=re.S)
    assert removed == 1, "the saved page must contain the row to remove"
    base_url = "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing/solicitations/open-bids"
    task = {
        "task_id": "offline-lifecycle", "source_id": "bidnet_co_denver",
        "label": "City and County of Denver General Services Purchasing (BidNet)", "state_code": "CO",
        "jurisdiction_level": "county", "provider_family": "bidnet", "limit": None, "query": None,
        "date_range": None, "list_kind": "open", "start_page": 1, "max_pages": 4, "stop_before": None,
        "fetch_config": {"base_url": base_url},
    }
    with tempfile.TemporaryDirectory(prefix="apsi-lifecycle-pipeline-") as storage:
        server = create_server(0, storage_dir=storage)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def run(html):
                output = io.StringIO()
                with patch("apsi_crawler.spiders.co_bidnet.fetch_page", side_effect=lambda url, **kwargs: FetchedPage(html, url, False)), \
                     patch("apsi_crawler.spiders.co_bidnet.time.sleep", lambda seconds: None), \
                     patch.dict("os.environ", {"SCRAPLING_EXTRACTOR_URL": f"http://127.0.0.1:{server.server_address[1]}"}), \
                     contextlib.redirect_stdout(output):
                    status = cli.fetch_task(dict(task))
                assert status == 0, output.getvalue()
                return json.loads(output.getvalue())

            first = run(page)
            second = run(without_row)
        finally:
            server.shutdown()
    print(json.dumps({"first": first, "second": second, "removedId": f"bidnet_co_denver:{REMOVED}"}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the integration test**

`frontend/src/server/crawler/bidnet-lifecycle.integration.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createPool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDatabase } from "@/server/db/test-utils";
import { createMysqlPool, runMysqlMigrations } from "@/server/db/mysql";
import { getBidByIdFromMysql, getBidByIdFromRepository } from "@/server/bids/repository";
import { queryBidsFromDatabase } from "@/server/bids/service";
import { importCrawlerJsonRunIntoSqlite } from "./sqlite-json-importer";
import { importCrawlerJsonRunIntoMysql, type CrawlerJsonRunPayload } from "./mysql-json-importer";

interface LifecycleFixture {
  first: CrawlerJsonRunPayload;
  second: CrawlerJsonRunPayload;
  removedId: string;
}

describe.runIf(process.env.RUN_CRAWLER_INTEGRATION === "1")("BidNet lifecycle through the real reader, sidecar and importers", () => {
  let fixture: LifecycleFixture;

  beforeAll(() => {
    fixture = JSON.parse(execFileSync(
      process.env.CRAWLER_INTEGRATION_PYTHON || "python3",
      [path.resolve("scripts/fixtures/bidnet-lifecycle-pipeline.py")],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
    ));
  }, 65_000);

  it("walks the saved list on the Scrapling main path and proves it complete", () => {
    expect(fixture.first.metadata?.listExtraction).toMatchObject({ method: "scrapling" });
    expect(fixture.first.metadata?.pagination).toMatchObject({ list_kind: "open", complete: true, pages_fetched: 1 });
    expect(fixture.first.bids).toHaveLength(6);
    expect(fixture.first.bids![0]).toMatchObject({ solicitation_number: "11205A", lifecycle_status: "open" });
    expect(fixture.second.bids).toHaveLength(5);
  });

  it("closes the delisted bid in SQLite and drops it from search", async () => {
    const database = await createTestDatabase({ seed: false });
    try {
      importCrawlerJsonRunIntoSqlite(database.db, fixture.first);
      const result = importCrawlerJsonRunIntoSqlite(database.db, fixture.second);
      expect(result.delistedCount).toBe(1);
      expect(await getBidByIdFromRepository(database.db, fixture.removedId)).toMatchObject({ lifecycleStatus: "closed", isActive: false });
      const open = await queryBidsFromDatabase(database.db, {});
      expect(open.bids.map((bid) => bid.id)).not.toContain(fixture.removedId);
      expect(open.bids.every((bid) => bid.solicitationNumber)).toBe(true);
    } finally {
      await database.cleanup();
    }
  });

  describe.runIf(Boolean(process.env.CRAWLER_INTEGRATION_MYSQL_URL))("real MySQL", () => {
    const databaseName = `apsi_crawler_test_${randomUUID().replaceAll("-", "")}`;
    let admin: ReturnType<typeof createMysqlPool>;
    let mysql: ReturnType<typeof createMysqlPool>;

    beforeAll(async () => {
      // Always a new isolated schema; never migrate or clear the supplied database.
      const url = new URL(process.env.CRAWLER_INTEGRATION_MYSQL_URL!);
      url.pathname = "/";
      admin = createMysqlPool(url.toString());
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      url.pathname = `/${databaseName}`;
      mysql = createPool({ uri: url.toString(), connectionLimit: 1 });
      await runMysqlMigrations(mysql);
    }, 60_000);

    afterAll(async () => {
      if (mysql) await mysql.end();
      if (admin) {
        await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
        await admin.end();
      }
    });

    it("closes the delisted bid in MySQL", async () => {
      await importCrawlerJsonRunIntoMysql(mysql, fixture.first);
      const result = await importCrawlerJsonRunIntoMysql(mysql, fixture.second);
      expect(result.delistedCount).toBe(1);
      expect(await getBidByIdFromMysql(mysql, fixture.removedId)).toMatchObject({ lifecycleStatus: "closed", isActive: false });
    });
  });
});
```
(This is the same isolated-schema setup `enrichment-pipeline.integration.test.ts` uses.)

`frontend/package.json`: change the script to
`"test:crawler-integration": "RUN_CRAWLER_INTEGRATION=1 vitest run src/server/crawler/enrichment-pipeline.integration.test.ts src/server/crawler/bidnet-lifecycle.integration.test.ts",`

- [ ] **Step 3: Run it**

Run (controller supplies a throwaway MySQL, never the `winbids` schema):
```bash
cd frontend && CRAWLER_INTEGRATION_PYTHON=../services/scrapling-extractor/.venv/bin/python npm run test:crawler-integration
```
Expected: PASS without MySQL (MySQL block skipped); PASS with `CRAWLER_INTEGRATION_MYSQL_URL` set.

- [ ] **Step 4: Commit**

```bash
git add frontend/scripts/fixtures/bidnet-lifecycle-pipeline.py frontend/src/server/crawler/bidnet-lifecycle.integration.test.ts frontend/package.json
git commit -m "test(crawler): pin BidNet lifecycle across the reader, sidecar and both importers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Documentation

**Files:**
- Create: `docs/operations/bid-lifecycle-and-crawl-budget.md` (Chinese, like the other runbooks)
- Modify: `CLAUDE.md` (Crawler architecture: fetch-task contract fields, pagination/lifecycle paragraph, budget env vars, township level; Environment Variables table rows `CRAWLER_PLATFORM_BUDGETS`, `CRAWLER_PLATFORM_PAUSE_MS`)
- Modify: `docs/architecture/crawler-enrichment-flow.md` (list stage: paged walk, overlay, `complete`; persistence: lifecycle merge + delisting)
- Modify: `docs/transferability/environment-variables.md` (two new variables)

- [ ] **Step 1: Write the runbook**

`docs/operations/bid-lifecycle-and-crawl-budget.md` must cover, each as its own section:
1. 招标状态：`open → closed → awarded` 的含义；`is_active` 与状态的关系；"已下架"是怎样判定的（只有 `metadata.pagination.complete = true` 的开放列表运行才会关闭本源其余 open 招标；失败、被截断、带日期窗口的运行一律不改）；怎么查：`SELECT lifecycle_status, COUNT(*) FROM bids WHERE id LIKE 'bidnet!_co!_denver:%' ESCAPE '!' GROUP BY 1;`
2. 翻页：BidNet 按"下一页"链接走，默认每次最多 4 页（`fetch_config.list_pages` 可调 1–50）；Scrapling 仍是主路径，页面读取器只补编号/状态/下一页，不多发请求。
3. 会员锁：BidNet 详情页的发标机构、正文、文件、联系人需会员登录，我们不登录，只标注并给原链接。
4. 平台请求预算：`CRAWLER_PLATFORM_BUDGETS`（默认 `bidnet=60`，可写 `unlimited`）、每 tick 份额公式、`CRAWLER_PLATFORM_PAUSE_MS`（默认 30 分钟）；`crawler:once` 同样受预算约束；日志事件 `crawler_platform_sources_skipped`。
5. 活跃度分层：`consecutive_empty_runs`、连续 3 次核实为空改为每周、出现招标即恢复。
6. `township` 级别：用于 Township 与 NY/新英格兰/WI 的 town；门禁同县市。

- [ ] **Step 2: Update CLAUDE.md, the architecture doc and the env-var reference** with the same facts, concisely (one paragraph each; the env table gets two rows).

- [ ] **Step 3: Commit**

```bash
git add docs/operations/bid-lifecycle-and-crawl-budget.md CLAUDE.md docs/architecture/crawler-enrichment-flow.md docs/transferability/environment-variables.md
git commit -m "docs: record bid lifecycle, paged BidNet lists and the crawl budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Verification and live acceptance (controller only)

- [ ] **Step 1: Full gates**

```bash
cd crawler && python3 -m pytest -q
cd ../services/scrapling-extractor && .venv/bin/python -m pytest tests -q
cd ../browser-downloader && .venv/bin/python -m pytest tests -q
cd ../../frontend && npm run test && npm run lint && npm run i18n:check && npm run build
```
Expected: all pass (the i18n check keeps only its fixed `winbids-demo` baseline).

- [ ] **Step 2: Integration against a throwaway MySQL 8 container** (random password, container removed afterwards, never the `winbids` schema): `CRAWLER_INTEGRATION_MYSQL_URL=... CRAWLER_INTEGRATION_PYTHON=../services/scrapling-extractor/.venv/bin/python npm run test:crawler-integration`.

- [ ] **Step 3: Migrate the local dev MySQL** (`winbids-mysql`, additive columns only): `cd frontend && set -a && . ./.env.local && set +a && npm run db:mysql:migrate`.

- [ ] **Step 4: Live run of the six approved BidNet sources** through the manual run route on the dev server (`CRAWLER_ALLOW_UNAUTHENTICATED_LOCAL_RUN=true`, loopback), body `{"sources": ["bidnet_co_boulder","bidnet_co_city_aurora","bidnet_co_denver","bidnet_co_jefferson","bidnet_mi_washtenaw","bidnet_ny_erie"]}`. Six tenants × 1–2 pages at BidNet's 3 s spacing; stop immediately on any challenge.

- [ ] **Step 5: Acceptance queries** (spec §12.2, phase 1):
```sql
-- no BidNet bid more than 2 days past its deadline is still open
SELECT id, deadline_date FROM bids
WHERE id LIKE 'bidnet!_%' ESCAPE '!' AND lifecycle_status = 'open'
  AND STR_TO_DATE(deadline_date, '%m/%d/%Y') < CURDATE() - INTERVAL 2 DAY;
-- every current BidNet bid carries its number
SELECT COUNT(*) AS missing FROM bids
WHERE id LIKE 'bidnet!_%' ESCAPE '!' AND lifecycle_status = 'open' AND COALESCE(solicitation_number, '') = '';
```
Expected: zero rows / `missing = 0`. Record the numbers (runs, pages, delisted counts, the two queries) in `docs/operations/bid-lifecycle-and-crawl-budget.md` under a "首轮实测" section and commit.
