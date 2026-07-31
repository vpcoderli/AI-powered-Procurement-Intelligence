from apsi_crawler.adapters.task import TaskSource
from apsi_crawler.spiders.bonfire import fetch_bonfire_opportunities as _bonfire_platform


UT_BONFIRE_PORTAL_URL = "https://utah.bonfirehub.com/portal/?tab=openOpportunities"
UT_BONFIRE_API_URL = "https://utah.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData"


def fetch_ut_bonfire_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    # Backward compat: this wrapper only ever serves the legacy Utah Bonfire
    # source id (ut_state_procurement in sources/state_sources.py, still
    # driven through SPECIAL_FETCHERS / validate-state-live). That call path
    # hands us a plain `Source` dataclass, which predates `fetch_config` and
    # has no such attribute at all -- so this reads it defensively via
    # getattr rather than assuming it exists like the fetch-task TaskSource
    # path does. When no tenant is configured (always true for that legacy
    # path) we build a TaskSource pointed at the "utah" subdomain and restore
    # the historical "Utah Bonfire" label the old hardcoded implementation
    # used, then delegate to the platform spider.
    fetch_config = getattr(source, "fetch_config", None) or {}
    if not fetch_config.get("tenant"):
        source = TaskSource(
            id=source.id,
            name=source.name,
            source_label="Utah Bonfire",
            jurisdiction=source.jurisdiction,
            state_code=source.state_code,
            base_url=source.base_url,
            fetch_config={**fetch_config, "tenant": "utah"},
        )

    return _bonfire_platform(
        source,
        query=query,
        limit=limit,
        session=session,
        timeout=timeout,
        fixture_json=fixture_json,
    )
