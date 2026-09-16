import io
import json
from pathlib import Path

from apsi_crawler import cli
from apsi_crawler.adapters import registry
from apsi_crawler.html.public_page import FetchedPage


def _run(payload, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps(payload)))
    exit_code = cli.main(["fetch-task"])
    return exit_code, json.loads(capsys.readouterr().out)


def test_emits_success_payload_with_bids(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": f"{source.id}:1", "title": "Road Repair", "source": source.source_label}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "test_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_1",
            "source_id": "test_source",
            "label": "Test Source",
            "state_code": "CA",
            "fetch_config": {"base_url": "https://example.gov"},
            "limit": 5,
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["taskId"] == "tsk_1"
    assert result["source"] == "test_source"
    assert len(result["bids"]) == 1


def test_empty_result_is_a_failure_not_a_success(monkeypatch, capsys):
    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "empty_source", lambda source, **kwargs: [])

    exit_code, result = _run(
        {
            "task_id": "tsk_2",
            "source_id": "empty_source",
            "label": "Empty Source",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "EmptyCrawlerResultError"


def test_missing_adapter_reports_adapter_not_found(monkeypatch, capsys):
    exit_code, result = _run(
        {
            "task_id": "tsk_3",
            "source_id": "no_such_source",
            "label": "No Such",
            "state_code": "CA",
            "provider_family": "no_such_platform",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "AdapterNotFoundError"


def test_adapter_exception_is_reported_with_its_class_name(monkeypatch, capsys):
    def boom(source, **kwargs):
        raise TimeoutError("read timed out")

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "slow_source", boom)

    exit_code, result = _run(
        {
            "task_id": "tsk_4",
            "source_id": "slow_source",
            "label": "Slow",
            "state_code": "CA",
            "fetch_config": {},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["errorCode"] == "TimeoutError"
    assert "read timed out" in result["errorMessage"]


def test_date_range_filters_bids_and_reports_stats(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [
            {"id": "old", "title": "Old", "published_date": "2026-01-05"},
            {"id": "new", "title": "New", "published_date": "8/20/2026"},
            {"id": "undated", "title": "Undated", "published_date": None},
        ]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "windowed_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_1",
            "source_id": "windowed_source",
            "label": "Windowed Source",
            "state_code": "CA",
            "fetch_config": {},
            "limit": 5,
            "date_range": {"from": "2026-08-01", "to": "2026-08-31"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert [b["id"] for b in result["bids"]] == ["new", "undated"]
    assert result["metadata"]["dateFilter"] == {
        "from": "2026-08-01",
        "to": "2026-08-31",
        "kept": 2,
        "dropped": 1,
        "unparsed": 1,
    }


def test_date_range_that_drops_everything_is_still_a_success(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "old", "title": "Old", "published_date": "2026-01-05"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "all_dropped_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_2",
            "source_id": "all_dropped_source",
            "label": "All Dropped Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": {"from": "2026-08-01"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["bids"] == []
    assert result["metadata"]["dateFilter"]["dropped"] == 1


def test_invalid_date_range_is_a_failure_with_clear_error_code(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "a", "title": "A", "published_date": "8/20/2026"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "bad_window_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_3",
            "source_id": "bad_window_source",
            "label": "Bad Window Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": {"from": "08/01/2026"},
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "DateWindowError"


def test_null_date_range_keeps_existing_behavior(monkeypatch, capsys):
    def adapter(source, query=None, limit=25, **kwargs):
        return [{"id": "a", "title": "A", "published_date": "2026-01-05"}]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "no_window_source", adapter)

    exit_code, result = _run(
        {
            "task_id": "tsk_win_4",
            "source_id": "no_window_source",
            "label": "No Window Source",
            "state_code": "CA",
            "fetch_config": {},
            "date_range": None,
        },
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert len(result["bids"]) == 1
    assert "dateFilter" not in result["metadata"]


def test_fetch_task_reports_disabled_enrichment_by_default(monkeypatch, capsys):
    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "plain_source", lambda source, **kwargs: [{"id": "plain_source:1", "title": "T", "source": "Plain"}])
    exit_code, result = _run({"task_id": "tsk_e1", "source_id": "plain_source", "label": "Plain", "state_code": "CA", "fetch_config": {}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["metadata"]["enrichment"] == {"attempted": 0, "enriched": 0, "failed": 0, "skipped": 1, "reason": "disabled", "extractor": None}


def test_fetch_task_runs_enrichment_when_enabled(monkeypatch, capsys):
    from apsi_crawler import enrichment

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "rich_source", lambda source, **kwargs: [{"id": "rich_source:1", "title": "T", "description": "T", "source": "Rich", "source_url": "https://portal.example.gov/bid/1", "attachments": []}])
    # The stage fetches through `fetch_page` so it can see the FINAL url and reject a detail
    # page that bounced to a login screen; this stub answers on-target (no redirect).
    monkeypatch.setattr(
        enrichment,
        "fetch_page",
        lambda url, session=None, timeout=30: FetchedPage("<html>detail</html>", url, False),
    )

    class Extractor:
        def health(self, timeout=3.0):
            return "0.4.15"

        def extract(self, html, url, fields, selectors, timeout=10.0):
            return {"fields": {"description": "Long description"}, "attachments": [], "diagnostics": {"description": "heuristic"}}

    monkeypatch.setattr(enrichment, "ExtractorClient", lambda base_url, session=None: Extractor())
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")

    exit_code, result = _run({"task_id": "tsk_e2", "source_id": "rich_source", "label": "Rich", "state_code": "CA", "fetch_config": {"enrichment": {"enabled": True, "min_interval_seconds": 0}}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["bids"][0]["description"] == "Long description"
    assert result["metadata"]["enrichment"]["enriched"] == 1


def test_enrichment_failure_never_fails_the_run(monkeypatch, capsys):
    from apsi_crawler import enrichment

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "fragile_source", lambda source, **kwargs: [{"id": "fragile_source:1", "title": "T", "source": "Fragile", "source_url": "https://portal.example.gov/bid/1"}])
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")

    class Broken:
        def health(self, timeout=3.0):
            raise RuntimeError("health exploded")

    monkeypatch.setattr(enrichment, "ExtractorClient", lambda base_url, session=None: Broken())
    exit_code, result = _run({"task_id": "tsk_e3", "source_id": "fragile_source", "label": "Fragile", "state_code": "CA", "fetch_config": {"enrichment": {"enabled": True}}}, monkeypatch, capsys)
    assert exit_code == 0
    assert result["status"] == "success"
    assert result["metadata"]["enrichment"]["reason"] == "enrichment_crashed"


def test_per_record_enrichment_failure_keeps_stdout_pure_json_and_logs_to_stderr(monkeypatch, capsys):
    from apsi_crawler import enrichment

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "noisy_source", lambda source, **kwargs: [{"id": "noisy_source:1", "title": "T", "source": "Noisy", "source_url": "https://portal.example.gov/bid/1"}])
    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")
    monkeypatch.setattr(
        enrichment,
        "fetch_page",
        lambda url, session=None, timeout=30: FetchedPage("<html>detail</html>", url, False),
    )

    class Exploding:
        def health(self, timeout=3.0):
            return "0.4.15"

        def extract(self, html, url, fields, selectors, timeout=10.0):
            raise RuntimeError("sidecar exploded")

    monkeypatch.setattr(enrichment, "ExtractorClient", lambda base_url, session=None: Exploding())
    monkeypatch.setattr("sys.stdin", io.StringIO(json.dumps({"task_id": "tsk_e4", "source_id": "noisy_source", "label": "Noisy", "state_code": "CA", "fetch_config": {"enrichment": {"enabled": True, "min_interval_seconds": 0}}})))
    exit_code = cli.main(["fetch-task"])
    captured = capsys.readouterr()

    assert exit_code == 0
    result = json.loads(captured.out)           # stdout carries the JSON result and nothing else
    assert result["metadata"]["enrichment"]["failed"] == 1
    assert "sidecar exploded" in captured.err


# --- list extraction / verified empty state (contract C1) ---------------------------------


ERIE_FIXTURE = Path(__file__).parent / "fixtures" / "bidnet_erie_no_open_bids.html"
ERIE_TASK = {
    "task_id": "tsk_empty_1",
    "source_id": "bidnet_ny_erie",
    "label": "Erie County, NY (BidNet)",
    "state_code": "NY",
    "provider_family": "bidnet",
    "fetch_config": {"base_url": "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids"},
    "limit": 25,
}


def _stub_bidnet_list_html(monkeypatch, html):
    """Serve one BidNet list page to BOTH list paths without touching the network."""
    from apsi_crawler.spiders import co_bidnet

    monkeypatch.setitem(
        registry.LIST_HTML_FETCHERS,
        "bidnet",
        registry.BIDNET_LIST_HTML_ADAPTER._replace(
            fetch_list_html=lambda source, url, session=None, timeout=30: (html, url, 200)
        ),
    )
    monkeypatch.setitem(
        registry.PLATFORM_ADAPTERS,
        "bidnet",
        lambda source, query=None, limit=25, **kwargs: co_bidnet.parse_bidnet_list_html(
            source, html, query=query, limit=limit
        ),
    )


def test_adapter_mode_still_reports_list_extraction_metadata(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    monkeypatch.setitem(
        registry.DEDICATED_ADAPTERS,
        "plain_source",
        lambda source, query=None, limit=25, **kwargs: [{"id": "plain_source:1", "title": "Road Repair"}],
    )

    exit_code, result = _run(
        {"task_id": "tsk_le_1", "source_id": "plain_source", "label": "Plain", "state_code": "CA", "fetch_config": {}},
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    assert result["metadata"]["listExtraction"] == {
        "method": "adapter",
        "items": 1,
        "diagnostics": {},
        "rendered": False,
        "extractor": None,
        "fallback_reason": None,
    }
    assert "emptyState" not in result["metadata"]


def test_verified_empty_tenant_page_is_a_zero_row_success(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, ERIE_FIXTURE.read_text(encoding="utf-8"))

    exit_code, result = _run(ERIE_TASK, monkeypatch, capsys)

    assert exit_code == 0
    assert result["status"] == "success"
    assert result["bids"] == []
    assert result["metadata"]["emptyState"] == {
        "verified": True,
        "marker": "There are no open bids at this time.",
        "tenant_confirmed": True,
        "method": "adapter",
    }
    assert result["metadata"]["listExtraction"]["items"] == 0


def test_unconfirmed_empty_page_stays_an_empty_result_failure(monkeypatch, capsys):
    monkeypatch.delenv("SCRAPLING_EXTRACTOR_URL", raising=False)
    _stub_bidnet_list_html(monkeypatch, ERIE_FIXTURE.read_text(encoding="utf-8"))

    task = dict(ERIE_TASK, task_id="tsk_empty_2", source_id="bidnet_co_boulder", label="Boulder County, CO (BidNet)", state_code="CO")
    exit_code, result = _run(task, monkeypatch, capsys)

    assert exit_code == 1
    assert result["status"] == "failure"
    assert result["errorCode"] == "EmptyCrawlerResultError"
    assert "emptyState" not in result["metadata"]


def test_scrapling_is_the_main_list_path_when_the_sidecar_is_configured(monkeypatch, capsys):
    from apsi_crawler import list_extraction

    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")
    _stub_bidnet_list_html(monkeypatch, "<html><body><table></table></body></html>")

    class Extractor:
        def extract_list(self, html, url, item_selector=None, selectors=None, max_items=200, timeout=None):
            return {
                "items": [
                    {
                        "title": "Street sweeping",
                        "url": "https://www.bidnetdirect.com/private/supplier/solicitations/4512345/detail",
                        "published_date": "09/01/2026",
                        "deadline_date": "09/30/2026",
                        "source_bid_id": "4512345",
                        "issuer_name": None,
                    }
                ],
                "diagnostics": {"title": "selector"},
                "empty_state": {"detected": False, "marker": None},
            }

    monkeypatch.setattr(list_extraction, "ListExtractorClient", lambda base_url, session=None: Extractor())

    exit_code, result = _run(dict(ERIE_TASK, task_id="tsk_le_2"), monkeypatch, capsys)

    assert exit_code == 0
    assert [bid["source_bid_id"] for bid in result["bids"]] == ["4512345"]
    assert result["metadata"]["listExtraction"] == {
        "method": "scrapling",
        "items": 1,
        "diagnostics": {"title": "selector"},
        "rendered": False,
        "extractor": "http://extractor.test",
        "fallback_reason": None,
    }


def test_sidecar_failure_falls_back_to_the_adapter_parser(monkeypatch, capsys):
    from apsi_crawler import list_extraction

    monkeypatch.setenv("SCRAPLING_EXTRACTOR_URL", "http://extractor.test")
    _stub_bidnet_list_html(
        monkeypatch,
        '<html><body><table><tr class="mets-table-row">'
        '<td><a href="/private/supplier/solicitations/4512345/detail">Street sweeping</a></td>'
        '<td><span class="date-value">09/01/2026</span></td></tr></table></body></html>',
    )

    class Broken:
        def extract_list(self, html, url, item_selector=None, selectors=None, max_items=200, timeout=None):
            raise list_extraction.ListExtractionError("extractor request failed: refused")

    monkeypatch.setattr(list_extraction, "ListExtractorClient", lambda base_url, session=None: Broken())

    exit_code, result = _run(dict(ERIE_TASK, task_id="tsk_le_3"), monkeypatch, capsys)

    assert exit_code == 0
    assert [bid["source_bid_id"] for bid in result["bids"]] == ["4512345"]
    assert result["metadata"]["listExtraction"]["method"] == "adapter_fallback"
    assert result["metadata"]["listExtraction"]["fallback_reason"].startswith("extractor_unreachable")
