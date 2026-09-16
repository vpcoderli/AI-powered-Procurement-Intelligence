"""Client for the `browser-downloader` sidecar (contract C2).

Some portals (Illinois BidBuy is the reference case) expose an attachment only behind a
form/JS submit on the public detail page: a plain GET of the download URL returns an
"ERROR IN … session" HTML page whether or not a cookie is presented. For those sources the
archiver asks the sidecar to click the download control on the PUBLIC page and stream the
bytes back. The sidecar never logs in, never solves a CAPTCHA and never leaves the hosts we
name in `allowed_hosts`; this module only speaks its HTTP contract.

stdlib + `requests` only.
"""

from urllib.parse import parse_qsl, unquote, urlparse

import requests

from apsi_crawler.storage.content_sniff import clean_content_type


# C2 error code -> C1 failure_kind. Anything the sidecar cannot classify is a browser_error.
ERROR_CODE_FAILURE_KINDS = {
    "LOGIN_WALL": "login_wall",
    "LINK_NOT_FOUND": "link_not_found",
    "TIMEOUT": "timeout",
    "TOO_LARGE": "too_large",
    "OFF_HOST": "off_target",
    "NAVIGATION_FAILED": "browser_error",
    "BROWSER_ERROR": "browser_error",
    "INVALID_REQUEST": "browser_error",
}
DEFAULT_FAILURE_KIND = "browser_error"


class BrowserDownloadError(Exception):
    """A sidecar call that did not produce bytes, already mapped to a C1 `failure_kind`."""

    def __init__(self, failure_kind, message):
        super().__init__(message)
        self.failure_kind = failure_kind
        self.message = message


class BrowserDownloadResult(object):
    def __init__(self, content, content_type=None, filename=None, final_url=None):
        self.content = content
        self.content_type = content_type
        self.filename = filename
        self.final_url = final_url


def _host(url):
    try:
        return (urlparse(url or "").hostname or "").lower()
    except ValueError:
        return ""


_FILE_ID_PARAMETERS = (
    "downloadfilenbr", "filenbr", "fileid", "file_id", "attachmentid", "attachment_id", "documentid",
    "document_id", "docid", "doc_id", "attachment", "document", "file", "id",
)
_PAGINATION_PARAMETERS = frozenset(("currentpage", "page", "pagenum", "pagenumber", "offset", "start", "mode", "external"))


def browser_link_identifier(url):
    """A stable substring of the download URL the sidecar can match an anchor/onclick against.

    Query-string downloads carry the file number in a parameter (`downloadFileNbr=1807333`),
    and the page's `javascript:downloadFile('1807333')` control contains exactly that value.
    Choose by parameter NAME first (known file-id names, most specific first), then the
    longest numeric value that is not pagination noise (`currentPage=1` must never win),
    then the last path segment (`/docs/scope.pdf` -> `scope.pdf`), then the host.
    """
    parsed = urlparse(url or "")
    pairs = [(key.strip().lower(), value.strip()) for key, value in parse_qsl(parsed.query, keep_blank_values=False)]
    by_name = {key: value for key, value in pairs if value}
    for name in _FILE_ID_PARAMETERS:
        if by_name.get(name):
            return by_name[name]
    numeric = [value for key, value in pairs if value.isdigit() and key not in _PAGINATION_PARAMETERS]
    if numeric:
        return max(numeric, key=len)
    segments = [segment for segment in unquote(parsed.path or "").split("/") if segment]
    if segments:
        return segments[-1]
    return _host(url) or str(url or "")


def build_browser_download_request(item, timeout_seconds, max_bytes, selector=None):
    """Build the C2 `POST /download` body for one attachment item."""
    page_url = item.get("page_url") or item.get("url")
    url = item.get("url")
    allowed_hosts = []
    for candidate in (_host(page_url), _host(url)):
        if candidate and candidate not in allowed_hosts:
            allowed_hosts.append(candidate)
    return {
        "page_url": page_url,
        "link": {
            "href_contains": browser_link_identifier(url),
            "text": item.get("name"),
            "selector": selector or None,
        },
        "timeout_seconds": timeout_seconds,
        "max_bytes": max_bytes,
        "allowed_hosts": allowed_hosts,
    }


class BrowserDownloaderClient(object):
    def __init__(self, base_url, session=None):
        self.base_url = (base_url or "").rstrip("/")
        self.session = session or requests.Session()

    def download(self, request, timeout=None):
        if not self.base_url:
            raise BrowserDownloadError("browser_unavailable", "No browser_downloader_url configured.")
        # The sidecar has to navigate and click before it can answer, so give it the item
        # timeout plus headroom rather than the bare per-request timeout.
        wait = (timeout or request.get("timeout_seconds") or 30) + 15
        try:
            response = self.session.post("{0}/download".format(self.base_url), json=request, timeout=wait)
        except requests.Timeout as error:
            raise BrowserDownloadError("timeout", "browser downloader timed out: {0}".format(error))
        except requests.ConnectionError as error:
            raise BrowserDownloadError("browser_unavailable", "browser downloader unreachable: {0}".format(error))
        except requests.RequestException as error:
            raise BrowserDownloadError("browser_unavailable", "browser downloader request failed: {0}".format(error))

        if response.status_code == 200:
            headers = response.headers or {}
            return BrowserDownloadResult(
                content=bytes(response.content or b""),
                content_type=clean_content_type(headers.get("X-Download-Content-Type")) or None,
                filename=headers.get("X-Download-Filename") or None,
                final_url=headers.get("X-Download-Final-Url") or None,
            )

        code, message = self._error_detail(response)
        raise BrowserDownloadError(
            ERROR_CODE_FAILURE_KINDS.get(code, DEFAULT_FAILURE_KIND),
            "browser downloader {0} {1}: {2}".format(response.status_code, code, message),
        )

    @staticmethod
    def _error_detail(response):
        try:
            payload = response.json()
        except ValueError:
            return "BROWSER_ERROR", "non-JSON error body"
        error = payload.get("error") if isinstance(payload, dict) else None
        if not isinstance(error, dict):
            return "BROWSER_ERROR", "malformed error body"
        return str(error.get("code") or "BROWSER_ERROR"), str(error.get("message") or "")
