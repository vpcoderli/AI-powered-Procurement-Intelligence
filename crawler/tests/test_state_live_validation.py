from apsi_crawler.live_validation import (
    BETA_DEDICATED_STATE_SOURCES,
    validate_state_live_sources,
)
from apsi_crawler.sources.registry import get_source


def minimal_bid(source_id, title="Network services"):
    source = get_source(source_id)
    return {
        "source_bid_id": f"{source_id}-001",
        "title": title,
        "source": source.source_label,
        "state_code": source.state_code,
        "source_url": source.base_url,
    }


def test_default_live_validation_sources_are_current_beta_adapters():
    assert BETA_DEDICATED_STATE_SOURCES == (
        "pa_state_procurement",
        "sc_state_procurement",
        "or_state_procurement",
        "ma_state_procurement",
        "nj_state_procurement",
        "oh_state_procurement",
        "va_state_procurement",
        "wa_state_procurement",
        "ia_state_procurement",
        "ga_state_procurement",
        "me_state_procurement",
        "mo_state_procurement",
        "nv_state_procurement",
    )


def test_live_validation_succeeds_when_fetcher_returns_non_empty_bids():
    calls = []

    def fake_get_live_fetcher(source_id):
        def fetcher(source, query=None, limit=25, timeout=30):
            calls.append({"source": source.id, "query": query, "limit": limit, "timeout": timeout})
            return [minimal_bid(source.id)]

        return fetcher

    result = validate_state_live_sources(
        ["wa_state_procurement", "oh_state_procurement"],
        query="network",
        limit=3,
        timeout=7,
        get_live_fetcher_fn=fake_get_live_fetcher,
    )

    assert result.ok is True
    assert calls == [
        {"source": "wa_state_procurement", "query": "network", "limit": 3, "timeout": 7},
        {"source": "oh_state_procurement", "query": "network", "limit": 3, "timeout": 7},
    ]
    assert [item.status for item in result.sources] == ["success", "success"]
    assert [item.fetched_count for item in result.sources] == [1, 1]


def test_live_validation_fails_when_fetcher_returns_empty_results():
    def fake_get_live_fetcher(source_id):
        return lambda source, query=None, limit=25, timeout=30: []

    result = validate_state_live_sources(
        ["wa_state_procurement"],
        get_live_fetcher_fn=fake_get_live_fetcher,
    )

    assert result.ok is False
    assert result.sources[0].status == "failure"
    assert result.sources[0].fetched_count == 0
    assert result.sources[0].error_code == "EmptyCrawlerResultError"
    assert result.sources[0].error_message == "Crawler returned no opportunities for source: wa_state_procurement"


def test_live_validation_fails_when_bid_has_empty_content():
    def fake_get_live_fetcher(source_id):
        return lambda source, query=None, limit=25, timeout=30: [{"source_bid_id": "WA-1", "title": "  "}]

    result = validate_state_live_sources(
        ["wa_state_procurement"],
        get_live_fetcher_fn=fake_get_live_fetcher,
    )

    assert result.ok is False
    assert result.sources[0].status == "failure"
    assert result.sources[0].error_code == "LiveValidationError"
    assert result.sources[0].error_message == "wa_state_procurement returned bid 1 without title"


def test_live_validation_fails_when_fetcher_raises():
    def fake_get_live_fetcher(source_id):
        def fetcher(source, query=None, limit=25, timeout=30):
            raise RuntimeError("portal changed")

        return fetcher

    result = validate_state_live_sources(
        ["wa_state_procurement"],
        get_live_fetcher_fn=fake_get_live_fetcher,
    )

    assert result.ok is False
    assert result.sources[0].status == "failure"
    assert result.sources[0].error_code == "RuntimeError"
    assert result.sources[0].error_message == "portal changed"
