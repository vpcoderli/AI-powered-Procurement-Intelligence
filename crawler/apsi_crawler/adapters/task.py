"""Source objects constructed from task JSON payloads.

The existing 41 spiders share the signature fetch(source, query=, limit=, ...)
and only ever read the id / source_label / base_url / state_code attributes
(plus the quality/validity metadata the CLI reads for logging) off of
`source`. TaskSource exposes the same attribute surface, so spiders require
no changes to accept it in place of the hardcoded Source dataclass.
"""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TaskSource:
    id: str
    name: str
    source_label: str
    jurisdiction: str
    state_code: str
    base_url: str = ""
    adapter_kind: str = "platform"
    maturity: str = "beta"
    capabilities: tuple = ()
    source_authority: str = "official"
    trust_status: str = "beta"
    evidence_mode: str = "direct_portal"
    validity_notes: str = ""
    fetch_config: dict = field(default_factory=dict)


def task_source_from_payload(payload):
    source_id = (payload.get("source_id") or "").strip()
    if not source_id:
        raise ValueError("Task payload is missing source_id")

    label = (payload.get("label") or "").strip()
    if not label:
        raise ValueError(f"Task payload for {source_id} is missing label")

    fetch_config = payload.get("fetch_config") or {}
    if not isinstance(fetch_config, dict):
        raise ValueError(f"Task payload for {source_id} has a non-object fetch_config")

    return TaskSource(
        id=source_id,
        name=label,
        source_label=label,
        jurisdiction=payload.get("jurisdiction_level") or "state",
        state_code=(payload.get("state_code") or "").strip(),
        base_url=fetch_config.get("base_url") or payload.get("base_url") or "",
        capabilities=tuple(payload.get("capabilities") or ()),
        fetch_config=fetch_config,
    )
