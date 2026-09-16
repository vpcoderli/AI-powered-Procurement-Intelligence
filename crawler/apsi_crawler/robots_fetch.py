"""Fetch a portal's robots.txt with the crawler's own HTTP client.

Node's `fetch` (undici) is rejected outright by some WAF-fronted portals (BidNet Direct answers
403 to every Node request, even with a browser User-Agent — verified 2026-09-16), while the
crawler's `requests` session with `BROWSER_REQUEST_HEADERS` is served. The robots.txt a portal
shows the crawler is also the one that matters for the crawler, so the compliance pre-check asks
the crawler to fetch it.
"""

import requests

from apsi_crawler.html.public_page import BROWSER_REQUEST_HEADERS

try:  # Python 3.9 compatible
    from urllib.parse import urlparse
except ImportError:  # pragma: no cover
    raise

MAX_BODY_BYTES = 64 * 1024


class InvalidRobotsRequestError(ValueError):
    pass


def robots_url_for(base_url):
    parsed = urlparse(str(base_url or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise InvalidRobotsRequestError("base_url must be an absolute http(s) URL")
    return "{0}://{1}/robots.txt".format(parsed.scheme, parsed.netloc)


def fetch_robots(payload, session=None, timeout=15):
    if not isinstance(payload, dict):
        raise InvalidRobotsRequestError("request must be a JSON object")
    robots_url = robots_url_for(payload.get("base_url"))
    client = session or requests.Session()
    close_client = session is None
    try:
        try:
            response = client.get(robots_url, headers=BROWSER_REQUEST_HEADERS, timeout=timeout, allow_redirects=True)
        except requests.RequestException as error:
            return {"robots_url": robots_url, "status": 0, "final_url": None, "body": "", "error": str(error)}
        body = response.text or ""
        return {
            "robots_url": robots_url,
            "status": int(response.status_code),
            "final_url": getattr(response, "url", None) or robots_url,
            "content_type": (response.headers.get("Content-Type") or "").split(";")[0].strip().lower() or None,
            "body": body[:MAX_BODY_BYTES],
            "truncated": len(body) > MAX_BODY_BYTES,
            "error": None,
        }
    finally:
        if close_client:
            client.close()
