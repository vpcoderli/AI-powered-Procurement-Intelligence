import json
from urllib.parse import quote

import requests
from apsi_crawler.html.public_page import (
    absolute_url,
    extract_table_rows,
    read_html_fixture,
)
from apsi_crawler.normalizers.state_bids import normalize_state_opportunity


VA_EVA_VENDOR_BASE_URL = "https://mvendor.cgieva.com"
VA_EVA_SOLR_URL = (
    "https://mvendor.cgieva.com/Vendor/public/solrconnect.jsp?"
    "q=*:*&sort=pubdate%20desc,id%20desc&facet.field=status&facet.field=agencyname"
    "&facet.field=doccddesc&facet.field=category&facet.field=setasideshortdesc"
    "&facet.field=pubdate&facet.field=closedate&facet.field=sosearch"
    "&f.setasideshortdesc.facet.sort=index&rows={rows}&facet.limit=600"
    "&facet.sort=count&facet=on&facet.mincount=1&wt=json&cursorMark=*"
)

VA_EVA_HEADERS = (
    "Solicitation Number",
    "Solicitation Title",
    "Agency",
    "Posted Date",
    "Closing Date",
    "Category",
    "Documents",
)


class VaEvaError(Exception):
    pass


def _first_present(record, keys, default=None):
    for key in keys:
        value = record.get(key)
        if value not in (None, ""):
            return value
    return default


def _attachment(name, url, source, sort_order):
    if not url:
        return None
    return {
        "name": name or f"Attachment {sort_order + 1}",
        "url": absolute_url(source.base_url, url),
        "size_label": None,
        "mime_type": None,
        "sort_order": sort_order,
    }


def _attachments_from_items(items, source):
    attachments = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        attachment = _attachment(
            _first_present(item, ("name", "title", "label")),
            _first_present(item, ("url", "href", "link")),
            source,
            len(attachments),
        )
        if attachment:
            attachments.append(attachment)
    return attachments


def _record_from_row(row, source):
    source_bid_id = row.get("Solicitation Number")
    if not source_bid_id:
        raise VaEvaError("eVA row is missing solicitation number")

    links = row.get("_links", {})
    attachments = []
    document_link = links.get("Documents")
    if document_link:
        attachments.append(_attachment(row.get("Documents"), document_link, source, 0))

    return {
        "source_bid_id": source_bid_id,
        "title": row.get("Solicitation Title"),
        "description": row.get("Solicitation Title"),
        "issuer_name": row.get("Agency"),
        "published_date": row.get("Posted Date"),
        "deadline_date": row.get("Closing Date"),
        "original_category": row.get("Category"),
        "source_url": absolute_url(
            source.base_url,
            links.get("Solicitation Number") or links.get("Solicitation Title") or "",
        ),
        "attachments": [attachment for attachment in attachments if attachment],
    }


def _record_from_json(record, source):
    source_bid_id = _first_present(
        record,
        ("source_bid_id", "solicitationNumber", "solicitation_number", "id"),
    )
    if not source_bid_id:
        raise VaEvaError("eVA record is missing source id")

    return {
        "source_bid_id": source_bid_id,
        "title": _first_present(
            record,
            ("title", "solicitationTitle", "solicitation_title", "name"),
        ),
        "description": _first_present(
            record,
            ("description", "summary", "solicitationTitle", "solicitation_title", "title"),
        ),
        "issuer_name": _first_present(record, ("issuer_name", "agency", "department")),
        "published_date": _first_present(
            record,
            ("published_date", "postedDate", "posted_date"),
        ),
        "deadline_date": _first_present(
            record,
            ("deadline_date", "closingDate", "closing_date", "due_date"),
        ),
        "original_category": _first_present(
            record,
            ("original_category", "category", "commodity"),
        ),
        "source_url": absolute_url(
            source.base_url,
            _first_present(record, ("source_url", "detailUrl", "detail_url", "url"), ""),
        ),
        "attachments": _attachments_from_items(
            _first_present(record, ("attachments", "documents"), []),
            source,
        ),
    }


def _detail_url(record):
    app = record.get("app")
    doc_code = record.get("doccd")
    department = record.get("docdeptcd")
    external_id = record.get("externalid")
    internal_id = record.get("internalid") or external_id
    version = record.get("version")
    if app == "QQ":
        path = (
            "/Vendor/public/QQDetails.jsp?PageTitle=QQ%20Details"
            f"&REQUEST_ID={quote(str(external_id or ''))}"
        )
    elif app == "ADV":
        path = (
            "/Vendor/public/ADVSODetails.jsp?PageTitle=SO%20Details"
            f"&DOC_CD={quote(str(doc_code or ''))}&Details_Page=ADVSODetails.jsp"
            f"&DEPT_CD={quote(str(department or ''))}"
            f"&BID_INTRNL_NO={quote(str(internal_id or ''))}"
            f"&BID_NO={quote(str(external_id or ''))}"
            f"&BID_VERS_NO={quote(str(version or ''))}"
        )
    elif app == "VBO":
        path = (
            "/Vendor/public/VBODetails.jsp?PageTitle=SO%20Details"
            f"&DOC_CD={quote(str(doc_code or ''))}&Details_Page=VBOSODetails.jsp"
            f"&DEPT_CD={quote(str(department or ''))}"
            f"&BID_INTRNL_NO={quote(str(internal_id or ''))}"
            f"&BID_NO={quote(str(external_id or ''))}"
            f"&BID_VERS_NO={quote(str(version or ''))}"
        )
    else:
        path = (
            "/Vendor/public/IVDetails.jsp?PageTitle=SO%20Details"
            f"&rfp_id_lot={quote(str(internal_id or ''))}"
            f"&rfp_id_round={quote(str(version or ''))}"
        )
    return absolute_url(VA_EVA_VENDOR_BASE_URL, path)


def _record_from_solr_doc(record):
    source_bid_id = _first_present(record, ("externalid", "id", "internalid"))
    if not source_bid_id:
        raise VaEvaError("eVA Solr record is missing source id")

    title = _first_present(record, ("shortdesc", "longdesc", "id"))
    return {
        "source_bid_id": source_bid_id,
        "title": title,
        "description": _first_present(record, ("longdesc", "shortdesc")),
        "issuer_name": record.get("agencyname"),
        "published_date": record.get("pubdate"),
        "deadline_date": record.get("closedate"),
        "original_category": _first_present(record, ("category", "doccddesc")),
        "source_url": _detail_url(record),
        "attachments": [],
    }


def _records_from_solr_payload(payload):
    docs = payload.get("response", {}).get("docs", [])
    if not docs:
        raise VaEvaError("eVA Solr response did not contain opportunities")
    records = []
    for doc in docs:
        try:
            records.append(_record_from_solr_doc(doc))
        except VaEvaError:
            continue
    if not records:
        raise VaEvaError("eVA Solr response did not contain valid opportunities")
    return records


def _fetch_solr_records(limit_count, session=None, timeout=30):
    client = session or requests.Session()
    close_client = session is None
    try:
        try:
            response = client.get(
                VA_EVA_SOLR_URL.format(rows=max(limit_count, 15)),
                headers={
                    "Accept": "application/json,text/plain,*/*",
                    "Referer": (
                        "https://mvendor.cgieva.com/Vendor/public/"
                        "AllOpportunities.jsp"
                    ),
                    "User-Agent": (
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/125.0.0.0 Safari/537.36"
                    ),
                },
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise VaEvaError(f"eVA Solr request failed: {error}") from error
        if response.status_code != 200:
            raise VaEvaError(
                f"eVA Solr request failed with status {response.status_code}: {response.text}"
            )
        try:
            return _records_from_solr_payload(response.json())
        except ValueError as error:
            raise VaEvaError("eVA Solr response was not valid JSON") from error
    finally:
        if close_client:
            client.close()


def _records_from_payload(payload, source):
    if isinstance(payload, list):
        records = payload
    elif isinstance(payload, dict):
        if "response" in payload:
            return _records_from_solr_payload(payload)
        records = []
        for key in ("opportunities", "results", "bids"):
            value = payload.get(key)
            if isinstance(value, list):
                records = value
                break
    else:
        records = []
    if not records:
        raise VaEvaError("eVA fixture JSON did not contain opportunities")
    return [_record_from_json(record, source) for record in records]


def _records_from_html(html, source):
    try:
        rows = extract_table_rows(html, required_headers=VA_EVA_HEADERS)
    except HtmlPageError as error:
        raise VaEvaError("eVA page missing expected solicitation table headers") from error
    return [_record_from_row(row, source) for row in rows]


def fetch_va_eva_opportunities(
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
        with open(fixture_json, encoding="utf-8") as fixture:
            records = _records_from_payload(json.load(fixture), source)
    else:
        if fixture_html:
            html = read_html_fixture(fixture_html)
        else:
            records = _fetch_solr_records(
                limit_count,
                session=session,
                timeout=timeout,
            )
            html = None
        if html is not None:
            records = _records_from_html(html, source)

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
