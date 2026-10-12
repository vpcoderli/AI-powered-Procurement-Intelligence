import json
from html.parser import HTMLParser
from time import monotonic, sleep
from urllib.parse import parse_qs, urlparse

import requests

from apsi_crawler.content_quality import is_login_html
from apsi_crawler.detail_backfill import apply_detail_history, detail_priority, record_outcome, retry_due, valid_body
from apsi_crawler.storage.sqlite import now_iso
from apsi_crawler.normalizers.bids import normalize_sam_gov_opportunity


SAM_GOV_OPPORTUNITIES_URL = "https://api.sam.gov/opportunities/v2/search"
MAX_DESCRIPTION_BYTES = 2 * 1024 * 1024


class _DescriptionText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.hidden += 1
        elif not self.hidden and tag in ("p", "div", "br", "li", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)
        elif not self.hidden and tag in ("p", "div", "li", "tr", "h1", "h2", "h3"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)

    def text(self):
        return "\n".join(line for part in "".join(self.parts).splitlines() if (line := " ".join(part.split())))


def _trusted_description_url(url, notice_id):
    try:
        parsed = urlparse(url)
        return (
            parsed.scheme == "https" and parsed.hostname == "api.sam.gov"
            and not parsed.username and not parsed.password and parsed.port in (None, 443)
            and parsed.path in ("/prod/opportunities/v1/noticedesc", "/opportunities/v1/noticedesc")
            and parse_qs(parsed.query).get("noticeid") == [str(notice_id)]
            and "api_key" not in parse_qs(parsed.query)
        )
    except ValueError:
        return False


def _fetch_description(client, url, api_key, timeout):
    response = None
    try:
        # Never forward the key through redirects or to a URL outside SAM's documented API.
        response = client.get(url, params={"api_key": api_key}, timeout=timeout, allow_redirects=False, stream=True)
        if response.status_code != 200:
            return None, f"http_{response.status_code}", response.status_code == 429
        chunks = []
        size = 0
        for chunk in response.iter_content(chunk_size=65536):
            size += len(chunk)
            if size > MAX_DESCRIPTION_BYTES:
                return None, "response_too_large", False
            chunks.append(chunk)
        body = b"".join(chunks).decode("utf-8", errors="replace")
        try:
            payload = json.loads(body)
        except ValueError:
            payload = body
        value = payload.get("description") if isinstance(payload, dict) else payload
        if not isinstance(value, str):
            return None, "invalid_response", False
        if is_login_html(value):
            return None, "login_wall", False
        parser = _DescriptionText()
        parser.feed(value)
        text = parser.text()
        if not text or text.casefold().rstrip(". ") == "description not found":
            return None, "not_found", False
        return text[:20000], None, False
    except requests.RequestException:
        # Request exceptions include credential-bearing URLs; retain only a safe error code.
        return None, "request_failed", False
    finally:
        if response is not None:
            response.close()


class SamGovApiError(Exception):
    """Raised when the SAM.gov opportunities API cannot be fetched."""


def _page_limit(limit):
    return max(1, min(int(limit), 1000))


def fetch_sam_gov_opportunities(
    api_key,
    posted_from,
    posted_to,
    limit=100,
    max_records=None,
    session=None,
    timeout=30,
    description_min_interval_seconds=3,
    max_descriptions=25,
    detail_history=None,
    now=now_iso,
):
    if not api_key:
        raise SamGovApiError("SAM.gov API key is required")
    if not posted_from or not posted_to:
        raise SamGovApiError("posted_from and posted_to are required")
    if isinstance(max_descriptions, bool) or not isinstance(max_descriptions, int) or not 0 <= max_descriptions <= 200:
        raise SamGovApiError("max_descriptions must be an integer between 0 and 200")

    client = session or requests.Session()
    page_size = _page_limit(limit)
    target_count = int(max_records) if max_records is not None else None
    offset = 0
    bids = []

    while True:
        params = {
            "api_key": api_key,
            "postedFrom": posted_from,
            "postedTo": posted_to,
            "limit": page_size,
            "offset": offset,
        }
        try:
            response = client.get(SAM_GOV_OPPORTUNITIES_URL, params=params, timeout=timeout, allow_redirects=False)
        except requests.RequestException:
            raise SamGovApiError("SAM.gov search request failed") from None

        if response.status_code != 200:
            raise SamGovApiError(
                f"SAM.gov request failed with status {response.status_code}"
            )

        payload = response.json()
        records = payload.get("opportunitiesData", [])
        total_records = int(payload.get("totalRecords", len(records)) or 0)

        for record in records:
            if target_count is not None and len(bids) >= target_count:
                break
            try:
                bids.append(normalize_sam_gov_opportunity(record))
            except (ValueError, TypeError) as error:
                # Keep the rejected input as a candidate for the parent's shared quality
                # gate. One malformed API row must not erase valid opportunities.
                raw = dict(record) if isinstance(record, dict) else {"value": record}
                raw["normalization_error"] = type(error).__name__
                bids.append({"source": "SAM.gov", "title": raw.get("title"), "raw_payload": raw,
                             "description": "", "full_description": None, "attachments": []})

        if not records or (target_count is not None and len(bids) >= target_count):
            break

        # SAM's offset is a page index, not a record offset (GSA public API contract).
        offset += 1
        if offset * page_size >= total_records:
            break

    apply_detail_history(bids, detail_history, "sam_gov")
    return enrich_sam_gov_bids(bids, api_key, session=client, timeout=timeout,
                              max_descriptions=max_descriptions,
                              min_interval_seconds=description_min_interval_seconds, now=now)


def enrich_sam_gov_bids(bids, api_key, *, session=None, timeout=30, max_descriptions=25,
                        min_interval_seconds=3, now=now_iso, backfill=False):
    """Fetch eligible persisted/current SAM bodies under one fair, rate-limited budget."""
    if not api_key:
        timestamp = now()
        for bid in bids:
            record_outcome(bid, "not_configured", "sam_api_key_not_configured", timestamp)
        return bids
    if isinstance(max_descriptions, bool) or not isinstance(max_descriptions, int) or not 0 <= max_descriptions <= 200:
        raise SamGovApiError("max_descriptions must be an integer between 0 and 200")
    client = session or requests.Session()
    timestamp = now()
    last_description_start = None
    description_throttled = False
    descriptions_attempted = 0
    for bid in sorted(bids, key=lambda row: detail_priority(row, timestamp)):
        description_text = None
        description_error = None
        attempted = False
        raw = bid.get("raw_payload") or {}
        description_url = raw.get("description")
        if valid_body(bid):
            record_outcome(bid, "reused", "persisted_body", timestamp)
            continue
        if isinstance(description_url, str) and description_url.strip().lower().startswith(("http://", "https://")):
            description_url = description_url.strip()
            if not _trusted_description_url(description_url, bid.get("source_bid_id")):
                description_error = "untrusted_description_url"
            elif description_throttled:
                description_error = "rate_limited"
            elif not retry_due(bid, timestamp):
                record_outcome(bid, "deferred", "cooldown", timestamp)
                continue
            elif descriptions_attempted >= max_descriptions:
                description_error = "budget_exhausted"
            else:
                if last_description_start is not None:
                    sleep(max(0, min_interval_seconds - (monotonic() - last_description_start)))
                last_description_start = monotonic()
                descriptions_attempted += 1
                attempted = True
                description_text, description_error, description_throttled = _fetch_description(client, description_url, api_key, timeout)
        else:
            record_outcome(bid, "not_configured", "description_endpoint_missing", timestamp, backfill=backfill)
            continue
        previous_enrichment = raw.get("enrichment") or {}
        if description_text is not None:
            # Keep core listing/lifecycle fields from this bid; only detail fields change.
            bid["description"] = description_text[:500]
            bid["full_description"] = description_text
            bid["detail_fetched_at"] = timestamp
            if isinstance(bid.get("quality_flags_json"), list):
                bid["quality_flags_json"] = [flag for flag in bid["quality_flags_json"] if flag not in ("description_fetch_failed", "description_not_fetched")]
            raw["enrichment"] = {**previous_enrichment, "fields": {"description": "sam_api"}, "applied_fields": ["description", "full_description"]}
        else:
            raw["enrichment"] = {**previous_enrichment, "fields": {"description": description_error}, "applied_fields": []}
            flags = bid.get("quality_flags_json")
            flags = list(flags) if isinstance(flags, list) else []
            flag = "description_not_fetched" if description_error == "budget_exhausted" else "description_fetch_failed"
            if flag not in flags:
                flags.append(flag)
            bid["quality_flags_json"] = flags
        bid["raw_payload"] = raw
        obtained = description_text is not None and valid_body(bid)
        status = "success" if obtained else "budget" if description_error == "budget_exhausted" else "restricted" if description_error in ("untrusted_description_url", "login_wall", "http_403") else "deferred" if description_error == "rate_limited" else "failure"
        record_outcome(bid, status, description_error or (None if obtained else "body_not_obtained"), timestamp, attempted=attempted, obtained_body=obtained, backfill=backfill)
    return bids
