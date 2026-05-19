import json
import re
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlencode, urlparse

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    normalize_space,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


IL_BIDBUY_OPEN_BIDS_URL = (
    "https://www.bidbuy.illinois.gov/bso/view/search/external/"
    "advancedSearchBid.xhtml"
)
IL_BIDBUY_OPEN_BIDS_PARAMS = {"openBids": "true"}
IL_BIDBUY_OPEN_BIDS_DISPLAY_URL = f"{IL_BIDBUY_OPEN_BIDS_URL}?openBids=true"
IL_BIDBUY_BASE_URL = "https://www.bidbuy.illinois.gov"
IL_BIDBUY_HEADERS = (
    "Bid Solicitation #",
    "Description",
    "Organization Name",
    "Bid Opening Date",
    "Status",
    "Alternate Id",
)
IL_BIDBUY_ATTACHMENT_LABEL = "File Attachments:"


class IlBidBuyError(Exception):
    pass


class _BidDetailParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden_inputs = {}
        self.rows = []
        self._row = None
        self._cell = None
        self._link = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "input" and attrs.get("type", "").lower() == "hidden":
            name = attrs.get("name")
            if name:
                self.hidden_inputs[name] = attrs.get("value", "")
            return

        if tag == "tr":
            self._row = []
        elif self._row is not None and tag in ("th", "td"):
            self._cell = {"text": [], "links": []}
        elif self._cell is not None and tag == "a":
            self._link = {"href": attrs.get("href"), "text": []}

    def handle_data(self, data):
        if self._cell is None:
            return
        self._cell["text"].append(data)
        if self._link is not None:
            self._link["text"].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._link is not None:
            self._cell["links"].append(
                {
                    "href": self._link.get("href"),
                    "text": normalize_space("".join(self._link["text"])),
                }
            )
            self._link = None
        elif tag in ("th", "td") and self._cell is not None and self._row is not None:
            self._row.append(
                {
                    "text": normalize_space("".join(self._cell["text"])),
                    "links": list(self._cell["links"]),
                }
            )
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def _base_query_value(base_url, name):
    values = parse_qs(urlparse(base_url).query).get(name)
    return values[0] if values else None


def _bid_detail_context(hidden_inputs, base_url):
    return {
        "docId": hidden_inputs.get("docId") or _base_query_value(base_url, "docId"),
        "currentPage": (
            hidden_inputs.get("currentPage")
            or _base_query_value(base_url, "currentPage")
            or "1"
        ),
        "parentUrl": (
            hidden_inputs.get("parentUrl")
            or _base_query_value(base_url, "parentUrl")
            or "close"
        ),
    }


def _download_file_args(href):
    if not href:
        return None
    match = re.search(
        r"downloadFile\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*['\"]?([^'\",\)]+)['\"]?)?\s*\)",
        href,
    )
    if not match:
        return None
    return match.group(1), match.group(2)


def _download_url(base_url, context, file_number, item_number=None):
    query = {
        "downloadFileNbr": file_number,
        "docId": context["docId"],
        "currentPage": context["currentPage"],
        "mode": "download",
        "parentUrl": context["parentUrl"],
    }
    if item_number:
        query["itemNbr"] = item_number
    return (
        absolute_url(base_url, "/bso/external/bidDetail.sda")
        + "?"
        + urlencode(query)
    )


def _row_to_record(row):
    source_bid_id = row.get("Bid Solicitation #")
    if not source_bid_id:
        raise IlBidBuyError("Illinois BidBuy row is missing bid solicitation number")

    links = row.get("_links", {})
    detail_href = links.get("Bid Solicitation #")
    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Description"),
        "description": row.get("Description"),
        "deadline_date": row.get("Bid Opening Date"),
        "issuer_name": row.get("Organization Name"),
        "source_url": absolute_url(IL_BIDBUY_BASE_URL, detail_href)
        if detail_href
        else IL_BIDBUY_OPEN_BIDS_DISPLAY_URL,
        "status": row.get("Status"),
        "alternate_id": row.get("Alternate Id"),
    }


def _records_from_html(html):
    try:
        rows = extract_table_rows(html, required_headers=IL_BIDBUY_HEADERS)
    except HtmlPageError as error:
        raise IlBidBuyError(
            "Illinois BidBuy page missing expected bid table headers"
        ) from error
    return [_row_to_record(row) for row in rows]


def _records_from_json(path):
    with open(path, encoding="utf-8") as fixture:
        payload = json.load(fixture)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("opportunities", "results"):
            records = payload.get(key)
            if isinstance(records, list):
                return records
    raise IlBidBuyError(
        "Illinois BidBuy fixture JSON did not contain opportunities or results"
    )


def discover_il_bidbuy_attachments(fixture_html, base_url):
    html = read_html_fixture(fixture_html)
    parser = _BidDetailParser()
    parser.feed(html)
    context = _bid_detail_context(parser.hidden_inputs, base_url)

    attachments = []
    for row in parser.rows:
        label_indexes = [
            index
            for index, cell in enumerate(row)
            if normalize_space(cell["text"]) == IL_BIDBUY_ATTACHMENT_LABEL
        ]
        for label_index in label_indexes:
            for cell in row[label_index + 1:]:
                for link in cell["links"]:
                    download_args = _download_file_args(link.get("href"))
                    if not download_args:
                        raise IlBidBuyError(
                            "Illinois BidBuy attachment row is missing URL"
                        )
                    file_number, item_number = download_args
                    attachments.append(
                        {
                            "name": link.get("text")
                            or f"Attachment {len(attachments) + 1}",
                            "url": _download_url(
                                base_url, context, file_number, item_number
                            ),
                            "size_label": None,
                            "mime_type": None,
                            "sort_order": len(attachments),
                        }
                    )
    return attachments


def fetch_il_bidbuy_opportunities(
    source,
    query=None,
    limit=25,
    session=None,
    timeout=30,
    fixture_html=None,
    fixture_json=None,
):
    limit_count = int(limit)
    if fixture_json:
        records = _records_from_json(fixture_json)
    else:
        if fixture_html:
            html = read_html_fixture(fixture_html)
        else:
            try:
                html = fetch_html(
                    IL_BIDBUY_OPEN_BIDS_URL,
                    session=session,
                    timeout=timeout,
                    params=IL_BIDBUY_OPEN_BIDS_PARAMS,
                )
            except HtmlPageError as error:
                raise IlBidBuyError(str(error)) from error
        records = _records_from_html(html)

    if query:
        query_text = query.lower()
        records = [
            record
            for record in records
            if query_text in " ".join(str(value) for value in record.values()).lower()
        ]

    return [
        normalize_state_opportunity(record, source)
        for record in records[:limit_count]
    ]
