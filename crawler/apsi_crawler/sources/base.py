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
    source_authority: str = "official"
    trust_status: str = "needs_review"
    evidence_mode: str = "direct_portal"
    validity_notes: str = ""
