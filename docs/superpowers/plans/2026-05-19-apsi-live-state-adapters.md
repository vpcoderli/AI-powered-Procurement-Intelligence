# APSi Live State Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested live state procurement adapter foundation with a `fetch-state` CLI command and one reference state adapter.

**Architecture:** Keep fixture imports intact and add live fetching as a separate capability on `Source`. The crawler CLI will own persistence and crawler logs, while source-specific adapter modules fetch and normalize public records into the existing bid shape.

**Tech Stack:** Python 3.9+, `requests`, `pytest`, SQLite, existing APSi crawler package.

---

## File Structure

- Modify `crawler/apsi_crawler/sources/base.py`
  - Extend `Source` with optional `live_fetcher`.
- Modify `crawler/apsi_crawler/sources/state_sources.py`
  - Register `ca_caleprocure` with a live fetcher.
  - Leave TX/NY/FL/IL as known fixture-backed sources without live support.
- Modify `crawler/apsi_crawler/sources/registry.py`
  - Add `UnsupportedLiveSourceError`, `supports_live_fetch`, and `get_live_fetcher`.
- Create `crawler/apsi_crawler/spiders/ca_caleprocure.py`
  - Implement the first reference live adapter.
  - Support HTTP fetch and deterministic local replay from JSON or HTML test fixtures.
- Modify `crawler/apsi_crawler/cli.py`
  - Add `fetch-state` command.
  - Write success and failure `crawler_logs` rows.
- Create `crawler/tests/fixtures/ca_caleprocure_live_response.json`
  - Recorded public-response-style payload for deterministic adapter tests.
- Create `crawler/tests/test_state_live_sources.py`
  - Registry and adapter unit tests.
- Create `crawler/tests/test_state_live_cli.py`
  - CLI success, unsupported-source failure, and adapter failure tests.

---

### Task 1: Live Fetcher Registry

**Files:**
- Modify: `crawler/apsi_crawler/sources/base.py`
- Modify: `crawler/apsi_crawler/sources/registry.py`
- Test: `crawler/tests/test_state_live_sources.py`

- [ ] **Step 1: Write the failing registry tests**

Add this new test file:

```python
from apsi_crawler.sources.registry import (
    UnsupportedLiveSourceError,
    get_live_fetcher,
    supports_live_fetch,
)


def test_registry_reports_live_support_for_reference_state():
    assert supports_live_fetch("ca_caleprocure") is True
    assert callable(get_live_fetcher("ca_caleprocure"))


def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("tx_esbd") is False

    try:
        get_live_fetcher("tx_esbd")
    except UnsupportedLiveSourceError as error:
        assert str(error) == "Live fetch is not implemented for source: tx_esbd"
    else:
        raise AssertionError("Expected UnsupportedLiveSourceError")
```

- [ ] **Step 2: Run the registry tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: fail because `supports_live_fetch`, `get_live_fetcher`, and `UnsupportedLiveSourceError` do not exist yet.

- [ ] **Step 3: Extend `Source` and registry minimally**

Update `crawler/apsi_crawler/sources/base.py`:

```python
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    source_label: str
    jurisdiction: str
    state_code: str
    fixture_loader: object
    live_fetcher: Optional[Callable] = None
```

Update `crawler/apsi_crawler/sources/registry.py`:

```python
from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.base import Source
from apsi_crawler.sources.state_sources import STATE_SOURCES
from apsi_crawler.spiders.sam_gov import load_fixture_opportunities


class UnsupportedLiveSourceError(Exception):
    """Raised when a known source does not have a live fetcher."""


SAM_GOV_SOURCE = Source(
    id="sam_gov",
    name="SAM.gov",
    source_label="SAM.gov",
    jurisdiction="federal",
    state_code="US",
    fixture_loader=load_fixture_opportunities,
)

SOURCES = {
    "sam_gov": SAM_GOV_SOURCE,
    **STATE_SOURCES,
}

SOURCE_ALIASES = {
    DEFAULT_SOURCE: "sam_gov",
}


def get_source(source=DEFAULT_SOURCE):
    source_id = SOURCE_ALIASES.get(source, source)
    return SOURCES[source_id]


def list_sources():
    return list(SOURCES.values())


def get_fixture_loader(source=DEFAULT_SOURCE):
    source_metadata = get_source(source)

    def load(path):
        if source_metadata.jurisdiction == "state":
            return source_metadata.fixture_loader(path, source_metadata)
        return source_metadata.fixture_loader(path)

    return load


def supports_live_fetch(source=DEFAULT_SOURCE):
    return get_source(source).live_fetcher is not None


def get_live_fetcher(source=DEFAULT_SOURCE):
    source_metadata = get_source(source)
    if source_metadata.live_fetcher is None:
        raise UnsupportedLiveSourceError(f"Live fetch is not implemented for source: {source_metadata.id}")
    return source_metadata.live_fetcher
```

- [ ] **Step 4: Add a temporary CA live fetcher registration**

Update `crawler/apsi_crawler/sources/state_sources.py` with a stub import and registration:

```python
from apsi_crawler.sources.base import Source
from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.state_fixture import load_state_fixture_opportunities
```

Set only `ca_caleprocure`:

```python
live_fetcher=fetch_ca_caleprocure_opportunities,
```

- [ ] **Step 5: Create temporary CA module**

Create `crawler/apsi_crawler/spiders/ca_caleprocure.py`:

```python
def fetch_ca_caleprocure_opportunities(*args, **kwargs):
    return []
```

- [ ] **Step 6: Run registry tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: `2 passed`.

- [ ] **Step 7: Commit**

Run:

```bash
git add crawler/apsi_crawler/sources/base.py crawler/apsi_crawler/sources/registry.py crawler/apsi_crawler/sources/state_sources.py crawler/apsi_crawler/spiders/ca_caleprocure.py crawler/tests/test_state_live_sources.py
git commit -m "feat: add state live fetcher registry"
```

---

### Task 2: California Live Adapter

**Files:**
- Modify: `crawler/apsi_crawler/spiders/ca_caleprocure.py`
- Create: `crawler/tests/fixtures/ca_caleprocure_live_response.json`
- Modify: `crawler/tests/test_state_live_sources.py`

- [ ] **Step 1: Add the recorded response fixture**

Create `crawler/tests/fixtures/ca_caleprocure_live_response.json`:

```json
{
  "opportunities": [
    {
      "eventId": "CA-LIVE-2026-001",
      "title": "Cloud data warehouse modernization",
      "department": "Department of Technology",
      "description": "Modernize analytics and reporting services.",
      "category": "Information Technology",
      "postedDate": "2026-05-18",
      "dueDate": "2026-06-10",
      "url": "https://caleprocure.ca.gov/event/CA-LIVE-2026-001"
    }
  ]
}
```

- [ ] **Step 2: Add failing adapter tests**

Append to `crawler/tests/test_state_live_sources.py`:

```python
from pathlib import Path

from apsi_crawler.sources.registry import get_source
from apsi_crawler.spiders.ca_caleprocure import (
    CalEProcureError,
    fetch_ca_caleprocure_opportunities,
)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append({"url": url, "params": params, "timeout": timeout})
        return self.response


def test_ca_caleprocure_fetches_and_normalizes_json_payload():
    payload_path = Path(__file__).parent / "fixtures" / "ca_caleprocure_live_response.json"
    payload = __import__("json").loads(payload_path.read_text())
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_ca_caleprocure_opportunities(
        get_source("ca_caleprocure"),
        query="cloud",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "ca_caleprocure:CA-LIVE-2026-001"
    assert bids[0]["title"] == "Cloud data warehouse modernization"
    assert bids[0]["issuer_name"] == "Department of Technology"
    assert bids[0]["issuer_type"] == "state"
    assert bids[0]["state_code"] == "CA"
    assert bids[0]["source_url"] == "https://caleprocure.ca.gov/event/CA-LIVE-2026-001"
    assert session.calls[0]["params"] == {"query": "cloud", "limit": 5}


def test_ca_caleprocure_raises_adapter_error_for_http_failure():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    try:
        fetch_ca_caleprocure_opportunities(get_source("ca_caleprocure"), session=session)
    except CalEProcureError as error:
        assert str(error) == "Cal eProcure request failed with status 503: maintenance"
    else:
        raise AssertionError("Expected CalEProcureError")
```

- [ ] **Step 3: Run adapter tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: fail because the adapter returns an empty list and `CalEProcureError` does not exist.

- [ ] **Step 4: Implement the adapter**

Replace `crawler/apsi_crawler/spiders/ca_caleprocure.py`:

```python
import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


CA_CALEPROCURE_SEARCH_URL = "https://caleprocure.ca.gov/pages/search.aspx"


class CalEProcureError(Exception):
    """Raised when Cal eProcure opportunities cannot be fetched."""


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    return payload.get("opportunities", payload.get("results", []))


def _normalize_record(record):
    return {
        "source_bid_id": record.get("source_bid_id") or record.get("eventId") or record.get("id"),
        "title": record.get("title") or record.get("name"),
        "description": record.get("description") or record.get("summary", ""),
        "original_category": record.get("category") or record.get("type", ""),
        "published_date": record.get("published_date") or record.get("postedDate"),
        "deadline_date": record.get("deadline_date") or record.get("dueDate"),
        "issuer_name": record.get("issuer_name") or record.get("department") or record.get("agency"),
        "source_url": record.get("source_url") or record.get("url", ""),
        "raw": record,
    }


def fetch_ca_caleprocure_opportunities(source, query=None, limit=25, session=None, timeout=30):
    client = session or requests.Session()
    params = {"query": query or "", "limit": int(limit)}
    response = client.get(CA_CALEPROCURE_SEARCH_URL, params=params, timeout=timeout)

    if response.status_code != 200:
        raise CalEProcureError(
            f"Cal eProcure request failed with status {response.status_code}: {response.text}"
        )

    try:
        payload = response.json()
    except ValueError as error:
        raise CalEProcureError("Cal eProcure response was not valid JSON") from error

    bids = []
    for record in _records_from_payload(payload)[: int(limit)]:
        normalized = _normalize_record(record)
        normalized["raw_payload"] = record
        bids.append(normalize_state_opportunity(normalized, source))
    return bids
```

- [ ] **Step 5: Run adapter tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: all tests in `test_state_live_sources.py` pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/ca_caleprocure.py crawler/tests/fixtures/ca_caleprocure_live_response.json crawler/tests/test_state_live_sources.py
git commit -m "feat: add California live state adapter"
```

---

### Task 3: `fetch-state` CLI

**Files:**
- Modify: `crawler/apsi_crawler/cli.py`
- Create: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Write failing CLI tests**

Create `crawler/tests/test_state_live_cli.py`:

```python
import json
import sqlite3

from apsi_crawler.cli import main
from tests.test_cli import create_crawler_database, normalized_bid


def state_bid():
    bid = normalized_bid()
    bid.update(
        {
            "id": "ca_caleprocure:CA-LIVE-2026-001",
            "source": "California Cal eProcure",
            "source_bid_id": "CA-LIVE-2026-001",
            "dedupe_key": "ca_caleprocure:CA-LIVE-2026-001",
            "title": "Cloud data warehouse modernization",
            "issuer_name": "Department of Technology",
            "issuer_type": "state",
            "state_code": "CA",
            "source_url": "https://caleprocure.ca.gov/event/CA-LIVE-2026-001",
        }
    )
    return bid


def test_fetch_state_writes_bids_and_success_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    calls = []

    def fake_fetcher(source, query=None, limit=25):
        calls.append({"source": source.id, "query": query, "limit": limit})
        return [state_bid()]

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--query",
            "cloud",
            "--limit",
            "5",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert calls == [{"source": "ca_caleprocure", "query": "cloud", "limit": 5}]
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("ca_caleprocure", "success", 1, 1, 0)
    assert json.loads(log[5]) == {"mode": "live", "query": "cloud", "limit": 5}


def test_fetch_state_unsupported_source_writes_failure_log(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "tx_esbd",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "tx_esbd",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: tx_esbd",
    )


def test_fetch_state_adapter_failure_writes_failure_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetcher(source, query=None, limit=25):
        raise RuntimeError("state portal unavailable")

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == ("ca_caleprocure", "failure", 1, "RuntimeError", "state portal unavailable")
```

- [ ] **Step 2: Run CLI tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_cli.py -q
```

Expected: fail because `fetch-state` is not a supported command.

- [ ] **Step 3: Implement `fetch_state` in `cli.py`**

Add imports near the top of `crawler/apsi_crawler/cli.py`:

```python
from apsi_crawler.sources.registry import get_fixture_loader, get_live_fetcher, get_source
```

Add this function after `fetch_sam_gov`:

```python
def fetch_state(database, source, query=None, limit=25):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    Path(database).parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database)
    metadata = {"mode": "live", "query": query, "limit": limit}
    try:
        source_metadata = get_source(source)
        fetcher = get_live_fetcher(source)
        bids = fetcher(source_metadata, query=query, limit=limit)
        inserted_count, updated_count = _upsert_bids(connection, bids)

        write_crawler_log(
            connection,
            source=source_metadata.id,
            run_id=run_id,
            status="success",
            fetched_count=len(bids),
            inserted_count=inserted_count,
            updated_count=updated_count,
            started_at=started_at,
            finished_at=now_iso(),
            duration_ms=int((perf_counter() - started) * 1000),
            metadata=metadata,
        )
        return 0
    except Exception as error:
        write_crawler_log(
            connection,
            source=source,
            run_id=run_id,
            status="failure",
            fetched_count=0,
            inserted_count=0,
            updated_count=0,
            failed_count=1,
            started_at=started_at,
            finished_at=now_iso(),
            duration_ms=int((perf_counter() - started) * 1000),
            error_code=type(error).__name__,
            error_message=str(error),
            error_stack=traceback.format_exc(),
            metadata=metadata,
        )
        return 1
    finally:
        connection.close()
```

Update `build_parser()`:

```python
    fetch_state_parser = subparsers.add_parser("fetch-state")
    fetch_state_parser.add_argument("--database", required=True)
    fetch_state_parser.add_argument("--source", required=True)
    fetch_state_parser.add_argument("--query")
    fetch_state_parser.add_argument("--limit", type=int, default=25)
```

Update `main()`:

```python
    if args.command == "fetch-state":
        return fetch_state(
            args.database,
            source=args.source,
            query=args.query,
            limit=args.limit,
        )
```

- [ ] **Step 4: Run CLI tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_cli.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Run state live focused tests**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py tests/test_state_live_cli.py -q
```

Expected: all live-state tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/cli.py crawler/tests/test_state_live_cli.py
git commit -m "feat: add fetch-state crawler command"
```

---

### Task 4: Full Verification and Cleanup

**Files:**
- Verify all modified crawler files.
- No source changes expected unless verification finds a defect.

- [ ] **Step 1: Run full crawler tests**

Run:

```bash
cd crawler
python3 -m pytest
```

Expected: all crawler tests pass.

- [ ] **Step 2: Run frontend tests if shared database assumptions changed**

Run:

```bash
cd frontend
npm test
```

Expected: all frontend tests pass.

- [ ] **Step 3: Run frontend lint and build if no frontend files changed**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: lint and production build pass. This protects the admin/source-health pages that read crawler logs.

- [ ] **Step 4: Check local runtime artifacts**

Run:

```bash
find crawler frontend -maxdepth 3 \( -name '.pytest_cache' -o -name 'apsi.sqlite*' -o -name 'notification-outbox' \) -print
```

Expected: only disposable runtime artifacts are listed. Remove them before the final status:

```bash
rm -rf crawler/.pytest_cache frontend/data/apsi.sqlite frontend/data/apsi.sqlite-shm frontend/data/apsi.sqlite-wal frontend/data/notification-outbox
```

- [ ] **Step 5: Confirm git status**

Run:

```bash
git status --short
```

Expected: clean working tree after commits and cleanup.

---

## Self-Review

- Spec coverage: The plan implements the live adapter interface, registry, `fetch-state` CLI, success/failure logs, one reference adapter, unsupported-source behavior, and Python tests.
- Scope control: The plan does not add browser automation, attachment downloading, production scheduling, or all five live adapters.
- Type consistency: `Source.live_fetcher`, `get_live_fetcher`, `supports_live_fetch`, `fetch_ca_caleprocure_opportunities`, and `fetch_state` use matching signatures.
- Test-first ordering: Every production behavior starts with a failing test and a RED verification step.
