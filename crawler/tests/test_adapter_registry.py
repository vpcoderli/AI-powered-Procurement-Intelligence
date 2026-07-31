import inspect
from pathlib import Path

import pytest

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.registry import AdapterNotFoundError, resolve_adapter
from apsi_crawler.adapters.task import task_source_from_payload

FIXTURES_DIR = Path(__file__).parent / "fixtures"


def test_dedicated_adapter_wins_over_platform_adapter(monkeypatch):
    def dedicated(source, **kwargs):
        return ["dedicated"]

    def platform(source, **kwargs):
        return ["platform"]

    monkeypatch.setitem(registry.DEDICATED_ADAPTERS, "ca_caleprocure", dedicated)
    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "bidnet", platform)

    assert resolve_adapter("ca_caleprocure", "bidnet") is dedicated


def test_falls_back_to_platform_adapter(monkeypatch):
    def platform(source, **kwargs):
        return ["platform"]

    monkeypatch.setitem(registry.PLATFORM_ADAPTERS, "bidnet", platform)

    assert resolve_adapter("al_state_procurement", "bidnet") is platform


def test_raises_when_neither_matches():
    with pytest.raises(AdapterNotFoundError) as excinfo:
        resolve_adapter("unknown_source", "unknown_platform")

    assert "unknown_source" in str(excinfo.value)
    assert "unknown_platform" in str(excinfo.value)


def test_raises_when_provider_family_is_absent_and_no_dedicated_adapter():
    with pytest.raises(AdapterNotFoundError):
        resolve_adapter("orphan_source", None)


def test_bidnet_platform_adapter_is_registered():
    assert "bidnet" in registry.PLATFORM_ADAPTERS


def test_verified_state_sources_have_dedicated_adapters():
    for source_id in ("ca_caleprocure", "tx_esbd", "ny_contract_reporter", "fl_mfmp", "il_bidbuy"):
        assert source_id in registry.DEDICATED_ADAPTERS


def test_every_registered_adapter_binds_the_fetch_task_calling_convention():
    """fetch_task always invokes `adapter(source, query=query, limit=limit)` (cli.py).
    Binding the raw fetch_bidnet_opportunities function (signature
    `(source, url, query=None, limit=25, ...)`) straight into PLATFORM_ADAPTERS is exactly
    the bug this guards against: it binds fine at import time and only blows up with a
    TypeError on the first live call, which no other test in this suite would have caught.
    inspect.signature(...).bind(...) reproduces fetch_task's exact call shape without
    actually invoking (and needing real behaviour from) every adapter.
    """
    stub_source = object()
    registries = {"platform": registry.PLATFORM_ADAPTERS, "dedicated": registry.DEDICATED_ADAPTERS}

    for registry_name, adapters in registries.items():
        for key, adapter in adapters.items():
            signature = inspect.signature(adapter)
            try:
                signature.bind(stub_source, query=None, limit=5)
            except TypeError as error:
                pytest.fail(
                    f"{registry_name} adapter {key!r} does not accept "
                    f"(source, query=, limit=) the way fetch_task calls it: {error}"
                )


def test_resolved_bidnet_adapter_fetches_and_normalizes_from_a_fixture():
    """Drives resolve_adapter("bidnet") end to end -- not a stub -- to prove the real wiring
    (fetch_bidnet_platform reading fetch_config.base_url, forwarding to
    fetch_bidnet_opportunities, normalizing through normalize_state_opportunity) actually
    works, hermetically via fixture_html.
    """
    source = task_source_from_payload(
        {
            "task_id": "t1",
            "source_id": "al_state_procurement",
            "label": "Alabama",
            "state_code": "AL",
            "provider_family": "bidnet",
            "fetch_config": {"base_url": "https://www.bidnetdirect.com/alabama/solicitations/open-bids"},
        }
    )

    adapter = resolve_adapter(source.id, "bidnet")
    bids = adapter(
        source,
        query="hardware",
        limit=5,
        fixture_html=str(FIXTURES_DIR / "co_bidnet_open_bids.html"),
    )

    assert len(bids) == 1
    bid = bids[0]
    assert bid["id"] == "al_state_procurement:0000425954"
    assert bid["source_bid_id"] == "0000425954"
    assert bid["title"] == "RFP 26-034 FNS Point-of-Sale Computer Hardware"
    assert bid["state_code"] == "AL"


def test_resolved_bidnet_adapter_raises_without_a_base_url():
    source = task_source_from_payload(
        {
            "task_id": "t2",
            "source_id": "al_state_procurement",
            "label": "Alabama",
            "state_code": "AL",
            "provider_family": "bidnet",
            "fetch_config": {},
        }
    )

    adapter = resolve_adapter(source.id, "bidnet")
    with pytest.raises(ValueError, match="fetch_config.base_url"):
        adapter(source, fixture_html=str(FIXTURES_DIR / "co_bidnet_open_bids.html"))


def test_resolved_bonfire_adapter_fetches_and_normalizes_from_a_fixture():
    source = task_source_from_payload(
        {
            "task_id": "t1",
            "source_id": "bonfire_ky_louisville",
            "label": "Louisville KY (Bonfire)",
            "state_code": "KY",
            "provider_family": "bonfire",
            "jurisdiction_level": "city",
            "fetch_config": {
                "tenant": "louisvilleky",
                "base_url": "https://louisvilleky.bonfirehub.com/portal/",
            },
        }
    )

    adapter = resolve_adapter(source.id, "bonfire")
    bids = adapter(
        source,
        limit=5,
        fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"),
    )

    assert len(bids) == 2
    assert bids[0]["source_bid_id"] == "RFP-2026-042"
    assert bids[0]["state_code"] == "KY"


def test_resolved_bonfire_adapter_raises_without_tenant():
    source = task_source_from_payload(
        {
            "task_id": "t3",
            "source_id": "bonfire_ky_louisville",
            "label": "Louisville",
            "state_code": "KY",
            "provider_family": "bonfire",
            "fetch_config": {},
        }
    )

    adapter = resolve_adapter(source.id, "bonfire")
    with pytest.raises(ValueError, match="fetch_config.tenant"):
        adapter(source, fixture_json=str(FIXTURES_DIR / "bonfire_sample.json"))
