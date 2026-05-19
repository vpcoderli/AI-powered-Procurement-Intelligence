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
