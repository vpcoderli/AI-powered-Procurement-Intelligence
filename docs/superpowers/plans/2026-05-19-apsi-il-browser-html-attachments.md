# APSi IL Browser/HTML Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Illinois BidBuy live ingestion, deterministic browser/HTML handling, and first-stage attachment persistence for crawler-imported bids.

**Architecture:** Build a small crawler HTML utility first, then use it from a focused IL BidBuy spider. Extend the existing `fetch-state` path with `--fixture-html`, and update SQLite storage so normalized bid dictionaries with `attachments` are written into `bid_attachments` when that table exists.

**Tech Stack:** Python 3.9+, standard-library `html.parser`, `urllib.parse`, `requests`, `pytest`, SQLite, existing APSi crawler package.

---

## File Structure

- Create `crawler/apsi_crawler/html/__init__.py`
  - Package marker for crawler HTML helpers.
- Create `crawler/apsi_crawler/html/public_page.py`
  - Public-page HTML fetch, fixture loading, whitespace normalization, URL resolution, and table extraction.
- Create `crawler/apsi_crawler/spiders/il_bidbuy.py`
  - IL-specific fetcher, parser, detail-page attachment discovery, and `IlBidBuyError`.
- Modify `crawler/apsi_crawler/cli.py`
  - Add `--fixture-html`, pass it to state live fetchers, and include it in crawler log metadata.
- Modify `crawler/apsi_crawler/sources/state_sources.py`
  - Register `il_bidbuy` with `live_fetcher=fetch_il_bidbuy_opportunities`.
- Modify `crawler/apsi_crawler/storage/sqlite.py`
  - Persist bid attachments after bid upsert when `bid_attachments` exists.
- Modify `crawler/tests/test_state_live_sources.py`
  - Add IL registry, parser, fixture replay, HTTP, and attachment-discovery tests.
- Modify `crawler/tests/test_state_live_cli.py`
  - Add IL `--fixture-html` CLI replay test and move unsupported-source coverage to a synthetic source.
- Modify `crawler/tests/test_storage.py`
  - Add attachment insert/replace and backwards-compatible no-table tests.
- Create `crawler/tests/test_html_public_page.py`
  - Unit tests for the shared HTML utility layer.
- Create `crawler/tests/fixtures/il_bidbuy_open_bids.html`
  - Deterministic Open Bids listing fixture.
- Create `crawler/tests/fixtures/il_bidbuy_detail.html`
  - Deterministic detail page fixture with attachment links.

---

### Task 1: Shared HTML Utility Layer

**Files:**
- Create: `crawler/apsi_crawler/html/__init__.py`
- Create: `crawler/apsi_crawler/html/public_page.py`
- Create: `crawler/tests/test_html_public_page.py`

- [ ] **Step 1: Write failing HTML utility tests**

Create `crawler/tests/test_html_public_page.py`:

```python
import requests
import pytest

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    normalize_space,
    read_html_fixture,
)


class FakeResponse:
    def __init__(self, status_code=200, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {"Content-Type": "text/html; charset=utf-8"}


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []
        self.closed = False

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "params": params, "headers": headers, "timeout": timeout}
        )
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def close(self):
        self.closed = True


def test_read_html_fixture_returns_text(tmp_path):
    fixture = tmp_path / "page.html"
    fixture.write_text("<html><body>BidBuy</body></html>", encoding="utf-8")

    assert read_html_fixture(str(fixture)) == "<html><body>BidBuy</body></html>"


def test_normalize_space_collapses_whitespace_and_nbsp():
    assert normalize_space("  Bid\u00a0 Solicitation \n #  ") == "Bid Solicitation #"


def test_absolute_url_resolves_relative_links():
    assert absolute_url("https://www.bidbuy.illinois.gov/bso/search", "../detail/123") == (
        "https://www.bidbuy.illinois.gov/detail/123"
    )


def test_fetch_html_uses_session_and_returns_html_text():
    session = FakeSession(FakeResponse(text="<html>Open Bids</html>"))

    html = fetch_html(
        "https://www.bidbuy.illinois.gov/bso/",
        session=session,
        timeout=12,
        params={"openBids": "true"},
    )

    assert html == "<html>Open Bids</html>"
    assert session.calls == [
        {
            "url": "https://www.bidbuy.illinois.gov/bso/",
            "params": {"openBids": "true"},
            "headers": {"Accept": "text/html,application/xhtml+xml"},
            "timeout": 12,
        }
    ]
    assert session.closed is False


def test_fetch_html_closes_owned_session(monkeypatch):
    session = FakeSession(FakeResponse(text="<html>Open Bids</html>"))
    monkeypatch.setattr("apsi_crawler.html.public_page.requests.Session", lambda: session)

    assert fetch_html("https://www.bidbuy.illinois.gov/bso/") == "<html>Open Bids</html>"
    assert session.closed is True


def test_fetch_html_raises_on_request_error():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML request failed: slow"


def test_fetch_html_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML request failed with status 503: maintenance"


def test_fetch_html_raises_on_non_html_response():
    session = FakeSession(
        FakeResponse(text='{"error":true}', headers={"Content-Type": "application/json"})
    )

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML response content type was not HTML: application/json"


def test_fetch_html_raises_on_empty_html():
    session = FakeSession(FakeResponse(text="   "))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML response was empty"


def test_extract_table_rows_returns_text_and_cell_links():
    html = """
    <table>
      <thead>
        <tr>
          <th>Bid Solicitation #</th>
          <th>Description</th>
          <th>Organization Name</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><a href="/bso/detail.xhtml?bidId=IL-2026-001">IL-2026-001</a></td>
          <td>Cloud migration</td>
          <td>Illinois Department of Innovation</td>
        </tr>
      </tbody>
    </table>
    """

    rows = extract_table_rows(
        html,
        required_headers=("Bid Solicitation #", "Description", "Organization Name"),
    )

    assert rows == [
        {
            "Bid Solicitation #": "IL-2026-001",
            "Description": "Cloud migration",
            "Organization Name": "Illinois Department of Innovation",
            "_links": {"Bid Solicitation #": "/bso/detail.xhtml?bidId=IL-2026-001"},
        }
    ]


def test_extract_table_rows_raises_when_required_headers_are_missing():
    html = """
    <table>
      <tr><th>Description</th></tr>
      <tr><td>Cloud migration</td></tr>
    </table>
    """

    with pytest.raises(HtmlPageError) as error:
        extract_table_rows(html, required_headers=("Bid Solicitation #", "Description"))

    assert str(error.value) == "HTML table was missing required headers: Bid Solicitation #"
```

- [ ] **Step 2: Run HTML utility tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_html_public_page.py -q
```

Expected: fail because `apsi_crawler.html.public_page` does not exist.

- [ ] **Step 3: Add package marker**

Create `crawler/apsi_crawler/html/__init__.py`:

```python
```

- [ ] **Step 4: Implement HTML utility**

Create `crawler/apsi_crawler/html/public_page.py`:

```python
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests


class HtmlPageError(Exception):
    pass


def read_html_fixture(path):
    with open(path, encoding="utf-8") as fixture:
        return fixture.read()


def normalize_space(value):
    return " ".join(str(value or "").replace("\xa0", " ").split())


def absolute_url(base_url, href):
    return urljoin(base_url, href or "")


def fetch_html(url, session=None, timeout=30, params=None):
    client = session or requests.Session()
    close_client = session is None
    try:
        try:
            response = client.get(
                url,
                params=params,
                headers={"Accept": "text/html,application/xhtml+xml"},
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise HtmlPageError(f"HTML request failed: {error}") from error

        if response.status_code != 200:
            raise HtmlPageError(
                f"HTML request failed with status {response.status_code}: {response.text}"
            )

        content_type = response.headers.get("Content-Type", "")
        if "html" not in content_type.lower():
            raise HtmlPageError(
                f"HTML response content type was not HTML: {content_type}"
            )

        if not response.text.strip():
            raise HtmlPageError("HTML response was empty")

        return response.text
    finally:
        if close_client:
            client.close()


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._table = None
        self._row = None
        self._cell = None
        self._in_table = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self._in_table = True
            self._table = []
        elif self._in_table and tag == "tr":
            self._row = []
        elif self._in_table and tag in ("th", "td"):
            self._cell = {"text": [], "links": []}
        elif self._cell is not None and tag == "a":
            href = attrs.get("href")
            if href:
                self._cell["links"].append(href)

    def handle_data(self, data):
        if self._cell is not None:
            self._cell["text"].append(data)

    def handle_endtag(self, tag):
        if self._in_table and tag in ("th", "td") and self._cell is not None:
            self._row.append(
                {
                    "text": normalize_space("".join(self._cell["text"])),
                    "links": list(self._cell["links"]),
                }
            )
            self._cell = None
        elif self._in_table and tag == "tr" and self._row is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._in_table:
            self.tables.append(self._table or [])
            self._table = None
            self._in_table = False


def extract_table_rows(html, required_headers):
    parser = _TableParser()
    parser.feed(html)
    required = tuple(required_headers)
    last_missing = list(required)

    for table in parser.tables:
        if not table:
            continue
        headers = [cell["text"] for cell in table[0]]
        missing = [header for header in required if header not in headers]
        if missing:
            last_missing = missing
            continue

        rows = []
        for row in table[1:]:
            values = {}
            links = {}
            for index, header in enumerate(headers):
                if index >= len(row):
                    values[header] = ""
                    continue
                values[header] = row[index]["text"]
                if row[index]["links"]:
                    links[header] = row[index]["links"][0]
            values["_links"] = links
            rows.append(values)
        return rows

    missing = ", ".join(last_missing)
    raise HtmlPageError(f"HTML table was missing required headers: {missing}")
```

- [ ] **Step 5: Run HTML utility tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_html_public_page.py -q
```

Expected: all tests in `test_html_public_page.py` pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/html/__init__.py crawler/apsi_crawler/html/public_page.py crawler/tests/test_html_public_page.py
git commit -m "feat: add crawler HTML public page helpers"
```

---

### Task 2: IL BidBuy Live Adapter and `--fixture-html`

**Files:**
- Create: `crawler/apsi_crawler/spiders/il_bidbuy.py`
- Create: `crawler/tests/fixtures/il_bidbuy_open_bids.html`
- Modify: `crawler/apsi_crawler/cli.py`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Add IL Open Bids fixture**

Create `crawler/tests/fixtures/il_bidbuy_open_bids.html`:

```html
<!doctype html>
<html>
  <body>
    <table id="open-bids">
      <thead>
        <tr>
          <th>Bid Solicitation #</th>
          <th>Description</th>
          <th>Organization Name</th>
          <th>Bid Opening Date</th>
          <th>Status</th>
          <th>Alternate Id</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <a href="/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001">
              IL-BIDBUY-2026-001
            </a>
          </td>
          <td>Enterprise data integration services</td>
          <td>Illinois Department of Innovation and Technology</td>
          <td>06/30/2026 02:00 PM</td>
          <td>Open</td>
          <td>DoIT-26-Data</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
```

- [ ] **Step 2: Add failing IL registry and parser tests**

Modify imports in `crawler/tests/test_state_live_sources.py`:

```python
from apsi_crawler.spiders.il_bidbuy import (
    IL_BIDBUY_OPEN_BIDS_URL,
    IlBidBuyError,
    fetch_il_bidbuy_opportunities,
)
```

Change `FakeResponse.__init__` in `crawler/tests/test_state_live_sources.py` to include headers:

```python
class FakeResponse:
    def __init__(
        self,
        status_code=200,
        payload=None,
        text="",
        json_error=None,
        headers=None,
    ):
        self.status_code = status_code
        self._payload = payload
        self.text = text
        self._json_error = json_error
        self.headers = headers or {"Content-Type": "application/json"}
```

Change `FakeSession.get` in the same file so HTML fetch tests can inspect request headers:

```python
    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "params": params, "headers": headers, "timeout": timeout}
        )
        if isinstance(self.response, Exception):
            raise self.response
        return self.response
```

Add this registry test after the FL registry test:

```python
def test_registry_reports_live_support_for_il_bidbuy():
    assert supports_live_fetch("il_bidbuy") is True
    assert get_live_fetcher("il_bidbuy") is fetch_il_bidbuy_opportunities
```

Replace `test_registry_reports_unsupported_live_state_sources` with a synthetic no-live source so IL can become supported:

```python
def test_registry_reports_unsupported_live_state_sources(monkeypatch):
    from apsi_crawler.sources.base import Source
    from apsi_crawler.sources import registry

    monkeypatch.setitem(
        registry.STATE_SOURCES,
        "test_static_source",
        Source(
            id="test_static_source",
            name="Static Test Source",
            source_label="Static Test Source",
            jurisdiction="state",
            state_code="TS",
            fixture_loader=lambda path: [],
        ),
    )

    assert supports_live_fetch("test_static_source") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("test_static_source")

    assert str(error.value) == "Live fetch is not implemented for source: test_static_source"
```

Append these IL tests near the FL adapter tests:

```python
def test_fetch_il_bidbuy_opportunities_replays_html_fixture():
    bids = fetch_il_bidbuy_opportunities(
        get_source("il_bidbuy"),
        query="data",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "il_bidbuy_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source"] == "Illinois BidBuy"
    assert bid["source_bid_id"] == "IL-BIDBUY-2026-001"
    assert bid["dedupe_key"] == "il_bidbuy:IL-BIDBUY-2026-001"
    assert bid["title"] == "Enterprise data integration services"
    assert bid["description"] == "Enterprise data integration services"
    assert bid["issuer_name"] == "Illinois Department of Innovation and Technology"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "IL"
    assert bid["deadline_date"] == "06/30/2026 02:00 PM"
    assert bid["source_url"] == (
        "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?"
        "docId=IL-BIDBUY-2026-001"
    )
    assert bid["raw_payload"]["alternate_id"] == "DoIT-26-Data"
    assert bid["raw_payload"]["status"] == "Open"


def test_fetch_il_bidbuy_opportunities_uses_public_open_bids_page():
    fixture_path = FIXTURES_DIR / "il_bidbuy_open_bids.html"
    session = FakeSession(
        FakeResponse(
            text=fixture_path.read_text(encoding="utf-8"),
            headers={"Content-Type": "text/html; charset=utf-8"},
        )
    )

    bids = fetch_il_bidbuy_opportunities(
        get_source("il_bidbuy"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == IL_BIDBUY_OPEN_BIDS_URL
    assert session.calls[0]["params"] == {"openBids": "true"}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1


def test_fetch_il_bidbuy_opportunities_raises_when_required_headers_missing():
    html = """
    <table>
      <tr><th>Description</th></tr>
      <tr><td>Enterprise data integration services</td></tr>
    </table>
    """

    with pytest.raises(IlBidBuyError) as error:
        fetch_il_bidbuy_opportunities(
            get_source("il_bidbuy"),
            limit=5,
            fixture_html=None,
            fixture_json=None,
            session=FakeSession(
                FakeResponse(
                    text=html,
                    headers={"Content-Type": "text/html; charset=utf-8"},
                )
            ),
        )

    assert str(error.value) == "Illinois BidBuy page missing expected bid table headers"


def test_fetch_il_bidbuy_opportunities_raises_when_row_missing_source_id(tmp_path):
    fixture = tmp_path / "il_missing_id.html"
    fixture.write_text(
        """
        <table>
          <tr>
            <th>Bid Solicitation #</th>
            <th>Description</th>
            <th>Organization Name</th>
            <th>Bid Opening Date</th>
            <th>Status</th>
            <th>Alternate Id</th>
          </tr>
          <tr>
            <td></td>
            <td>Enterprise data integration services</td>
            <td>Illinois Department of Innovation and Technology</td>
            <td>06/30/2026 02:00 PM</td>
            <td>Open</td>
            <td>DoIT-26-Data</td>
          </tr>
        </table>
        """,
        encoding="utf-8",
    )

    with pytest.raises(IlBidBuyError) as error:
        fetch_il_bidbuy_opportunities(
            get_source("il_bidbuy"),
            limit=5,
            fixture_html=str(fixture),
        )

    assert str(error.value) == "Illinois BidBuy row is missing bid solicitation number"
```

- [ ] **Step 3: Add failing CLI `--fixture-html` test**

Append to `crawler/tests/test_state_live_cli.py`:

```python
def test_fetch_state_replays_il_bidbuy_fixture_html(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "il_bidbuy_open_bids.html"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
            "--query",
            "data",
            "--limit",
            "5",
            "--fixture-html",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Illinois BidBuy",
        "IL-BIDBUY-2026-001",
        "il_bidbuy:IL-BIDBUY-2026-001",
        "Enterprise data integration services",
        "IL",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("il_bidbuy", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "data",
        "limit": 5,
        "fixture_html": str(fixture),
    }
```

Replace `test_fetch_state_unsupported_source_writes_failure_log` in `crawler/tests/test_state_live_cli.py` with:

```python
def test_fetch_state_unsupported_source_writes_failure_log(tmp_path, monkeypatch):
    from apsi_crawler.sources.base import Source
    from apsi_crawler.sources import registry

    monkeypatch.setitem(
        registry.STATE_SOURCES,
        "test_static_source",
        Source(
            id="test_static_source",
            name="Static Test Source",
            source_label="Static Test Source",
            jurisdiction="state",
            state_code="TS",
            fixture_loader=lambda path: [],
        ),
    )
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "test_static_source",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "test_static_source",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: test_static_source",
    )
```

- [ ] **Step 4: Run selected IL tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_sources.py::test_registry_reports_live_support_for_il_bidbuy \
  tests/test_state_live_sources.py::test_fetch_il_bidbuy_opportunities_replays_html_fixture \
  tests/test_state_live_cli.py::test_fetch_state_replays_il_bidbuy_fixture_html \
  -q
```

Expected: fail because `apsi_crawler.spiders.il_bidbuy` and `--fixture-html` support do not exist.

- [ ] **Step 5: Implement IL BidBuy adapter**

Create `crawler/apsi_crawler/spiders/il_bidbuy.py`:

```python
import json

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


IL_BIDBUY_OPEN_BIDS_URL = (
    "https://www.bidbuy.illinois.gov/bso/view/search/external/"
    "advancedSearchBid.xhtml"
)
IL_BIDBUY_OPEN_BIDS_PARAMS = {"openBids": "true"}
IL_BIDBUY_OPEN_BIDS_DISPLAY_URL = f"{IL_BIDBUY_OPEN_BIDS_URL}?openBids=true"
IL_BIDBUY_BASE_URL = "https://www.bidbuy.illinois.gov"
IL_BIDBUY_HEADERS = (
    "Bid Solicitation #",
    "Description",
    "Organization Name",
    "Bid Opening Date",
    "Status",
    "Alternate Id",
)


class IlBidBuyError(Exception):
    pass


def _row_to_record(row):
    source_bid_id = row.get("Bid Solicitation #")
    if not source_bid_id:
        raise IlBidBuyError("Illinois BidBuy row is missing bid solicitation number")

    links = row.get("_links", {})
    detail_href = links.get("Bid Solicitation #")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "deadline_date": row.get("Bid Opening Date"),
        "issuer_name": row.get("Organization Name"),
        "source_url": absolute_url(IL_BIDBUY_BASE_URL, detail_href)
        if detail_href
        else IL_BIDBUY_OPEN_BIDS_DISPLAY_URL,
        "status": row.get("Status"),
        "alternate_id": row.get("Alternate Id"),
    }


def _records_from_html(html):
    try:
        rows = extract_table_rows(html, required_headers=IL_BIDBUY_HEADERS)
    except HtmlPageError as error:
        raise IlBidBuyError("Illinois BidBuy page missing expected bid table headers") from error
    return [_row_to_record(row) for row in rows]


def _records_from_json(path):
    with open(path, encoding="utf-8") as fixture:
        payload = json.load(fixture)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise IlBidBuyError("Illinois BidBuy fixture JSON did not contain opportunities or results")


def fetch_il_bidbuy_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    fixture_json=None,
):
    limit_count = int(limit)
    if fixture_json:
        records = _records_from_json(fixture_json)
    else:
        if fixture_html:
            html = read_html_fixture(fixture_html)
        else:
            try:
                html = fetch_html(
                    IL_BIDBUY_OPEN_BIDS_URL,
                    session=session,
                    timeout=timeout,
                    params=IL_BIDBUY_OPEN_BIDS_PARAMS,
                )
            except HtmlPageError as error:
                raise IlBidBuyError(str(error)) from error
        records = _records_from_html(html)

    return [
        normalize_state_opportunity(record, source)
        for record in records[:limit_count]
        if not query or query.lower() in " ".join(str(value) for value in record.values()).lower()
    ]
```

- [ ] **Step 6: Register IL live fetcher**

Modify `crawler/apsi_crawler/sources/state_sources.py`:

```python
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
```

Set `il_bidbuy`:

```python
live_fetcher=fetch_il_bidbuy_opportunities,
```

- [ ] **Step 7: Add `--fixture-html` to CLI**

Modify `crawler/apsi_crawler/cli.py`.

Change function signature:

```python
def fetch_state(database, source, query=None, limit=25, fixture_json=None, fixture_html=None):
```

Add metadata:

```python
if fixture_html:
    metadata["fixture_html"] = fixture_html
```

Add fetcher kwargs:

```python
if fixture_html:
    fetch_kwargs["fixture_html"] = fixture_html
```

Add parser argument:

```python
fetch_state_parser.add_argument("--fixture-html")
```

Pass it from `main`:

```python
fixture_html=args.fixture_html,
```

- [ ] **Step 8: Run selected IL tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_html_public_page.py \
  tests/test_state_live_sources.py::test_registry_reports_live_support_for_il_bidbuy \
  tests/test_state_live_sources.py::test_fetch_il_bidbuy_opportunities_replays_html_fixture \
  tests/test_state_live_sources.py::test_fetch_il_bidbuy_opportunities_uses_public_open_bids_page \
  tests/test_state_live_sources.py::test_fetch_il_bidbuy_opportunities_raises_when_required_headers_missing \
  tests/test_state_live_sources.py::test_fetch_il_bidbuy_opportunities_raises_when_row_missing_source_id \
  tests/test_state_live_cli.py::test_fetch_state_replays_il_bidbuy_fixture_html \
  -q
```

Expected: all selected tests pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add \
  crawler/apsi_crawler/spiders/il_bidbuy.py \
  crawler/apsi_crawler/sources/state_sources.py \
  crawler/apsi_crawler/cli.py \
  crawler/tests/test_state_live_sources.py \
  crawler/tests/test_state_live_cli.py \
  crawler/tests/fixtures/il_bidbuy_open_bids.html
git commit -m "feat: add Illinois BidBuy HTML adapter"
```

---

### Task 3: Attachment Discovery and SQLite Persistence

**Files:**
- Create: `crawler/tests/fixtures/il_bidbuy_detail.html`
- Modify: `crawler/apsi_crawler/spiders/il_bidbuy.py`
- Modify: `crawler/apsi_crawler/storage/sqlite.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Modify: `crawler/tests/test_storage.py`
- Modify: `crawler/tests/test_cli.py`

- [ ] **Step 1: Add attachment detail fixture**

Create `crawler/tests/fixtures/il_bidbuy_detail.html`:

```html
<!doctype html>
<html>
  <body>
    <table id="attachments">
      <thead>
        <tr>
          <th>File Name</th>
          <th>Size</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <a href="/bso/external/document.sdo?docId=IL-BIDBUY-2026-001&amp;file=scope.pdf">
              Scope of Work.pdf
            </a>
          </td>
          <td>242 KB</td>
          <td>application/pdf</td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
```

- [ ] **Step 2: Add failing IL attachment discovery tests**

Modify imports in `crawler/tests/test_state_live_sources.py`:

```python
from apsi_crawler.spiders.il_bidbuy import (
    IL_BIDBUY_OPEN_BIDS_URL,
    IlBidBuyError,
    discover_il_bidbuy_attachments,
    fetch_il_bidbuy_opportunities,
)
```

Append:

```python
def test_discover_il_bidbuy_attachments_from_detail_html_fixture():
    attachments = discover_il_bidbuy_attachments(
        str(FIXTURES_DIR / "il_bidbuy_detail.html"),
        base_url="https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
    )

    assert attachments == [
        {
            "name": "Scope of Work.pdf",
            "url": (
                "https://www.bidbuy.illinois.gov/bso/external/document.sdo?"
                "docId=IL-BIDBUY-2026-001&file=scope.pdf"
            ),
            "size_label": "242 KB",
            "mime_type": "application/pdf",
            "sort_order": 0,
        }
    ]


def test_discover_il_bidbuy_attachments_raises_on_missing_attachment_url(tmp_path):
    fixture = tmp_path / "detail_missing_url.html"
    fixture.write_text(
        """
        <table>
          <tr><th>File Name</th><th>Size</th><th>Type</th></tr>
          <tr><td>Scope of Work.pdf</td><td>242 KB</td><td>application/pdf</td></tr>
        </table>
        """,
        encoding="utf-8",
    )

    with pytest.raises(IlBidBuyError) as error:
        discover_il_bidbuy_attachments(
            str(fixture),
            base_url="https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo",
        )

    assert str(error.value) == "Illinois BidBuy attachment row is missing URL"
```

- [ ] **Step 3: Add failing storage attachment tests**

Append to `crawler/tests/test_storage.py`:

```python
def test_upsert_bid_writes_and_replaces_attachments_when_table_exists(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE bid_attachments (
          id TEXT PRIMARY KEY,
          bid_id TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          size_label TEXT,
          mime_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        """
    )

    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-001",
        "source": "Illinois BidBuy",
        "source_bid_id": "IL-BIDBUY-2026-001",
        "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
        "title": "Enterprise data integration services",
        "description": "Enterprise data integration services",
        "issuer_name": "Illinois Department of Innovation and Technology",
        "issuer_type": "state",
        "state_code": "IL",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
        "attachments": [
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "size_label": "242 KB",
                "mime_type": "application/pdf",
                "sort_order": 3,
            }
        ],
    }

    assert upsert_bid(connection, bid) == "inserted"
    rows = connection.execute(
        "SELECT id, bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001:attachment:1",
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Scope of Work.pdf",
            "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            "242 KB",
            "application/pdf",
            3,
        )
    ]

    replacement = {
        **bid,
        "attachments": [
            {
                "name": "Pricing Sheet.xlsx",
                "url": "https://www.bidbuy.illinois.gov/documents/pricing.xlsx",
            }
        ],
    }
    assert upsert_bid(connection, replacement) == "updated"
    rows = connection.execute(
        "SELECT id, bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001:attachment:1",
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Pricing Sheet.xlsx",
            "https://www.bidbuy.illinois.gov/documents/pricing.xlsx",
            None,
            None,
            0,
        )
    ]


def test_upsert_bid_ignores_attachments_when_attachment_table_missing(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )

    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-001",
        "source": "Illinois BidBuy",
        "source_bid_id": "IL-BIDBUY-2026-001",
        "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
        "title": "Enterprise data integration services",
        "description": "Enterprise data integration services",
        "issuer_name": "Illinois Department of Innovation and Technology",
        "issuer_type": "state",
        "state_code": "IL",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
        "attachments": [
            {"name": "Scope of Work.pdf", "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf"}
        ],
    }

    assert upsert_bid(connection, bid) == "inserted"
```

- [ ] **Step 4: Add `bid_attachments` table to crawler test database helper**

Modify `crawler/tests/test_cli.py::create_crawler_database` by adding after the `bids` table:

```sql
        CREATE TABLE bid_attachments (
          id TEXT PRIMARY KEY,
          bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          size_label TEXT,
          mime_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
```

- [ ] **Step 5: Run attachment tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_sources.py::test_discover_il_bidbuy_attachments_from_detail_html_fixture \
  tests/test_state_live_sources.py::test_discover_il_bidbuy_attachments_raises_on_missing_attachment_url \
  tests/test_storage.py::test_upsert_bid_writes_and_replaces_attachments_when_table_exists \
  tests/test_storage.py::test_upsert_bid_ignores_attachments_when_attachment_table_missing \
  -q
```

Expected: fail because `discover_il_bidbuy_attachments` and attachment persistence do not exist.

- [ ] **Step 6: Implement IL attachment discovery**

Add to `crawler/apsi_crawler/spiders/il_bidbuy.py`:

```python
IL_BIDBUY_ATTACHMENT_HEADERS = ("File Name", "Size", "Type")


def discover_il_bidbuy_attachments(fixture_html, base_url):
    html = read_html_fixture(fixture_html)
    try:
        rows = extract_table_rows(html, required_headers=IL_BIDBUY_ATTACHMENT_HEADERS)
    except HtmlPageError as error:
        raise IlBidBuyError("Illinois BidBuy detail page missing expected attachment table headers") from error

    attachments = []
    for index, row in enumerate(rows):
        links = row.get("_links", {})
        href = links.get("File Name")
        if not href:
            raise IlBidBuyError("Illinois BidBuy attachment row is missing URL")
        attachments.append(
            {
                "name": row.get("File Name") or f"Attachment {index + 1}",
                "url": absolute_url(base_url, href),
                "size_label": row.get("Size") or None,
                "mime_type": row.get("Type") or None,
                "sort_order": index,
            }
        )
    return attachments
```

- [ ] **Step 7: Implement attachment persistence**

Modify `crawler/apsi_crawler/storage/sqlite.py`.

Add:

```python
def _table_exists(connection, table_name):
    row = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        (table_name,),
    ).fetchone()
    return row is not None
```

Add:

```python
def _replace_bid_attachments(connection, bid):
    if not _table_exists(connection, "bid_attachments"):
        return

    table_columns = _table_columns(connection, "bid_attachments")
    bid_id = bid["id"]
    connection.execute("DELETE FROM bid_attachments WHERE bid_id = ?", (bid_id,))

    for index, attachment in enumerate(bid.get("attachments") or []):
        url = attachment.get("url")
        if not url:
            continue
        values = {
            "id": f"{bid_id}:attachment:{index + 1}",
            "bid_id": bid_id,
            "name": attachment.get("name") or f"Attachment {index + 1}",
            "url": url,
            "size_label": attachment.get("size_label"),
            "mime_type": attachment.get("mime_type"),
            "sort_order": attachment.get("sort_order", index),
            "created_at": now_iso(),
        }
        _execute_insert(
            connection,
            "bid_attachments",
            {column: value for column, value in values.items() if column in table_columns},
        )
```

Call `_replace_bid_attachments(connection, bid)` before each `connection.commit()` in `upsert_bid`, after the bid row insert/update has executed.

- [ ] **Step 8: Run attachment tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_sources.py::test_discover_il_bidbuy_attachments_from_detail_html_fixture \
  tests/test_state_live_sources.py::test_discover_il_bidbuy_attachments_raises_on_missing_attachment_url \
  tests/test_storage.py::test_upsert_bid_writes_and_replaces_attachments_when_table_exists \
  tests/test_storage.py::test_upsert_bid_ignores_attachments_when_attachment_table_missing \
  -q
```

Expected: all selected tests pass.

- [ ] **Step 9: Add CLI proof that imported attachments persist**

Modify `crawler/tests/test_state_live_cli.py::test_fetch_state_replays_il_bidbuy_fixture_html` to also assert:

```python
assert connection.execute("SELECT COUNT(*) FROM bid_attachments").fetchone()[0] == 0
```

Then append a storage-focused CLI test using monkeypatch:

```python
def test_fetch_state_persists_attachments_from_live_fetcher(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    bid = state_bid()
    bid.update(
        {
            "id": "il_bidbuy:IL-BIDBUY-2026-001",
            "source": "Illinois BidBuy",
            "source_bid_id": "IL-BIDBUY-2026-001",
            "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
            "title": "Enterprise data integration services",
            "state_code": "IL",
            "attachments": [
                {
                    "name": "Scope of Work.pdf",
                    "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                    "size_label": "242 KB",
                    "mime_type": "application/pdf",
                    "sort_order": 0,
                }
            ],
        }
    )

    def fake_fetcher(source, query=None, limit=25):
        return [bid]

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    rows = connection.execute(
        "SELECT bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Scope of Work.pdf",
            "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            "242 KB",
            "application/pdf",
            0,
        )
    ]
```

- [ ] **Step 10: Run CLI/storage attachment tests**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_cli.py::test_fetch_state_replays_il_bidbuy_fixture_html \
  tests/test_state_live_cli.py::test_fetch_state_persists_attachments_from_live_fetcher \
  tests/test_storage.py \
  -q
```

Expected: all selected tests pass.

- [ ] **Step 11: Commit**

Run:

```bash
git add \
  crawler/apsi_crawler/spiders/il_bidbuy.py \
  crawler/apsi_crawler/storage/sqlite.py \
  crawler/tests/test_state_live_sources.py \
  crawler/tests/test_state_live_cli.py \
  crawler/tests/test_storage.py \
  crawler/tests/test_cli.py \
  crawler/tests/fixtures/il_bidbuy_detail.html
git commit -m "feat: persist crawler bid attachments"
```

---

### Task 4: Full Verification and Cleanup

**Files:**
- Modify only files needed to fix failures found by these commands.

- [ ] **Step 1: Run crawler test suite**

Run:

```bash
cd crawler
python3 -m pytest
```

Expected: all crawler tests pass.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
cd frontend
npm test
```

Expected: all frontend tests pass.

- [ ] **Step 3: Run frontend lint**

Run:

```bash
cd frontend
npm run lint
```

Expected: lint passes.

- [ ] **Step 4: Run frontend build**

Run:

```bash
cd frontend
npm run build
```

Expected: build passes.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intentional implementation files are modified after the last commit if verification fixes were needed.

- [ ] **Step 6: Commit verification fixes if any were required**

If Step 5 shows files modified to fix verification failures, stage the implementation/test files that belong to this plan:

```bash
git add \
  crawler/apsi_crawler/html/__init__.py \
  crawler/apsi_crawler/html/public_page.py \
  crawler/apsi_crawler/spiders/il_bidbuy.py \
  crawler/apsi_crawler/storage/sqlite.py \
  crawler/apsi_crawler/cli.py \
  crawler/apsi_crawler/sources/state_sources.py \
  crawler/tests/test_html_public_page.py \
  crawler/tests/test_state_live_sources.py \
  crawler/tests/test_state_live_cli.py \
  crawler/tests/test_storage.py \
  crawler/tests/test_cli.py \
  crawler/tests/fixtures/il_bidbuy_open_bids.html \
  crawler/tests/fixtures/il_bidbuy_detail.html
git commit -m "test: verify IL HTML attachment integration"
```

Expected: commit succeeds. If Step 5 shows a clean worktree, do not create an empty commit.

---

## Implementation Order

1. Task 1: HTML utility layer.
2. Task 2: IL BidBuy adapter and `--fixture-html`.
3. Task 3: Attachment discovery and SQLite persistence.
4. Task 4: Full verification.

## Remaining Functional Work After This Plan

After this plan is implemented and verified, the remaining product work will be:

1. Browser-backed Playwright fetching for portals where public HTTP/HTML is insufficient.
2. PDF/DOCX download and text extraction.
3. AI summaries and compliance/risk extraction from documents.
4. Real SMTP/email delivery.
5. Production scheduling, retries, and crawler health alerting.
