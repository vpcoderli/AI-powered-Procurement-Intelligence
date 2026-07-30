import pytest

from apsi_crawler.adapters import registry
from apsi_crawler.adapters.registry import AdapterNotFoundError, resolve_adapter


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
