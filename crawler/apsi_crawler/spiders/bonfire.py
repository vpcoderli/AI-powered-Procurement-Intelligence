import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


class BonfireError(Exception):
    pass


def _projects_from_payload(payload):
    projects = payload.get("payload", {}).get("projects", {}) if isinstance(payload, dict) else {}
    if isinstance(projects, dict):
        return list(projects.values())
    if isinstance(projects, list):
        return projects
    return []


def _record_from_project(project, tenant, source_label):
    source_bid_id = project.get("ReferenceID") or project.get("ProjectID")
    if not source_bid_id:
        raise BonfireError("Bonfire project is missing reference id")
    project_id = project.get("ProjectID")
    return {
        "source_bid_id": source_bid_id,
        "title": project.get("ProjectName"),
        "description": project.get("ProjectName"),
        "deadline_date": project.get("DateClose"),
        "issuer_name": source_label,
        "source_url": (
            f"https://{tenant}.bonfirehub.com/opportunities/{project_id}"
            if project_id
            else f"https://{tenant}.bonfirehub.com/portal/?tab=openOpportunities"
        ),
        "attachments": [],
    }


def _load_payload(tenant, fixture_json=None, session=None, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as f:
            return json.load(f)

    portal_url = f"https://{tenant}.bonfirehub.com/portal/?tab=openOpportunities"
    api_url = f"https://{tenant}.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData"

    client = session or requests.Session()
    close_client = session is None
    try:
        client.get(portal_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        response = client.get(
            api_url,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": portal_url,
                "User-Agent": "Mozilla/5.0",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise BonfireError(
                f"Bonfire {tenant} request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise BonfireError(f"Bonfire {tenant} request failed: {error}") from error
    except ValueError as error:
        raise BonfireError(f"Bonfire {tenant} response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_bonfire_opportunities(source, query=None, limit=25, session=None, timeout=30, fixture_json=None):
    tenant = (source.fetch_config or {}).get("tenant")
    if not tenant:
        raise ValueError(f"Bonfire source {source.id} missing fetch_config.tenant")

    limit_count = int(limit)
    payload = _load_payload(tenant, fixture_json=fixture_json, session=session, timeout=timeout)
    records = [
        _record_from_project(project, tenant, source.source_label)
        for project in _projects_from_payload(payload)
    ]
    if not records:
        raise BonfireError(f"Bonfire {tenant} response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(v) for v in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
