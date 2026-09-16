"""Pure safety rules for the browser-downloader sidecar: request validation, host allow-listing,
size caps, header hygiene and the login-wall detector.

Nothing here imports Playwright or the crawler package, so every rule is unit-testable without a
browser and the sidecar stays a standalone deployable (see README).
"""

import os
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import unquote, urlparse

# C2 error codes → HTTP status. Any code outside this table is a bug on our side, so it reports 500.
ERROR_STATUS = {
    "INVALID_REQUEST": 400,
    "LOGIN_WALL": 403,
    "OFF_HOST": 403,
    "LINK_NOT_FOUND": 404,
    "TOO_LARGE": 413,
    "NAVIGATION_FAILED": 502,
    "BROWSER_ERROR": 500,
    "TIMEOUT": 504,
}

DEFAULT_TIMEOUT_SECONDS = 30
MAX_TIMEOUT_SECONDS = 300
SERVICE_MAX_BYTES = 52428800  # 50 MB, the plan's archive cap
# C3 (`POST /render`): the rendered document is returned inside a JSON body and then parsed by the
# Scrapling sidecar, whose own html cap is the same 2 MiB.
MAX_RENDER_HTML_BYTES = 2 * 1024 * 1024


def _service_max_bytes():
    raw = os.environ.get("BROWSER_DOWNLOADER_MAX_BYTES")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return SERVICE_MAX_BYTES
    return value if value > 0 else SERVICE_MAX_BYTES


DEFAULT_MAX_BYTES = _service_max_bytes()


class DownloadError(Exception):
    """A failure that maps onto a C2 error code."""

    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message

    @property
    def status(self):
        return ERROR_STATUS.get(self.code, 500)


def error_envelope(code, message):
    return {"error": {"code": code, "message": message}}


@dataclass(frozen=True)
class LinkSpec:
    selector: str = None
    href_contains: str = None
    text: str = None


@dataclass(frozen=True)
class DownloadRequest:
    page_url: str
    link: LinkSpec
    timeout_seconds: int
    max_bytes: int
    allowed_hosts: tuple


@dataclass(frozen=True)
class WaitFor:
    """What `POST /render` waits for after `domcontentloaded`, before reading the document."""

    selector: str = None
    network_idle: bool = False


@dataclass(frozen=True)
class RenderRequest:
    page_url: str
    timeout_seconds: int
    allowed_hosts: tuple
    wait_for: WaitFor


def _require_str(value, field):
    if not isinstance(value, str) or not value.strip():
        raise DownloadError("INVALID_REQUEST", f"{field} must be a non-empty string")
    return value.strip()


def host_of(url):
    """Lowercased hostname of an http(s) URL, or "" when there is none."""
    if not isinstance(url, str) or not url:
        return ""
    try:
        parsed = urlparse(url)
    except ValueError:
        return ""
    return (parsed.hostname or "").lower()


def is_host_allowed(url, allowed_hosts):
    """Exact hostname match, case-insensitive and port-agnostic.

    Deliberately not suffix matching: `files.example.gov` is a different host from `example.gov`
    and must be allow-listed explicitly by the caller.
    """
    host = host_of(url)
    if not host:
        return False
    return host in {str(entry).lower() for entry in allowed_hosts}


def parse_download_request(payload, max_bytes_cap=None):
    """Validate a POST /download body into a `DownloadRequest` (C2), or raise INVALID_REQUEST.

    The schema has no field that could carry credentials, a form fill or a script — by
    construction the sidecar can only be asked to open a page and click one element.
    """
    cap = _service_max_bytes() if max_bytes_cap is None else max_bytes_cap
    if not isinstance(payload, dict):
        raise DownloadError("INVALID_REQUEST", "body must be a JSON object")

    page_url, page_host = _parse_page_url(payload)

    link = payload.get("link")
    if not isinstance(link, dict):
        raise DownloadError("INVALID_REQUEST", "link must be an object")
    spec_fields = {}
    for field in ("selector", "href_contains", "text"):
        value = link.get(field)
        if value is None:
            spec_fields[field] = None
            continue
        if not isinstance(value, str):
            raise DownloadError("INVALID_REQUEST", f"link.{field} must be a string or null")
        spec_fields[field] = value.strip() or None
    if not any(spec_fields.values()):
        raise DownloadError("INVALID_REQUEST", "link must provide selector, href_contains or text")

    timeout_seconds = _parse_timeout(payload)

    max_bytes = payload.get("max_bytes", cap)
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int):
        raise DownloadError("INVALID_REQUEST", "max_bytes must be an integer")
    if max_bytes <= 0:
        raise DownloadError("INVALID_REQUEST", "max_bytes must be positive")
    max_bytes = min(max_bytes, cap)

    return DownloadRequest(
        page_url=page_url,
        link=LinkSpec(**spec_fields),
        timeout_seconds=int(timeout_seconds),
        max_bytes=max_bytes,
        allowed_hosts=_parse_allowed_hosts(payload, page_host),
    )


def _parse_page_url(payload):
    page_url = _require_str(payload.get("page_url"), "page_url")
    if urlparse(page_url).scheme not in ("http", "https"):
        raise DownloadError("INVALID_REQUEST", "page_url must be an http(s) URL")
    page_host = host_of(page_url)
    if not page_host:
        raise DownloadError("INVALID_REQUEST", "page_url must contain a host")
    return page_url, page_host


def _parse_timeout(payload):
    timeout_seconds = payload.get("timeout_seconds", DEFAULT_TIMEOUT_SECONDS)
    if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)):
        raise DownloadError("INVALID_REQUEST", "timeout_seconds must be a number")
    if not 1 <= timeout_seconds <= MAX_TIMEOUT_SECONDS:
        raise DownloadError("INVALID_REQUEST", f"timeout_seconds must be between 1 and {MAX_TIMEOUT_SECONDS}")
    return timeout_seconds


def _parse_allowed_hosts(payload, page_host):
    allowed_hosts = payload.get("allowed_hosts", [])
    if allowed_hosts is None:
        allowed_hosts = []
    if not isinstance(allowed_hosts, list):
        raise DownloadError("INVALID_REQUEST", "allowed_hosts must be an array of host names")
    hosts = []
    for entry in allowed_hosts:
        if not isinstance(entry, str) or not entry.strip():
            raise DownloadError("INVALID_REQUEST", "allowed_hosts entries must be non-empty strings")
        hosts.append(entry.strip().lower())
    # The page we were asked to open is implicitly reachable; anything else must be listed.
    if page_host not in hosts:
        hosts.append(page_host)
    return tuple(hosts)


def parse_render_request(payload):
    """Validate a POST /render body into a `RenderRequest` (C3), or raise INVALID_REQUEST.

    Like `/download`, the schema has no field that could carry a credential, a form fill or a
    script: the sidecar can only be asked to open a page, wait, and hand back what it rendered.
    """
    if not isinstance(payload, dict):
        raise DownloadError("INVALID_REQUEST", "body must be a JSON object")
    page_url, page_host = _parse_page_url(payload)

    wait_for = payload.get("wait_for")
    if wait_for is None:
        wait_for = {}
    if not isinstance(wait_for, dict):
        raise DownloadError("INVALID_REQUEST", "wait_for must be an object or null")
    unknown = set(wait_for) - {"selector", "network_idle"}
    if unknown:
        raise DownloadError("INVALID_REQUEST", f"wait_for has unsupported keys: {sorted(unknown)}")
    selector = wait_for.get("selector")
    if selector is not None and not isinstance(selector, str):
        raise DownloadError("INVALID_REQUEST", "wait_for.selector must be a string or null")
    selector = selector.strip() if isinstance(selector, str) else None
    if selector == "":
        raise DownloadError("INVALID_REQUEST", "wait_for.selector must be a non-empty string or null")
    network_idle = wait_for.get("network_idle", False)
    if network_idle is None:
        network_idle = False
    if not isinstance(network_idle, bool):
        raise DownloadError("INVALID_REQUEST", "wait_for.network_idle must be a boolean")

    return RenderRequest(
        page_url=page_url,
        timeout_seconds=int(_parse_timeout(payload)),
        allowed_hosts=_parse_allowed_hosts(payload, page_host),
        wait_for=WaitFor(selector=selector, network_idle=network_idle),
    )


def enforce_render_cap(html):
    """Refuse a rendered document past the C3 cap instead of streaming megabytes to the crawler."""
    byte_size = len(html.encode("utf-8", errors="ignore"))
    if byte_size > MAX_RENDER_HTML_BYTES:
        raise DownloadError(
            "TOO_LARGE", f"rendered html is {byte_size} bytes, cap is {MAX_RENDER_HTML_BYTES}"
        )
    return html


def enforce_max_bytes(byte_size, max_bytes):
    if byte_size > max_bytes:
        raise DownloadError("TOO_LARGE", f"download is {byte_size} bytes, cap is {max_bytes}")
    return byte_size


def read_capped(path, max_bytes, chunk_size=262144):
    """Read a file into memory, refusing as soon as it passes `max_bytes`.

    Playwright writes downloads to its own temp directory; this is where those bytes enter the
    process, so the cap is enforced while reading rather than after.
    """
    chunks = []
    total = 0
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise DownloadError("TOO_LARGE", f"download exceeds the {max_bytes} byte cap")
            chunks.append(chunk)
    return b"".join(chunks)


_FILENAME_STAR_RE = re.compile(r"filename\*\s*=\s*([^;]+)", re.IGNORECASE)
_FILENAME_RE = re.compile(r"filename\s*=\s*(\"[^\"]*\"|[^;]+)", re.IGNORECASE)


def filename_from_content_disposition(value):
    """Best-effort filename from a Content-Disposition header; path separators are stripped."""
    if not isinstance(value, str) or not value:
        return None
    name = None
    star = _FILENAME_STAR_RE.search(value)
    if star:
        raw = star.group(1).strip().strip('"')
        parts = raw.split("'", 2)
        name = unquote(parts[2] if len(parts) == 3 else raw)
    else:
        plain = _FILENAME_RE.search(value)
        if plain:
            name = plain.group(1).strip().strip('"')
    if not name:
        return None
    name = name.replace("\\", "/").split("/")[-1].strip()
    return name or None


def header_safe(value):
    """ASCII, single-line value fit for an HTTP response header."""
    if value is None:
        return ""
    text = str(value).replace("\r", "").replace("\n", "")
    return text.encode("ascii", "replace").decode("ascii")


def sniff_content_type(data, fallback="application/octet-stream"):
    """Minimal magic-byte sniff; the crawler re-sniffs authoritatively (C1)."""
    if not data:
        return fallback
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"PK\x03\x04"):
        return "application/zip"
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        return "application/x-ole-storage"
    return fallback


# ---------------------------------------------------------------------------------------------
# Login-wall rule.
#
# Copied verbatim (comments included) from `crawler/apsi_crawler/content_quality.py` — the
# enrichment stage's `is_login_html` and its `_DetailContentParser` helpers. The sidecar must stay
# independent of the crawler package (it ships as its own container with only Playwright), so the
# rule is duplicated rather than imported. Keep the two copies in sync: a change to the crawler's
# rule belongs here too, and `tests/test_guards.py::TestLoginWallRule` pins the shared behaviour.
# ---------------------------------------------------------------------------------------------

# Portals print the same sentence with and without a trailing period/colon ("Road repair" vs
# "Road repair."), so an echo comparison that only collapses whitespace and case still lets a
# title copy through as a description/full body. Edge punctuation is stripped for IDENTITY
# comparisons only — lengths and body checks keep using the full text.
_EDGE_PUNCTUATION = " \t\r\n.,:;!?-–—_*/'\"()[]{}。，、：；！？"


def comparable_text(value):
    return " ".join(value.split()).casefold() if isinstance(value, str) else ""


def echo_key(value):
    return comparable_text(value).strip(_EDGE_PUNCTUATION)


def useful_text(value, title):
    text = echo_key(value)
    return bool(text) and text != echo_key(title)


def is_body(value, title):
    text = comparable_text(value)
    return useful_text(value, title) and len(text) >= 150 and (
        "." in text or "。" in text or len(text.split()) >= 25
    )


# Portals qualify the description label ("Solicitation Description", "Short Description",
# "Bulletin Desc"). An exact-match list of five strings made every such page look like a login
# wall as soon as it also carried a site-wide login widget, which disables enrichment for the
# whole source. Match the label word instead, with a length bound so a paragraph that merely
# contains the word is not mistaken for a label cell.
_DESCRIPTION_LABEL_RE = re.compile(
    r"^.{0,30}?\b(?:desc|description|scope of work|statement of work|summary)\b.{0,20}$"
)


class _DetailContentParser(HTMLParser):
    """Recognize login controls without treating page-wide WebForms as login pages."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = [{"tag": "document", "children": [], "text": [], "excluded": False}]
        self.nodes = []
        self.headings = []
        self.has_credentials = False
        self.login_action = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        login_form = tag == "form" and bool(re.search(
            r"/(?:login|signin|sign-in|auth)(?:/|$)",
            unquote(urlparse(attrs.get("action", "")).path).lower(),
        ))
        parent = self.stack[-1]
        node = {
            "tag": tag, "children": [], "text": [], "parent": parent,
            "excluded": parent["excluded"] or login_form or tag in ("script", "style", "nav", "header", "footer", "aside"),
        }
        parent["children"].append(node)
        self.nodes.append(node)
        if tag not in ("input", "br", "hr", "img", "meta", "link", "source", "wbr", "area", "base", "embed", "param", "track", "col"):
            self.stack.append(node)
        if tag == "input" and attrs.get("type", "").lower() in ("password", "email"):
            self.has_credentials = True
        if login_form:
            self.login_action = True

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        if any(node["tag"] in ("title", "h1", "h2") for node in self.stack):
            self.headings.append(data)
        if not self.stack[-1]["excluded"]:
            for node in self.stack:
                node["text"].append(data)

    def has_public_description(self):
        """Require a label/value or prose body outside login controls and instructions."""
        login_instructions = re.compile(r"\b(?:log\s*in|sign\s*in|create an account)\b")
        for node in self.nodes:
            text = comparable_text(" ".join(node["text"]))
            if not node["excluded"] and node["tag"] in ("p", "article", "main") and is_body(text, "") and not login_instructions.search(text):
                return True
            if node["excluded"] or node["tag"] not in ("td", "th", "dt", "label", "h2", "h3", "span", "strong", "b"):
                continue
            if not _DESCRIPTION_LABEL_RE.search(text.rstrip(": ")):
                continue
            # Portals put the label directly in a td/dt or wrap it in a span/b element.
            for label_node in (node, node["parent"]):
                parent = label_node.get("parent")
                if not parent:
                    continue
                siblings = parent["children"]
                index = next(index for index, sibling in enumerate(siblings) if sibling is label_node)
                if index + 1 >= len(siblings):
                    continue
                value = siblings[index + 1]
                text = comparable_text(" ".join(value["text"]))
                if not value["excluded"] and len(text) >= 15 and not login_instructions.search(text):
                    return True
        return False


def is_login_html(html):
    parser = _DetailContentParser()
    parser.feed(html)
    headings = comparable_text(" ".join(parser.headings))
    login_heading = bool(re.search(r"\b(?:log\s*in|sign\s*in|authenticate)\b", headings))
    return parser.has_credentials and (login_heading or parser.login_action) and not parser.has_public_description()
