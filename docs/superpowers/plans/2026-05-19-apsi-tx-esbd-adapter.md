# APSi Texas ESBD Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Texas ESBD as the second live state adapter with deterministic fixture replay and clear non-JSON/invalid payload failures.

**Architecture:** Reuse the existing state live adapter contract and `fetch-state` CLI. Texas gets its own focused spider module that mirrors the CA adapter shape, while registry and CLI tests prove TX is live-supported and can import replayed bid records into SQLite.

**Tech Stack:** Python 3.9+, `requests`, `pytest`, SQLite, existing APSi crawler package.

---

## File Structure

- Create `crawler/apsi_crawler/spiders/tx_esbd.py`
  - Texas-specific HTTP/replay fetcher, payload validation, record mapping, and `TxEsbdError`.
- Modify `crawler/apsi_crawler/sources/state_sources.py`
  - Register `tx_esbd` with `live_fetcher=fetch_tx_esbd_opportunities`.
- Modify `crawler/tests/test_state_live_sources.py`
  - Add TX registry and adapter behavior tests.
  - Change unsupported live source test from TX to NY.
- Modify `crawler/tests/test_state_live_cli.py`
  - Add TX replay CLI success test.
  - Change unsupported live source test from TX to NY.
- Create `crawler/tests/fixtures/tx_esbd_live_response.json`
  - Recorded replay payload for deterministic TX adapter tests.

---

### Task 1: TX Registry and Adapter Skeleton

**Files:**
- Create: `crawler/apsi_crawler/spiders/tx_esbd.py`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_live_sources.py`

- [ ] **Step 1: Write failing registry test**

Modify `crawler/tests/test_state_live_sources.py` imports:

```python
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities
```

Add this test after the CA registry test:

```python
def test_registry_reports_live_support_for_texas_esbd():
    assert supports_live_fetch("tx_esbd") is True
    assert get_live_fetcher("tx_esbd") is fetch_tx_esbd_opportunities
```

Change the unsupported-source test to NY:

```python
def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("ny_contract_reporter") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("ny_contract_reporter")

    assert str(error.value) == "Live fetch is not implemented for source: ny_contract_reporter"
```

- [ ] **Step 2: Run registry test to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py::test_registry_reports_live_support_for_texas_esbd -q
```

Expected: fail because `apsi_crawler.spiders.tx_esbd` does not exist or TX has no live fetcher.

- [ ] **Step 3: Create minimal TX spider skeleton**

Create `crawler/apsi_crawler/spiders/tx_esbd.py`:

```python
def fetch_tx_esbd_opportunities(*args, **kwargs):
    return []
```

- [ ] **Step 4: Register TX live fetcher**

Modify `crawler/apsi_crawler/sources/state_sources.py`:

```python
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities
```

Set `tx_esbd`:

```python
live_fetcher=fetch_tx_esbd_opportunities,
```

- [ ] **Step 5: Run registry tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py::test_registry_reports_live_support_for_texas_esbd tests/test_state_live_sources.py::test_registry_reports_unsupported_live_state_sources -q
```

Expected: both tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/tx_esbd.py crawler/apsi_crawler/sources/state_sources.py crawler/tests/test_state_live_sources.py
git commit -m "feat: register Texas ESBD live fetcher"
```

---

### Task 2: TX Adapter Behavior

**Files:**
- Modify: `crawler/apsi_crawler/spiders/tx_esbd.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Create: `crawler/tests/fixtures/tx_esbd_live_response.json`

- [ ] **Step 1: Add TX live response fixture**

Create `crawler/tests/fixtures/tx_esbd_live_response.json`:

```json
{
  "opportunities": [
    {
      "solicitationId": "ESBD-LIVE-2026-77",
      "solicitationTitle": "Statewide data catalog services",
      "description": "Implement a statewide data catalog.",
      "classItem": "Technology",
      "postedDate": "2026-05-02",
      "dueDate": "2026-06-12T14:00:00-05:00",
      "agency": "Texas Department of Information Resources",
      "link": "https://www.txsmartbuy.gov/esbd/ESBD-LIVE-2026-77"
    }
  ]
}
```

- [ ] **Step 2: Add failing TX adapter tests**

Modify imports in `crawler/tests/test_state_live_sources.py`:

```python
from apsi_crawler.spiders.tx_esbd import (
    TxEsbdError,
    fetch_tx_esbd_opportunities,
)
```

Append these tests:

```python
def test_fetch_tx_esbd_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "tx_esbd_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == "https://www.txsmartbuy.gov/esbd"
    assert session.calls[0]["params"] == {"query": "data", "limit": 5}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "tx_esbd:ESBD-LIVE-2026-77"
    assert bid["title"] == "Statewide data catalog services"
    assert bid["issuer_name"] == "Texas Department of Information Resources"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "TX"
    assert bid["source_url"] == "https://www.txsmartbuy.gov/esbd/ESBD-LIVE-2026-77"


def test_fetch_tx_esbd_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD response did not contain opportunities or results"


def test_fetch_tx_esbd_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Data"}]}))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD record is missing source id"


def test_fetch_tx_esbd_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "ESBD-NORMALIZED-001",
                    "title": "Normalized Texas services",
                    "source_url": "https://www.txsmartbuy.gov/esbd/ESBD-NORMALIZED-001",
                    "published_date": "2026-05-03",
                    "deadline_date": "2026-06-15",
                    "issuer_name": "Texas Facilities Commission",
                }
            ]
        )
    )

    bids = fetch_tx_esbd_opportunities(
        get_source("tx_esbd"),
        query="data",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "ESBD-NORMALIZED-001"
    assert bid["dedupe_key"] == "tx_esbd:ESBD-NORMALIZED-001"
    assert bid["source_url"] == "https://www.txsmartbuy.gov/esbd/ESBD-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-03"
    assert bid["deadline_date"] == "2026-06-15"
    assert bid["issuer_name"] == "Texas Facilities Commission"


def test_fetch_tx_esbd_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD request failed with status 503: maintenance"


def test_fetch_tx_esbd_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(TxEsbdError) as error:
        fetch_tx_esbd_opportunities(
            get_source("tx_esbd"),
            query="data",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "Texas ESBD request failed: slow"
```

- [ ] **Step 3: Run TX adapter tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: TX adapter tests fail because the skeleton returns an empty list and lacks `TxEsbdError`.

- [ ] **Step 4: Implement TX adapter**

Replace `crawler/apsi_crawler/spiders/tx_esbd.py`:

```python
import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


TX_ESBD_SEARCH_URL = "https://www.txsmartbuy.gov/esbd"


class TxEsbdError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise TxEsbdError("Texas ESBD response did not contain opportunities or results")


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationId", "solicitation_id", "id", "bid_id"),
    )
    if not source_bid_id:
        raise TxEsbdError("Texas ESBD record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name", "solicitationTitle")),
        "description": record.get("description") or record.get("summary"),
        "original_category": _first_present(record, ("category", "classItem", "commodity")),
        "published_date": _first_present(record, ("published_date", "postedDate", "posted_date")),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "dueDate", "due_date", "response_deadline"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "source_url": _first_present(record, ("source_url", "url", "link")),
    }


def fetch_tx_esbd_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    if fixture_json:
        with open(fixture_json) as fixture:
            payload = json.load(fixture)
    else:
        client = session or requests.Session()
        close_client = session is None
        params = {"query": query or "", "limit": limit_count}
        try:
            try:
                response = client.get(TX_ESBD_SEARCH_URL, params=params, timeout=timeout)
            except requests.RequestException as error:
                raise TxEsbdError(f"Texas ESBD request failed: {error}") from error

            if response.status_code != 200:
                raise TxEsbdError(
                    f"Texas ESBD request failed with status {response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise TxEsbdError("Texas ESBD response was not valid JSON") from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
```

- [ ] **Step 5: Run TX adapter tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: all live source tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/tx_esbd.py crawler/tests/fixtures/tx_esbd_live_response.json crawler/tests/test_state_live_sources.py
git commit -m "feat: add Texas ESBD live adapter"
```

---

### Task 3: TX `fetch-state` Replay CLI

**Files:**
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Add failing TX replay CLI test**

Append to `crawler/tests/test_state_live_cli.py`:

```python
def test_fetch_state_replays_tx_esbd_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "tx_esbd_live_response.json"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "tx_esbd",
            "--query",
            "data",
            "--limit",
            "5",
            "--fixture-json",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Texas ESBD",
        "ESBD-LIVE-2026-77",
        "tx_esbd:ESBD-LIVE-2026-77",
        "Statewide data catalog services",
        "TX",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("tx_esbd", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "data",
        "limit": 5,
        "fixture_json": str(fixture),
    }
```

Change unsupported-source CLI test from TX to NY:

```python
def test_fetch_state_unsupported_source_writes_failure_log(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ny_contract_reporter",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "ny_contract_reporter",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: ny_contract_reporter",
    )
```

- [ ] **Step 2: Run CLI test to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_cli.py::test_fetch_state_replays_tx_esbd_fixture_json -q
```

Expected: fail until Task 2 implementation is present. If Task 2 has already been committed, this test may pass immediately; in that case run it before changing unsupported-source expectations and note that the registry/adapter already satisfies the behavior.

- [ ] **Step 3: Run CLI tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_cli.py -q
```

Expected: all live CLI tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add crawler/tests/test_state_live_cli.py
git commit -m "test: cover Texas ESBD fetch-state replay"
```

---

### Task 4: Full Verification and Final Review

**Files:**
- Verify all changed crawler files and existing frontend checks.
- No source changes expected unless verification or review finds a defect.

- [ ] **Step 1: Run full crawler tests**

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

- [ ] **Step 3: Run frontend lint and build**

Run:

```bash
cd frontend
npm run lint
npm run build
```

Expected: lint and production build pass.

- [ ] **Step 4: Run final review**

Ask a reviewer to inspect the TX adapter implementation against:

- [docs/superpowers/specs/2026-05-19-apsi-tx-esbd-adapter-design.md](../specs/2026-05-19-apsi-tx-esbd-adapter-design.md)
- this plan

The reviewer should check:

- TX is live-supported in registry.
- TX replay works through `fetch-state`.
- unsupported live-source behavior still works for NY.
- TX adapter fails clearly for non-JSON/unexpected/malformed records.
- The implementation does not claim browser/HTML scraping support.

- [ ] **Step 5: Clean runtime artifacts**

Run:

```bash
find crawler frontend -maxdepth 3 \( -name '.pytest_cache' -o -name 'apsi.sqlite*' -o -name 'notification-outbox' \) -print
rm -rf crawler/.pytest_cache frontend/data/apsi.sqlite frontend/data/apsi.sqlite-shm frontend/data/apsi.sqlite-wal frontend/data/notification-outbox
git status --short
```

Expected: working tree is clean.

---

## Self-Review

- Spec coverage: The plan registers TX, implements `tx_esbd.py`, adds replay fixture, adds adapter tests, adds CLI replay coverage, and keeps NY as the unsupported-source example.
- Scope control: The plan does not add browser automation, HTML parsing, attachments, auth, or scheduling.
- Type consistency: `fetch_tx_esbd_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)` matches the adapter contract and `fetch-state` forwarding behavior.
- Test-first ordering: Registry, adapter, and CLI behavior all start with failing tests before implementation.
