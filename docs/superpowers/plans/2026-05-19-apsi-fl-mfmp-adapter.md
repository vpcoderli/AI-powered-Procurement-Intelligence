# APSi Florida MFMP Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MyFloridaMarketPlace as a live-supported state source with deterministic fixture replay and the MFMP public JSON search API.

**Architecture:** Reuse the existing CA/TX/NY state live adapter contract. The FL adapter remains a focused spider module that accepts injected sessions for tests, supports `fixture_json` replay without HTTP, normalizes MFMP-style records through `normalize_state_opportunity`, and leaves browser/HTML handling for a separate stage.

**Tech Stack:** Python 3.9+, `requests`, `pytest`, SQLite, existing APSi crawler package.

---

## File Structure

- Create `crawler/apsi_crawler/spiders/fl_mfmp.py`
  - FL-specific HTTP/replay fetcher, payload validation, record mapping, and `FlMfmpError`.
- Modify `crawler/apsi_crawler/sources/state_sources.py`
  - Register `fl_mfmp` with `live_fetcher=fetch_fl_mfmp_opportunities`.
- Modify `crawler/tests/test_state_live_sources.py`
  - Add FL registry and adapter behavior tests.
  - Change unsupported live source test from FL to IL.
- Modify `crawler/tests/test_state_live_cli.py`
  - Add FL replay CLI success test.
  - Change unsupported live source test from FL to IL.
- Create `crawler/tests/fixtures/fl_mfmp_live_response.json`
  - Recorded replay payload for deterministic FL adapter tests.

---

### Task 1: FL Registry and Adapter Skeleton

**Files:**
- Create: `crawler/apsi_crawler/spiders/fl_mfmp.py`
- Modify: `crawler/apsi_crawler/sources/state_sources.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Write failing registry test**

Modify `crawler/tests/test_state_live_sources.py` imports:

```python
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
```

Add this test after the NY registry test:

```python
def test_registry_reports_live_support_for_fl_mfmp():
    assert supports_live_fetch("fl_mfmp") is True
    assert get_live_fetcher("fl_mfmp") is fetch_fl_mfmp_opportunities
```

Change the unsupported-source test to IL:

```python
def test_registry_reports_unsupported_live_state_sources():
    assert supports_live_fetch("il_bidbuy") is False

    with pytest.raises(UnsupportedLiveSourceError) as error:
        get_live_fetcher("il_bidbuy")

    assert str(error.value) == "Live fetch is not implemented for source: il_bidbuy"
```

Change `crawler/tests/test_state_live_cli.py::test_fetch_state_unsupported_source_writes_failure_log` from `fl_mfmp` to `il_bidbuy`, and update expected source/error message:

```python
assert log == (
    "il_bidbuy",
    "failure",
    1,
    "UnsupportedLiveSourceError",
    "Live fetch is not implemented for source: il_bidbuy",
)
```

- [ ] **Step 2: Run registry test to verify RED**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py::test_registry_reports_live_support_for_fl_mfmp -q
```

Expected: fail because `apsi_crawler.spiders.fl_mfmp` does not exist or FL has no live fetcher.

- [ ] **Step 3: Create minimal FL spider skeleton**

Create `crawler/apsi_crawler/spiders/fl_mfmp.py`:

```python
def fetch_fl_mfmp_opportunities(*args, **kwargs):
    return []
```

- [ ] **Step 4: Register FL live fetcher**

Modify `crawler/apsi_crawler/sources/state_sources.py`:

```python
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
```

Set `fl_mfmp`:

```python
live_fetcher=fetch_fl_mfmp_opportunities,
```

- [ ] **Step 5: Run registry and unsupported tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_sources.py::test_registry_reports_live_support_for_fl_mfmp \
  tests/test_state_live_sources.py::test_registry_reports_unsupported_live_state_sources \
  tests/test_state_live_cli.py::test_fetch_state_unsupported_source_writes_failure_log \
  -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/fl_mfmp.py crawler/apsi_crawler/sources/state_sources.py crawler/tests/test_state_live_sources.py crawler/tests/test_state_live_cli.py
git commit -m "feat: register Florida MFMP live fetcher"
```

---

### Task 2: FL Adapter Behavior

**Files:**
- Modify: `crawler/apsi_crawler/spiders/fl_mfmp.py`
- Modify: `crawler/tests/test_state_live_sources.py`
- Create: `crawler/tests/fixtures/fl_mfmp_live_response.json`

- [ ] **Step 1: Add FL live response fixture**

Create `crawler/tests/fixtures/fl_mfmp_live_response.json`:

```json
{
  "opportunities": [
    {
      "advertisementId": "FL-MFMP-LIVE-2026-42",
      "adNumber": "FL-MFMP-2026-42",
      "agencyAdNumber": "DMS-26-001",
      "uniqueName": "Emergency communications assessment",
      "type": "Invitation to Negotiate",
      "openDate": "2026-05-04",
      "closeDate": "2026-06-21T17:00:00-04:00",
      "agency": "Florida Department of Management Services"
    }
  ]
}
```

- [ ] **Step 2: Add failing FL adapter tests**

Modify imports in `crawler/tests/test_state_live_sources.py`:

```python
from apsi_crawler.spiders.fl_mfmp import (
    FlMfmpError,
    fetch_fl_mfmp_opportunities,
)
```

Append these tests near the other state adapter tests:

```python
def test_fetch_fl_mfmp_opportunities_normalizes_live_response():
    fixture_path = FIXTURES_DIR / "fl_mfmp_live_response.json"
    with fixture_path.open() as fixture:
        payload = json.load(fixture)
    session = FakeSession(FakeResponse(payload=payload))

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert session.calls[0]["url"] == "https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids"
    assert session.calls[0]["json"]["title"] == "communications"
    assert session.calls[0]["json"]["pageSize"] == 5
    assert session.calls[0]["timeout"] == 10
    assert len(bids) == 1
    bid = bids[0]
    assert bid["dedupe_key"] == "fl_mfmp:FL-MFMP-LIVE-2026-42"
    assert bid["title"] == "Emergency communications assessment"
    assert bid["issuer_name"] == "Florida Department of Management Services"
    assert bid["issuer_type"] == "state"
    assert bid["state_code"] == "FL"
    assert bid["source_url"] == "https://vendor.myfloridamarketplace.com/search/bids/detail/FL-MFMP-LIVE-2026-42"


def test_fetch_fl_mfmp_opportunities_raises_on_unexpected_payload_shape():
    session = FakeSession(FakeResponse(payload={"error": "changed"}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace response did not contain opportunities or results"


def test_fetch_fl_mfmp_opportunities_raises_when_record_is_not_object():
    session = FakeSession(FakeResponse(payload={"opportunities": [None]}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace record was not an object"


def test_fetch_fl_mfmp_opportunities_raises_when_record_missing_source_id():
    session = FakeSession(FakeResponse(payload={"opportunities": [{"title": "Comms"}]}))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace record is missing source id"


def test_fetch_fl_mfmp_opportunities_preserves_normalized_aliases():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "FL-NORMALIZED-001",
                    "title": "Normalized communications services",
                    "source_url": "https://vendor.myfloridamarketplace.com/bids/FL-NORMALIZED-001",
                    "published_date": "2026-05-18",
                    "deadline_date": "2026-06-10",
                    "issuer_name": "Florida Department of Management Services",
                }
            ]
        )
    )

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["source_bid_id"] == "FL-NORMALIZED-001"
    assert bid["dedupe_key"] == "fl_mfmp:FL-NORMALIZED-001"
    assert bid["source_url"] == "https://vendor.myfloridamarketplace.com/bids/FL-NORMALIZED-001"
    assert bid["published_date"] == "2026-05-18"
    assert bid["deadline_date"] == "2026-06-10"
    assert bid["issuer_name"] == "Florida Department of Management Services"


def test_fetch_fl_mfmp_opportunities_uses_fl_title_and_category_precedence():
    session = FakeSession(
        FakeResponse(
            payload=[
                {
                    "source_bid_id": "FL-ALIAS-001",
                    "title": "Title wins",
                    "name": "Name loses",
                    "advertisementTitle": "Advertisement title loses",
                    "category": "Category wins",
                    "type": "Type loses",
                    "commodity": "Commodity loses",
                },
                {
                    "source_bid_id": "FL-ALIAS-002",
                    "advertisementTitle": "Advertisement title fallback",
                    "commodity": "Commodity fallback",
                },
            ]
        )
    )

    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        session=session,
        timeout=10,
    )

    assert bids[0]["title"] == "Title wins"
    assert bids[0]["original_category"] == "Category wins"
    assert bids[1]["title"] == "Advertisement title fallback"
    assert bids[1]["original_category"] == "Commodity fallback"


def test_fetch_fl_mfmp_opportunities_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace request failed with status 503: maintenance"


def test_fetch_fl_mfmp_opportunities_raises_on_invalid_http_json():
    session = FakeSession(FakeResponse(json_error=ValueError("not json")))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace response was not valid JSON"


def test_fetch_fl_mfmp_opportunities_wraps_request_errors():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(FlMfmpError) as error:
        fetch_fl_mfmp_opportunities(
            get_source("fl_mfmp"),
            query="communications",
            limit=5,
            session=session,
            timeout=10,
        )

    assert str(error.value) == "MyFloridaMarketPlace request failed: slow"


def test_fetch_fl_mfmp_opportunities_replays_adapter_fixture_json():
    bids = fetch_fl_mfmp_opportunities(
        get_source("fl_mfmp"),
        query="communications",
        limit=5,
        fixture_json=str(FIXTURES_DIR / "fl_mfmp_live_response.json"),
    )

    assert len(bids) == 1
    assert bids[0]["dedupe_key"] == "fl_mfmp:FL-MFMP-LIVE-2026-42"
```

- [ ] **Step 3: Run adapter tests to verify RED**

Run:

```bash
cd crawler
python3 -m pytest \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_normalizes_live_response \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_raises_on_unexpected_payload_shape \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_raises_when_record_is_not_object \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_raises_when_record_missing_source_id \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_preserves_normalized_aliases \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_uses_fl_title_and_category_precedence \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_raises_on_http_error \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_raises_on_invalid_http_json \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_wraps_request_errors \
  tests/test_state_live_sources.py::test_fetch_fl_mfmp_opportunities_replays_adapter_fixture_json \
  -q
```

Expected: fail because the skeleton returns no bids and does not expose `FlMfmpError`.

- [ ] **Step 4: Implement FL adapter**

Replace `crawler/apsi_crawler/spiders/fl_mfmp.py` with:

```python
import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


FL_MFMP_SEARCH_URL = "https://vendor.myfloridamarketplace.com/mfmp/pub/search/bids"
FL_MFMP_DETAIL_URL_TEMPLATE = "https://vendor.myfloridamarketplace.com/search/bids/detail/{source_bid_id}"


class FlMfmpError(Exception):
    pass


def _records_from_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise FlMfmpError("MyFloridaMarketPlace response did not contain opportunities or results")


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_record(record):
    if not isinstance(record, dict):
        raise FlMfmpError("MyFloridaMarketPlace record was not an object")

    source_bid_id = _first_present(
        record,
        (
            "source_bid_id",
            "advertisementId",
            "id",
            "advertisement_id",
            "adNumber",
            "agencyAdNumber",
            "bid_id",
            "solicitation_id",
        ),
    )
    if not source_bid_id:
        raise FlMfmpError("MyFloridaMarketPlace record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(
            record,
            ("title", "uniqueName", "name", "advertisementTitle", "solicitationTitle"),
        ),
        "description": _first_present(record, ("description", "summary")),
        "original_category": _first_present(record, ("category", "type", "commodity")),
        "published_date": _first_present(
            record,
            ("published_date", "publishDate", "postedDate", "posted_date", "advertisementDate", "openDate"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "closeDate", "dueDate", "due_date", "response_deadline", "endDate"),
        ),
        "issuer_name": _first_present(
            record,
            ("issuer_name", "agency", "organization", "department", "buyer"),
        ),
        "source_url": _first_present(record, ("source_url", "url", "link"))
        or FL_MFMP_DETAIL_URL_TEMPLATE.format(source_bid_id=source_bid_id),
    }


def fetch_fl_mfmp_opportunities(
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
        payload = {
            "pageSize": limit_count,
            "type": [],
            "status": [],
            "agency": [],
            "adNumber": "",
            "agencyAdvertisementNumber": "",
            "title": query or "",
            "publishedDate": "",
            "openDate": "",
            "endDate": "",
            "commodityCodes": [],
            "intendsToParticipate": "",
            "assignee": "",
            "page": 1,
        }
        try:
            try:
                response = client.post(FL_MFMP_SEARCH_URL, json=payload, timeout=timeout)
            except requests.RequestException as error:
                raise FlMfmpError(f"MyFloridaMarketPlace request failed: {error}") from error

            if response.status_code != 200:
                raise FlMfmpError(
                    "MyFloridaMarketPlace request failed with status "
                    f"{response.status_code}: {response.text}"
                )

            try:
                payload = response.json()
            except ValueError as error:
                raise FlMfmpError("MyFloridaMarketPlace response was not valid JSON") from error
        finally:
            if close_client:
                client.close()

    records = _records_from_payload(payload)[:limit_count]
    return [
        normalize_state_opportunity(_normalize_record(record), source)
        for record in records
    ]
```

- [ ] **Step 5: Run adapter tests to verify GREEN**

Run:

```bash
cd crawler
python3 -m pytest tests/test_state_live_sources.py -q
```

Expected: all state live source tests pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add crawler/apsi_crawler/spiders/fl_mfmp.py crawler/tests/fixtures/fl_mfmp_live_response.json crawler/tests/test_state_live_sources.py
git commit -m "feat: add Florida MFMP live adapter"
```

---

### Task 3: FL `fetch-state` Replay CLI

**Files:**
- Modify: `crawler/tests/test_state_live_cli.py`

- [ ] **Step 1: Add FL replay CLI test**

Append to `crawler/tests/test_state_live_cli.py` after the NY replay test:

```python
def test_fetch_state_replays_fl_mfmp_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "fl_mfmp_live_response.json"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "fl_mfmp",
            "--query",
            "communications",
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
        "MyFloridaMarketPlace",
        "FL-MFMP-LIVE-2026-42",
        "fl_mfmp:FL-MFMP-LIVE-2026-42",
        "Emergency communications assessment",
        "FL",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("fl_mfmp", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "communications",
        "limit": 5,
        "fixture_json": str(fixture),
    }
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
git commit -m "test: cover Florida MFMP fetch-state replay"
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

- [ ] **Step 2: Run frontend checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all frontend checks pass.

- [ ] **Step 3: Request final code review**

Review range:

```bash
git diff be85647..HEAD
```

Reviewer should verify:

- FL is live-supported.
- IL remains unsupported.
- `fixture_json` path does not perform HTTP.
- Direct HTTP JSON path follows CA/TX/NY behavior.
- Non-JSON/public-page responses fail clearly.
- SQLite replay via `fetch-state` writes bid and success crawler log.

- [ ] **Step 4: Commit fixes if review finds issues**

If the reviewer finds Critical or Important issues, fix them with focused tests and commit:

```bash
git add crawler/apsi_crawler/spiders/fl_mfmp.py crawler/apsi_crawler/sources/state_sources.py crawler/tests/test_state_live_sources.py crawler/tests/test_state_live_cli.py crawler/tests/fixtures/fl_mfmp_live_response.json
git commit -m "fix: address Florida MFMP adapter review"
```

- [ ] **Step 5: Clean generated artifacts**

Run:

```bash
find crawler -type d -name __pycache__ -prune -exec rm -rf {} +
rm -rf crawler/.pytest_cache frontend/.next/cache frontend/data/apsi.sqlite frontend/data/apsi.sqlite-shm frontend/data/apsi.sqlite-wal frontend/data/notification-outbox
git status --short
```

Expected: no untracked generated artifacts remain.

## Acceptance Checklist

- FL design doc exists and is committed.
- FL implementation plan exists and is committed.
- `supports_live_fetch("fl_mfmp") is True`.
- `supports_live_fetch("il_bidbuy") is False`.
- `fetch-state --source fl_mfmp --fixture-json crawler/tests/fixtures/fl_mfmp_live_response.json` works through the CLI test.
- Full crawler tests pass.
- Frontend test, lint, and build pass.
- Final review has no Critical or Important issues.

## Remaining After This Stage

After FL is complete, the remaining functional work is:

1. Add IL BidBuy live adapter.
2. Add browser/HTML handling for portals without stable JSON endpoints.
3. Add attachment/document extraction.
4. Add real SMTP/email delivery.
5. Add production worker scheduling, retries, and health alerting.
