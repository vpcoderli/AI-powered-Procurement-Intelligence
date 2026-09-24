import io
import json
from pathlib import Path

from apsi_crawler import cli
from apsi_crawler.adapters import registry
from apsi_crawler.adapters.task import task_source_from_payload
from apsi_crawler.spiders.co_bidnet import bidnet_list_url

CONTRACT_PATH = Path(__file__).parent / "fixtures" / "contracts" / "fetch_task_v1.json"
DENVER_CLOSED = Path(__file__).parent / "fixtures" / "bidnet_denver_closed_bids_2026_09_24.html"
DENVER_OPEN = Path(__file__).parent / "fixtures" / "bidnet_denver_open_bids_2026_09_24.html"
DENVER_BASE_URL = (
    "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing"
    "/solicitations/open-bids"
)


def _stub_bidnet_paged_fetch(monkeypatch, html):
    """Serve a fixed BidNet list page for every requested URL, recording each URL asked for.

    Never touches the network: this replaces `LIST_HTML_FETCHERS["bidnet"].fetch_list_html`,
    which is the paged walk's only fetcher (`list_extraction._fetch_paginated_page`) --
    `page_reader`/`page_url`/`parse_list_html` are untouched.
    """
    requested_urls = []

    def fetch_list_html(source, url, session=None, timeout=30):
        requested_urls.append(url)
        return html, url, 200

    monkeypatch.setitem(
        registry.LIST_HTML_FETCHERS,
        "bidnet",
        registry.BIDNET_LIST_HTML_ADAPTER._replace(fetch_list_html=fetch_list_html),
    )
    return requested_urls


def test_python_can_consume_the_node_generated_contract():
    """NOTE: the jurisdiction assertion below is not discriminating for this fixture --
    payload["jurisdiction_level"] is "state", which is also task.py's own fallback
    default (`payload.get("jurisdiction_level") or "state"`), so a renamed key would
    silently reproduce the same value here. See
    test_fetch_task_reads_every_directly_read_field_by_its_real_key below, which uses a
    non-default value to close that gap for real.
    """
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    source = task_source_from_payload(payload)

    assert source.id == payload["source_id"]
    assert source.source_label == payload["label"]
    assert source.state_code == payload["state_code"]
    assert source.base_url == payload["fetch_config"]["base_url"]
    assert source.jurisdiction == payload["jurisdiction_level"]


def test_contract_carries_every_field_the_worker_needs():
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    for key in (
        "task_id",
        "source_id",
        "label",
        "state_code",
        "provider_family",
        "jurisdiction_level",
        "fetch_config",
        "limit",
        "query",
        "date_range",
    ):
        assert key in payload, f"contract fixture is missing {key}"


def test_fetch_task_echoes_task_id_from_the_contract_payload(monkeypatch, capsys):
    """Drive the real fetch_task CLI path with the committed contract fixture (not a
    second dict lookup, which would prove nothing) so a key rename in cli.py -- e.g.
    payload.get("taskId") instead of payload.get("task_id") -- actually fails this test.

    limit and query are asserted too, but they are NOT discriminating for this
    particular fixture: the fixture carries limit=null, and fetch_task's own fallback
    behaviour (`int(payload.get("limit") or 25)`) converts it to 25; query=null in the
    fixture equals the default when the key is absent entirely. A renamed key would
    silently reproduce these values here. task_id has no such fallback, so the taskId
    assertion below is the one that is genuinely protected by this test. See
    test_fetch_task_reads_every_directly_read_field_by_its_real_key below for value
    choices that close that gap for limit/query/provider_family/jurisdiction_level.
    """
    payload = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    seen = {}

    def adapter(source, query=None, limit=25, **kwargs):
        seen["query"] = query
        seen["limit"] = limit
        return [{"id": f"{source.id}:1", "title": "stub", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, payload["source_id"], adapter)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["taskId"] == payload["task_id"]
    assert seen["limit"] == (payload["limit"] if payload["limit"] is not None else 25)
    assert seen["query"] == payload["query"]


def test_fetch_task_reads_every_directly_read_field_by_its_real_key(monkeypatch, capsys):
    """The committed contract fixture cannot prove limit, query, provider_family, or
    jurisdiction_level are read under their correct keys, because its own sample values
    collide with fallback/short-circuit behaviour on the Python side:

    - limit=null in the fixture gets folded to fetch_task's own `or 25` fallback default
      (25), so a renamed key ("Limit") would silently produce the identical value.
    - query=null in the fixture equals the default when the key is absent entirely, so
      a renamed key ("Query") would also silently produce the identical value.
    - jurisdiction_level="state" in the fixture equals task.py's own
      `payload.get("jurisdiction_level") or "state"` fallback default, so a renamed key
      ("jurisdictionLevel") would silently produce the identical value.
    - provider_family=null is never even consulted for this fixture's source_id
      ("ca_caleprocure"): resolve_adapter() checks DEDICATED_ADAPTERS by source_id
      FIRST and returns on a hit, before provider_family is read at all.

    Each collision was confirmed empirically (not just reasoned about) by temporarily
    renaming the corresponding key read in cli.py / task.py and re-running this file:
    test_fetch_task_echoes_task_id_from_the_contract_payload above kept passing in every
    case, proving the fixture-driven test alone is blind to these four renames.

    This test uses a locally-built payload -- same field names as the contract, but
    values chosen to differ from every fallback/short-circuit -- so each of the four
    keys is load-bearing: reading the wrong key changes the outcome, and the same
    renames all fail this test.

    The probe's `provider_family` is deliberately NOT "bidnet": that platform's list-HTML
    adapter now has a `page_reader` (2026-09-24 paged BidNet walk), so `run_list_stage`
    would route it into `run_paginated_list_extraction` regardless of this test's
    `PLATFORM_ADAPTERS` stub, reaching for a real list-HTML fetcher and hitting the
    network. This test's subject is `resolve_adapter`'s field-reading, not BidNet's list
    stage, so it uses a probe-only platform family that resolves to neither
    `LIST_HTML_FETCHERS` nor a real `PLATFORM_ADAPTERS` entry -- keeping it on the plain
    single-page adapter route. See
    test_a_paged_bidnet_task_reads_its_pagination_request_fields_by_their_real_keys and
    test_a_stop_before_makes_a_paged_bidnet_task_stop_at_the_window below for the paged
    route's own field-reading probes.
    """
    payload = {
        "task_id": "tsk_field_probe",
        "source_id": "zz_probe_platform_source",  # deliberately not in DEDICATED_ADAPTERS
        "label": "Contract Field Probe",
        "state_code": "CO",
        "provider_family": "zz_probe_family",  # not bidnet -- see docstring above
        "jurisdiction_level": "county",  # distinct from task.py's "state" fallback
        "fetch_config": {"base_url": "https://example.gov"},
        "limit": 7,
        "query": "road repair",
    }
    seen = {}

    def probe_adapter(source, query=None, limit=25, **kwargs):
        seen["query"] = query
        seen["limit"] = limit
        seen["jurisdiction"] = source.jurisdiction
        return [{"id": "probe:1", "title": "stub", "source": source.source_label}]

    # Only the probe-only "zz_probe_family" platform adapter is stubbed. If provider_family
    # were read under the wrong key, resolve_adapter would see provider_family=None for a
    # source_id with no dedicated adapter and raise AdapterNotFoundError instead of reaching
    # this stub.
    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "zz_probe_family", probe_adapter)
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["metadata"]["adapter"] == "probe_adapter"
    assert seen["limit"] == 7
    assert seen["query"] == "road repair"
    assert seen["jurisdiction"] == "county"


def test_a_paged_bidnet_task_reads_its_pagination_request_fields_by_their_real_keys(monkeypatch, capsys):
    """`list_kind`, `start_page` and `max_pages` all equal the Python side's own defaults
    ("open", 1, 4) in the committed contract fixture, so a renamed key on either side would
    silently reproduce those defaults -- the same fallback/short-circuit collision this
    file's docstrings warn about for limit/query/provider_family/jurisdiction_level. This
    probe uses non-default values for all three so each is load-bearing: reading the wrong
    key changes the outcome.

    `provider_family: "bidnet"` with a `source_id` absent from `DEDICATED_ADAPTERS` resolves
    a BidNet `ListHtmlAdapter` with a `page_reader`, so `run_list_stage` takes the paged
    route (`run_paginated_list_extraction`) unconditionally -- exactly the routing rule that
    made the old all-bidnet probe above unsafe to keep once Task 4 wired it into `cli.py`.
    Here that routing is the point: `LIST_HTML_FETCHERS["bidnet"].fetch_list_html` is stubbed
    so the walk never leaves this process.
    """
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    html = DENVER_CLOSED.read_text(encoding="utf-8")
    requested_urls = _stub_bidnet_paged_fetch(monkeypatch, html)

    payload = {
        "task_id": "tsk_paged_probe",
        "source_id": "zz_probe_paged_source",  # deliberately not in DEDICATED_ADAPTERS
        "label": "City and County of Denver General Services Purchasing (BidNet)",
        "state_code": "CO",
        "provider_family": "bidnet",
        "fetch_config": {"base_url": DENVER_BASE_URL},
        "limit": None,
        "list_kind": "closed",  # distinct from the "open" default
        "start_page": 3,  # distinct from the "1" default
        "max_pages": 2,  # distinct from the "4" default -- the closed fixture always links a
        # next page, so an unread max_pages would let the walk run right past it
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    # The FIRST page fetched must be the closed list's page 3 -- proof list_kind/start_page
    # actually drove the fetched URL, not just an echo back into metadata.
    assert requested_urls[0] == bidnet_list_url(DENVER_BASE_URL, "closed", 3)
    pagination = result["metadata"]["pagination"]
    assert pagination["list_kind"] == "closed"
    assert pagination["start_page"] == 3
    assert pagination["pages_fetched"] == 2
    assert pagination["stopped_reason"] == "max_pages"


def test_a_stop_before_makes_a_paged_bidnet_task_stop_at_the_window(monkeypatch, capsys):
    """`stop_before` has no fallback default at all -- when the key is absent the walk never
    checks a window -- so any non-null value is load-bearing on its own: a renamed key would
    silently read `None` and the walk would run to exhaustion instead of stopping at the
    "window" reason this test asserts.
    """
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    html = DENVER_OPEN.read_text(encoding="utf-8")
    _stub_bidnet_paged_fetch(monkeypatch, html)

    payload = {
        "task_id": "tsk_window_probe",
        "source_id": "zz_probe_window_source",  # deliberately not in DEDICATED_ADAPTERS
        "label": "City and County of Denver General Services Purchasing (BidNet)",
        "state_code": "CO",
        "provider_family": "bidnet",
        "fetch_config": {"base_url": DENVER_BASE_URL},
        "limit": None,
        "stop_before": "2030-01-01",  # later than every row on the open fixture (max 2026-10-13)
    }
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))

    exit_code = cli.main(["fetch-task"])
    result = json.loads(capsys.readouterr().out)

    assert exit_code == 0
    assert result["status"] == "success"
    pagination = result["metadata"]["pagination"]
    assert pagination["pages_fetched"] == 1
    assert pagination["stopped_reason"] == "window"


def test_contract_enrichment_block_parses_to_disabled_defaults():
    from apsi_crawler.enrichment import parse_enrichment_config

    payload = json.loads(CONTRACT_PATH.read_text())
    config = parse_enrichment_config(payload["fetch_config"])
    assert config["enabled"] is False
    assert config["fields"] == ["description", "attachments", "category", "contact", "published_date"]
    assert config["max_details_per_run"] == 25
