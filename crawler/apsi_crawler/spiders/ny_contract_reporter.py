import json
from html.parser import HTMLParser

import requests

from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


# nyscr.ny.gov renders the public opportunity list server-side; there is no public
# JSON API. /Ads/Search accepts plain GET query params (Top = page size 5/10/25/50,
# Skip = offset, Sort). Ad detail pages require a free account, so source_url points
# at the canonical /Ads/Details/<id> address, which anonymous users reach via login.
NY_CONTRACT_REPORTER_SEARCH_URL = "https://www.nyscr.ny.gov/Ads/Search"
NY_CONTRACT_REPORTER_DETAIL_URL_TEMPLATE = "https://www.nyscr.ny.gov/Ads/Details/{ad_id}"
NY_CONTRACT_REPORTER_PAGE_SIZES = (5, 10, 25, 50)
NY_CONTRACT_REPORTER_SORT = "-DateIssued"

_FIELD_LABELS = frozenset(
    (
        "Title:",
        "CR#:",
        "Agency:",
        "Division:",
        "Issue date:",
        "Due date:",
        "Ad end date:",
        "Category:",
        "Location:",
        "Ad type:",
        "Note:",
    )
)
_IGNORED_CHUNKS = frozenset(("Log in or sign up to view this opportunity",))


class NyContractReporterError(Exception):
    pass


def _normalize_space(value):
    return " ".join(str(value or "").replace("\xa0", " ").split())


class _NyAdsSearchParser(HTMLParser):
    """Collects text chunks per `div.opp-list-item[data-ad-id]` listing card."""

    def __init__(self):
        super().__init__()
        self.items = []
        self._div_depth = 0
        self._item_depth = None
        self._current = None

    def handle_starttag(self, tag, attrs):
        if tag != "div":
            return
        self._div_depth += 1
        if self._current is not None:
            return
        attrs_dict = dict(attrs)
        classes = (attrs_dict.get("class") or "").split()
        if "opp-list-item" in classes:
            self._current = {"ad_id": attrs_dict.get("data-ad-id"), "chunks": []}
            self._item_depth = self._div_depth

    def handle_endtag(self, tag):
        if tag != "div":
            return
        if self._current is not None and self._div_depth == self._item_depth:
            self.items.append(self._current)
            self._current = None
            self._item_depth = None
        if self._div_depth > 0:
            self._div_depth -= 1

    def handle_data(self, data):
        if self._current is None:
            return
        text = _normalize_space(data)
        if text:
            self._current["chunks"].append(text)


def _fields_from_chunks(chunks):
    fields = {}
    label = None
    values = []
    for chunk in chunks:
        if chunk in _FIELD_LABELS:
            if label is not None and values:
                fields[label] = " ".join(values)
            label = chunk
            values = []
        elif chunk in _IGNORED_CHUNKS:
            continue
        elif label is not None:
            values.append(chunk)
    if label is not None and values:
        fields[label] = " ".join(values)
    return fields


def _record_from_item(item):
    fields = _fields_from_chunks(item["chunks"])
    ad_id = _normalize_space(item.get("ad_id")) or None
    source_bid_id = fields.get("CR#:") or ad_id
    if not source_bid_id:
        raise NyContractReporterError("NY Contract Reporter record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": fields.get("Title:"),
        "description": fields.get("Note:"),
        "original_category": fields.get("Category:"),
        "published_date": fields.get("Issue date:"),
        "deadline_date": fields.get("Due date:") or fields.get("Ad end date:"),
        "issuer_name": fields.get("Agency:"),
        "source_url": NY_CONTRACT_REPORTER_DETAIL_URL_TEMPLATE.format(
            ad_id=ad_id or source_bid_id
        ),
    }


def _parse_search_html(html):
    parser = _NyAdsSearchParser()
    parser.feed(html)
    return parser.items


def _page_size_for_limit(limit):
    for size in NY_CONTRACT_REPORTER_PAGE_SIZES:
        if limit <= size:
            return size
    return NY_CONTRACT_REPORTER_PAGE_SIZES[-1]


def _fetch_search_page(client, top, skip, timeout):
    try:
        response = client.get(
            NY_CONTRACT_REPORTER_SEARCH_URL,
            params={"Top": top, "Skip": skip, "Sort": NY_CONTRACT_REPORTER_SORT},
            timeout=timeout,
        )
    except requests.RequestException as error:
        raise NyContractReporterError(
            f"NY Contract Reporter request failed: {error}"
        ) from error

    if response.status_code != 200:
        raise NyContractReporterError(
            "NY Contract Reporter request failed with status "
            f"{response.status_code}: {response.text}"
        )

    return _parse_search_html(response.text)


# Legacy JSON-record replay support for import-fixture and hermetic tests.
def _records_from_json_payload(payload):
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise NyContractReporterError(
        "NY Contract Reporter response did not contain opportunities or results"
    )


def _first_present(record, keys):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return None


def _normalize_json_record(record):
    if not isinstance(record, dict):
        raise NyContractReporterError("NY Contract Reporter record was not an object")

    source_bid_id = _first_present(
        record,
        ("source_bid_id", "id", "contractId", "contract_id", "ad_id", "bid_id"),
    )
    if not source_bid_id:
        raise NyContractReporterError(
            "NY Contract Reporter record is missing source id"
        )

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(record, ("title", "name", "contractTitle")),
        "description": _first_present(record, ("description", "summary")),
        "original_category": _first_present(
            record,
            ("category", "type", "classification"),
        ),
        "published_date": _first_present(
            record,
            ("published_date", "postedDate", "posted_date"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "dueDate", "due_date", "response_deadline"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "source_url": _first_present(record, ("source_url", "url", "link")),
    }


def fetch_ny_contract_reporter_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_json=None,
    fixture_html=None,
):
    limit_count = int(limit)

    if fixture_json:
        with open(fixture_json) as fixture:
            payload = json.load(fixture)
        records = [
            _normalize_json_record(record)
            for record in _records_from_json_payload(payload)[:limit_count]
        ]
        return [normalize_state_opportunity(record, source) for record in records]

    if fixture_html:
        with open(fixture_html, encoding="utf-8") as fixture:
            items = _parse_search_html(fixture.read())
        if not items:
            raise NyContractReporterError(
                "NY Contract Reporter response did not contain opportunities"
            )
    else:
        client = session or requests.Session()
        close_client = session is None
        items = []
        top = _page_size_for_limit(limit_count)
        skip = 0
        try:
            while len(items) < limit_count:
                page_items = _fetch_search_page(client, top, skip, timeout)
                if not page_items:
                    if skip == 0:
                        raise NyContractReporterError(
                            "NY Contract Reporter response did not contain opportunities"
                        )
                    break
                items.extend(page_items)
                if len(page_items) < top:
                    break
                skip += top
        finally:
            if close_client:
                client.close()

    return [
        normalize_state_opportunity(_record_from_item(item), source)
        for item in items[:limit_count]
    ]
