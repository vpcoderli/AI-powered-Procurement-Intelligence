from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.spiders.sam_gov import load_fixture_opportunities

SOURCES = {
    DEFAULT_SOURCE: {
        "fixture_loader": load_fixture_opportunities,
    },
}


def get_fixture_loader(source=DEFAULT_SOURCE):
    return SOURCES[source]["fixture_loader"]
