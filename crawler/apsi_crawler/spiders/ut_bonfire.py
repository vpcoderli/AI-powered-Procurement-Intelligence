import json

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


UT_BONFIRE_PORTAL_URL = "https://utah.bonfirehub.com/portal/?tab=openOpportunities"
UT_BONFIRE_API_URL = "https://utah.bonfirehub.com/PublicPortal/getOpenPublicOpportunitiesSectionData"


class UtBonfireError(Exception):
    pass


def _projects_from_payload(payload):
    projects = payload.get("payload", {}).get("projects", {}) if isinstance(payload, dict) else {}
    if isinstance(projects, dict):
        return list(projects.values())
    if isinstance(projects, list):
        return projects
    return []


def _record_from_project(project):
    source_bid_id = project.get("ReferenceID") or project.get("ProjectID")
    if not source_bid_id:
        raise UtBonfireError("Utah Bonfire project is missing reference id")
    project_id = project.get("ProjectID")
    return {
        "source_bid_id": source_bid_id,
        "title": project.get("ProjectName"),
        "description": project.get("ProjectName"),
        "deadline_date": project.get("DateClose"),
        "issuer_name": "Utah Bonfire",
        "source_url": f"https://utah.bonfirehub.com/opportunities/{project_id}" if project_id else UT_BONFIRE_PORTAL_URL,
        "attachments": [],
    }


def _load_payload(fixture_json=None, session=None, timeout=30):
    if fixture_json:
        with open(fixture_json, encoding="utf-8") as fixture:
            return json.load(fixture)

    client = session or requests.Session()
    close_client = session is None
    try:
        client.get(UT_BONFIRE_PORTAL_URL, headers={"User-Agent": "Mozilla/5.0"}, timeout=timeout)
        response = client.get(
            UT_BONFIRE_API_URL,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Referer": UT_BONFIRE_PORTAL_URL,
                "User-Agent": "Mozilla/5.0",
            },
            timeout=timeout,
        )
        if response.status_code != 200:
            raise UtBonfireError(
                f"Utah Bonfire request failed with status {response.status_code}: {response.text}"
            )
        return response.json()
    except requests.RequestException as error:
        raise UtBonfireError(f"Utah Bonfire request failed: {error}") from error
    except ValueError as error:
        raise UtBonfireError("Utah Bonfire response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def fetch_ut_bonfire_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
):
    limit_count = int(limit)
    payload = _load_payload(fixture_json=fixture_json, session=session, timeout=timeout)
    records = [_record_from_project(project) for project in _projects_from_payload(payload)]
    if not records:
        raise UtBonfireError("Utah Bonfire response did not contain opportunities")

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [normalize_state_opportunity(record, source) for record in records[:limit_count]]
