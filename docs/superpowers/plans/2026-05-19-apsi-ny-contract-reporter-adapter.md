# APSi New York Contract Reporter Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add New York State Contract Reporter as a live-supported state source with deterministic fixture replay and clear failure behavior for public-page HTTP responses.

**Architecture:** Reuse the existing state live adapter contract, following the CA and TX adapter shape. The NY adapter remains a focused spider module; source registry and `fetch-state` tests prove the source is live-supported and can replay NY opportunity records into SQLite.

**Tech Stack:** Python 3.9+, `requests`, `pytest`, SQLite, existing APSi crawler package.

---

## File Structure

- Create `crawler/apsi_crawler/spiders/ny_contract_reporter.py`
  - NY-specific HTTP/replay fetcher, payload validation, record mapping, and `NyContractReporterError`.
- Modify `crawler/apsi_crawler/sources/state_sources.py`
  - Register `ny_contract_reporter` with `live_fetcher=fetch_ny_contract_reporter_opportunities`.
- Modify `crawler/tests/test_state_live_sources.py`
  - Add NY registry and adapter behavior tests.
  - Change unsupported live source test from NY to FL.
- Modify `crawler/tests/test_state_live_cli.py`
  - Add NY replay CLI success test.
  - Change unsupported live source test from NY to FL.
- Create `crawler/tests/fixtures/ny_contract_reporter_live_response.json`
  - Recorded replay payload for deterministic NY adapter tests.

---

### Task 1: NY Registry and Adapter Skeleton

**Files:**
- Create: `crawler/apsi_crawler/spiders/ny_contract_reporter.py`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Write failing registry test**

Modify `crawler/tests/test_state_live_sources.py` imports:

```python
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
```

Add this test after the TX registry test:

```python
def test_registry_reports_live_support_for_ny_contract_reporter():
    assert supports_live_fetch("ny_contract_reporter") is True
    assert get_live_fetcher("ny_contract_reporter") is fetch_ny_contract_reporter_opportunities
```

Change the unsupported-source test to FL:

```python
def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("fl_mfmp") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("fl_mfmp")

    assert str(error.value) == "Live fetch is not implemented for source: fl_mfmp"
```

Change `crawler/tests/test_state_live_cli.py::test_fetch_state_unsupported_source_writes_failure_log` from `ny_contract_reporter` to `fl_mfmp`, and update expected source/error message:

```python
assert log == (
    "fl_mfmp",
    "failure",
    1,
    "UnsupportedLiveSourceError",
    "Live fetch is not implemented for source: fl_mfmp",
)
```

- [ ] **Step 2: Run registry test to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py::test_registry_reports_live_support_for_ny_contract_reporter -q
```

Expected: fail because `apsi_crawler.spiders.ny_contract_reporter` does not exist or NY has no live fetcher.

- [ ] **Step 3: Create minimal NY spider skeleton**

Create `crawler/apsi_crawler/spiders/ny_contract_reporter.py`:

```python
def fetch_ny_contract_reporter_opportunities(*args, **kwargs):
    return []
```

- [ ] **Step 4: Register NY live fetcher**

Modify `crawler/apsi_crawler/sources/state_sources.py`:

```python
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
```

Set `ny_contract_reporter`:

```python
live_fetcher=fetch_ny_contract_reporter_opportunities,
```

- [ ] **Step 5: Run registry and CLI unsupported tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py::test_registry_reports_live_support_for_ny_contract_reporter tests/test_state_live_sources.py::test_registry_reports_unsupported_live_state_sources tests/test_state_live_cli.py::test_fetch_state_unsupported_source_writes_failure_log -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/ny_contract_reporter.py crawler/apsi_crawler/sources/state_sources.py crawler/tests/test_state_live_sources.py crawler/tests/test_state_live_cli.py
git commit -m "feat: register NY Contract Reporter live fetcher"
```

---

### Task 2: NY Adapter Behavior

**Files:**
- Modify: `crawler/apsi_crawler/spiders/ny_contract_reporter.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Create: `crawler/tests/fixtures/ny_contract_reporter_live_response.json`

- [ ] **Step 1: Add NY live response fixture**

Create `crawler/tests/fixtures/ny_contract_reporter_live_response.json`:

```json
{
  "opportunities": [
    {
      "contractId": "NYSCR-LIVE-2026-310",
      "contractTitle": "Digital records archive",
      "summary": "Digitize and index public records.",
      "classification": "Professional Services",
      "postedDate": "2026-05-03",
      "dueDate": "2026-06-18T15:00:00-04:00",
      "agency": "New York State Archives",
      "link": "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NYSCR-LIVE-2026-310"
    }
  ]
}
```

- [ ] **Step 2: Add failing NY adapter tests**

Modify imports in `crawler/tests/test_state_live_sources.py`:

```python
from apsi_crawler.spiders.ny_contract_reporter import (
    NyContractReporterError,
    fetch_ny_contract_reporter_opportunities,
)
```

Append these tests:

```python
def test_fetch_ny_contract_reporter_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "ny_contract_reporter_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == "https://www.nyscr.ny.gov/home/contracts"
    assert session.calls[0]["params"] == {"query": "records", "limit": 5}
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "ny_contract_reporter:NYSCR-LIVE-2026-310"
    assert bid["title"] == "Digital records archive"
    assert bid["issuer_name"] == "New York State Archives"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "NY"
    assert bid["source_url"] == "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NYSCR-LIVE-2026-310"


def test_fetch_ny_contract_reporter_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter response did not contain opportunities or results"


def test_fetch_ny_contract_reporter_opportunities_raises_when_record_is_not_object():
    session = FakeSession(FakeResponse(payload={"opportunities": [None]}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter record was not an object"


def test_fetch_ny_contract_reporter_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Records"}]}))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter record is missing source id"


def test_fetch_ny_contract_reporter_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "NYSCR-NORMALIZED-001",
                    "title": "Normalized archive services",
                    "source_url": "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NYSCR-NORMALIZED-001",
                    "published_date": "2026-05-04",
                    "deadline_date": "2026-06-20",
                    "issuer_name": "New York Office of General Services",
                }
            ]
        )
    )

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "NYSCR-NORMALIZED-001"
    assert bid["dedupe_key"] == "ny_contract_reporter:NYSCR-NORMALIZED-001"
    assert bid["source_url"] == "https://www.nyscr.ny.gov/adsOpen.cfm?ID=NYSCR-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-04"
    assert bid["deadline_date"] == "2026-06-20"
    assert bid["issuer_name"] == "New York Office of General Services"


def test_fetch_ny_contract_reporter_opportunities_uses_title_and_category_precedence():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "NYSCR-ALIAS-001",
                    "name": "Name title wins",
                    "contractTitle": "Contract title loses",
                    "category": "Category wins",
                    "type": "Type loses",
                    "classification": "Classification loses",
                },
                {
                    "source_bid_id": "NYSCR-ALIAS-002",
                    "name": "Classification-only opportunity",
                    "classification": "Classification fallback",
                },
            ]
        )
    )

    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        session=session,
        timeout=10,
    )

    assert bids[0]["title"] == "Name title wins"
    assert bids[0]["original_category"] == "Category wins"
    assert bids[1]["original_category"] == "Classification fallback"


def test_fetch_ny_contract_reporter_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter request failed with status 503: maintenance"


def test_fetch_ny_contract_reporter_opportunities_raises_on_invalid_http_json():
    session = FakeSession(FakeResponse(json_error=ValueError("not json")))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter response was not valid JSON"


def test_fetch_ny_contract_reporter_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(NyContractReporterError) as error:
        fetch_ny_contract_reporter_opportunities(
            get_source("ny_contract_reporter"),
            query="records",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "NY Contract Reporter request failed: slow"


def test_fetch_ny_contract_reporter_opportunities_replays_adapter_fixture_json():
    bids = fetch_ny_contract_reporter_opportunities(
        get_source("ny_contract_reporter"),
        query="records",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "ny_contract_reporter_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "ny_contract_reporter:NYSCR-LIVE-2026-310"
```

- [ ] **Step 3: Run NY adapter tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: NY adapter tests fail because the skeleton lacks `NyContractReporterError` and returns an empty list.

- [ ] **Step 4: Implement NY adapter**

Replace `crawler/apsi_crawler/spiders/ny_contract_reporter.py`:

```python
import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


NY_CONTRACT_REPORTER_SEARCH_URL = "https://www.nyscr.ny.gov/home/contracts"


class NyContractReporterError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise NyContractReporterError(
        "NY Contract Reporter response did not contain opportunities or results"
    )


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    if not isinstance(record, dict):
        raise NyContractReporterError("NY Contract Reporter record was not an object")

    source_bid_id = _first_present(
        record,
        ("source_bid_id", "id", "contractId", "contract_id", "ad_id", "bid_id"),
    )
    if not source_bid_id:
        raise NyContractReporterError("NY Contract Reporter record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name", "contractTitle")),
        "description": _first_present(record, ("description", "summary")),
        "original_category": _first_present(record, ("category", "type", "classification")),
        "published_date": _first_present(record, ("published_date", "postedDate", "posted_date")),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "dueDate", "due_date", "response_deadline"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "source_url": _first_present(record, ("source_url", "url", "link")),
    }


def fetch_ny_contract_reporter_opportunities(
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
                response = client.get(
                    NY_CONTRACT_REPORTER_SEARCH_URL,
                    params=params,
                    timeout=timeout,
                )
            except requests.RequestException as error:
                raise NyContractReporterError(
                    f"NY Contract Reporter request failed: {error}"
                ) from error

            if response.status_code != 200:
                raise NyContractReporterError(
                    f"NY Contract Reporter request failed with status {response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise NyContractReporterError(
                    "NY Contract Reporter response was not valid JSON"
                ) from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
```

- [ ] **Step 5: Run NY adapter tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: all live source tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/ny_contract_reporter.py crawler/tests/fixtures/ny_contract_reporter_live_response.json crawler/tests/test_state_live_sources.py
git commit -m "feat: add NY Contract Reporter live adapter"
```

---

### Task 3: NY `fetch-state` Replay CLI

**Files:**
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Add NY replay CLI test**

Append to `crawler/tests/test_state_live_cli.py`:

```python
def test_fetch_state_replays_ny_contract_reporter_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "ny_contract_reporter_live_response.json"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ny_contract_reporter",
            "--query",
            "records",
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
        "New York State Contract Reporter",
        "NYSCR-LIVE-2026-310",
        "ny_contract_reporter:NYSCR-LIVE-2026-310",
        "Digital records archive",
        "NY",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("ny_contract_reporter", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "records",
        "limit": 5,
        "fixture_json": str(fixture),
    }
```

Change unsupported-source CLI test from NY to FL:

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
            "fl_mfmp",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "fl_mfmp",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: fl_mfmp",
    )
```

- [ ] **Step 2: Run CLI tests**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_cli.py -q
```

Expected: all live CLI tests pass after Task 2 implementation is present.

- [ ] **Step 3: Run focused live tests**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py tests/test_state_live_cli.py -q
```

Expected: all live adapter and live CLI tests pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add crawler/tests/test_state_live_cli.py
git commit -m "test: cover NY Contract Reporter fetch-state replay"
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

Ask a reviewer to inspect the NY adapter implementation against:

- [docs/superpowers/specs/2026-05-19-apsi-ny-contract-reporter-adapter-design.md](../specs/2026-05-19-apsi-ny-contract-reporter-adapter-design.md)
- this plan

The reviewer should check:

- NY is live-supported in registry.
- NY replay works through `fetch-state`.
- unsupported live-source behavior still works for FL.
- NY adapter fails clearly for non-JSON/unexpected/malformed records.
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

- Spec coverage: The plan registers NY, implements `ny_contract_reporter.py`, adds replay fixture, adds adapter tests, adds CLI replay coverage, and keeps FL as the unsupported-source example.
- Scope control: The plan does not add browser automation, HTML parsing, attachments, auth, or scheduling.
- Type consistency: `fetch_ny_contract_reporter_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None)` matches the adapter contract and `fetch-state` forwarding behavior.
- Test-first ordering: Registry, adapter, and CLI behavior all start with focused tests before implementation.
