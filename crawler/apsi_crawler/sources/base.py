from dataclasses import dataclass


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    source_label: str
    jurisdiction: str
    state_code: str
    fixture_loader: object
    live_fetcher: object = None
    base_url: str = ""
    adapter_kind: str = "none"
    maturity: str = "none"
    capabilities: tuple = ()
