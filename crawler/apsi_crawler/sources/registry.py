from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.base import Source
from apsi_crawler.sources.state_sources import STATE_SOURCES
from apsi_crawler.spiders.sam_gov import load_fixture_opportunities

SAM_GOV_SOURCE = Source(
    id="sam_gov",
    name="SAM.gov",
    source_label="SAM.gov",
    jurisdiction="federal",
    state_code="US",
    fixture_loader=load_fixture_opportunities,
)

SOURCES = {
    "sam_gov": SAM_GOV_SOURCE,
    **STATE_SOURCES,
}

SOURCE_ALIASES = {
    DEFAULT_SOURCE: "sam_gov",
}


def get_source(source=DEFAULT_SOURCE):
    source_id = SOURCE_ALIASES.get(source, source)
    return SOURCES[source_id]


def list_sources():
    return list(SOURCES.values())


def get_fixture_loader(source=DEFAULT_SOURCE):
    source_metadata = get_source(source)

    def load(path):
        if source_metadata.jurisdiction == "state":
            return source_metadata.fixture_loader(path, source_metadata)
        return source_metadata.fixture_loader(path)

    return load
