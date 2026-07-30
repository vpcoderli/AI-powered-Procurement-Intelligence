from apsi_crawler.adapters.registry import DEDICATED_ADAPTERS, PLATFORM_ADAPTERS, resolve_adapter


def test_every_provider_family_used_by_migration_has_an_adapter():
    # migrate-source-registry.ts only ever writes out these two provider_family values.
    for provider_family in ("bidnet", "generic"):
        assert provider_family in PLATFORM_ADAPTERS


def test_dedicated_sources_resolve_without_a_provider_family():
    for source_id in DEDICATED_ADAPTERS:
        assert resolve_adapter(source_id, None) is DEDICATED_ADAPTERS[source_id]
