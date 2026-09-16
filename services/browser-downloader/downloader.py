"""Headless-Chromium download execution.

Opens a public detail page, clicks the one element that matches the caller's link spec, and returns
the resulting attachment bytes in memory. The hard boundaries live here and in `guards.py`:

- the sidecar never types into an input and never submits credentials — it only clicks;
- a page that looks like a login wall is refused before any click;
- every navigation whose host is not allow-listed is aborted;
- CAPTCHAs are never solved or interacted with;
- downloads are size-capped and never persisted (Playwright's temp file is deleted).

One download runs at a time (module-level lock): Chromium is memory-hungry and the caller is a
single crawler worker, so serializing is both cheap and a natural rate limit on the portal.
"""

import os
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import unquote, urlparse

from guards import (
    DownloadError,
    enforce_max_bytes,
    filename_from_content_disposition,
    is_host_allowed,
    is_login_html,
    read_capped,
    sniff_content_type,
)
from link_resolution import LinkElement, describe_link, resolve_link

try:  # Playwright is optional for the unit tests, which never start a browser.
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
    from playwright.sync_api import sync_playwright

    PLAYWRIGHT_IMPORT_ERROR = None
except Exception as error:  # noqa: BLE001 - reported through /health, never raised at import time
    sync_playwright = None
    PlaywrightError = Exception
    PlaywrightTimeoutError = Exception
    PLAYWRIGHT_IMPORT_ERROR = error

# Identical to BROWSER_REQUEST_HEADERS["User-Agent"] in crawler/apsi_crawler/html/public_page.py —
# the portals see the same client whether the crawler fetches directly or through this sidecar.
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

CLICKABLE_SELECTOR = "a, button, input[type=submit], input[type=button], input[type=image]"

_COLLECT_JS = """
elements => elements.map(element => ({
  tag: element.tagName.toLowerCase(),
  href: element.getAttribute('href') || '',
  onclick: element.getAttribute('onclick') || '',
  text: (element.innerText || element.textContent || element.value || '').toString()
}))
"""

# How long a Content-Disposition response is given to turn into a Playwright `download` event
# before we fall back to reading the response body directly. Chromium usually converts such a
# navigation into a download; the fallback only covers the portals where it does not.
_ATTACHMENT_GRACE_SECONDS = 1.5

# One browser job at a time, downloads and renders alike (see module docstring).
_DOWNLOAD_LOCK = threading.Lock()
BROWSER_LOCK = _DOWNLOAD_LOCK
_PROBE_CACHE = {}


@dataclass(frozen=True)
class DownloadResult:
    content: bytes
    filename: str
    content_type: str
    final_url: str

    @property
    def byte_size(self):
        return len(self.content)


def playwright_version():
    try:
        from importlib.metadata import version

        return version("playwright")
    except Exception:  # noqa: BLE001 - version reporting must never fail /health
        return "unknown"


def probe_browser():
    """`{"ok": True, ...}` when Chromium is installed, else raise DownloadError."""
    if _PROBE_CACHE.get("ok"):
        return dict(_PROBE_CACHE["ok"])
    if sync_playwright is None:
        raise DownloadError("BROWSER_ERROR", f"playwright is not importable: {PLAYWRIGHT_IMPORT_ERROR}")
    playwright = None
    try:
        playwright = sync_playwright().start()
        executable = playwright.chromium.executable_path
        if not executable or not os.path.exists(executable):
            raise DownloadError(
                "BROWSER_ERROR", "chromium is not installed (run: python -m playwright install chromium)"
            )
    except DownloadError:
        raise
    except Exception as error:  # noqa: BLE001
        raise DownloadError("BROWSER_ERROR", f"{type(error).__name__}: {error}") from error
    finally:
        if playwright is not None:
            try:
                playwright.stop()
            except Exception:  # noqa: BLE001
                pass
    payload = {"ok": True, "browser": "chromium", "playwright": playwright_version()}
    _PROBE_CACHE["ok"] = payload
    return dict(payload)


def download_attachment(request):
    """Execute a validated C2 download request. Raises DownloadError on every failure path."""
    if sync_playwright is None:
        raise DownloadError("BROWSER_ERROR", f"playwright is not importable: {PLAYWRIGHT_IMPORT_ERROR}")
    if not _DOWNLOAD_LOCK.acquire(timeout=request.timeout_seconds):
        raise DownloadError("TIMEOUT", "another download is still running")
    deadline = time.monotonic() + request.timeout_seconds
    try:
        return _download_locked(request, deadline)
    finally:
        _DOWNLOAD_LOCK.release()


class _Session:
    """Mutable per-request state shared with the Playwright event listeners."""

    def __init__(self, allowed_hosts):
        self.allowed_hosts = allowed_hosts
        self.blocked = []
        self.downloads = []
        self.responses = {}
        self.attachment_seen_at = None

    def on_response(self, response):
        disposition = response.headers.get("content-disposition", "")
        self.responses.setdefault(
            response.url,
            {
                "content_type": response.headers.get("content-type", ""),
                "content_length": response.headers.get("content-length", ""),
                "content_disposition": disposition,
                "response": response,
            },
        )
        if "attachment" in disposition.lower() and self.attachment_seen_at is None:
            self.attachment_seen_at = time.monotonic()

    def attachment_url(self):
        for url, meta in self.responses.items():
            if "attachment" in (meta.get("content_disposition") or "").lower():
                return url
        return None


def _download_locked(request, deadline):
    with browser_page(request.allowed_hosts) as (page, session):
        return _run(page, request, deadline, session)


@contextmanager
def browser_page(allowed_hosts):
    """A headless-Chromium page with the sidecar's shared guards applied.

    Yields `(page, session)`: the crawler's User-Agent, every navigation policed against
    `allowed_hosts`, popups policed too, and the browser closed on the way out. `/render` uses the
    same plumbing as `/download` so a change to the guards can never apply to only one route.
    """
    session = _Session(allowed_hosts)
    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True, args=["--disable-dev-shm-usage"])
        except Exception as error:  # noqa: BLE001
            raise DownloadError(
                "BROWSER_ERROR", f"chromium failed to launch: {type(error).__name__}: {error}"
            ) from error
        try:
            context = browser.new_context(user_agent=BROWSER_USER_AGENT, accept_downloads=True)

            def handle_route(route, browser_request):
                # Only navigations are policed: blocking sub-resources would break pages that need
                # their own CSS/JS to render the download control at all.
                if browser_request.is_navigation_request() and not is_host_allowed(
                    browser_request.url, session.allowed_hosts
                ):
                    session.blocked.append(browser_request.url)
                    route.abort()
                    return
                route.continue_()

            context.route("**/*", handle_route)

            def watch(page):
                # Plain functions, not bound/builtin methods: Playwright tags every handler with an
                # attribute, which `list.append` and bound methods reject.
                page.on("download", lambda download: session.downloads.append(download))
                page.on("response", lambda response: session.on_response(response))

            context.on("page", watch)  # a download control that opens a popup stays policed
            page = context.new_page()
            watch(page)
            yield page, session
        finally:
            try:
                browser.close()
            except Exception:  # noqa: BLE001 - teardown must not mask the real error
                pass


def _remaining_ms(deadline, minimum=1000):
    return max(minimum, int((deadline - time.monotonic()) * 1000))


def navigate_guarded(page, url, deadline, session, timeout_seconds):
    """`page.goto` with the off-host and timeout rules applied. Returns the main response."""
    try:
        response = page.goto(url, timeout=_remaining_ms(deadline), wait_until="domcontentloaded")
    except PlaywrightTimeoutError as error:
        raise DownloadError("TIMEOUT", f"page did not load within {timeout_seconds}s") from error
    except PlaywrightError as error:
        if session.blocked:
            raise DownloadError("OFF_HOST", f"navigation to {session.blocked[0]} is not allow-listed") from error
        raise DownloadError("NAVIGATION_FAILED", f"{type(error).__name__}: {error}") from error
    assert_on_host(page, session)
    return response


def assert_on_host(page, session):
    """Re-check after anything that could navigate: an abort recorded, or a redirect that landed."""
    if session.blocked:
        raise DownloadError("OFF_HOST", f"navigation to {session.blocked[0]} is not allow-listed")
    if not is_host_allowed(page.url, session.allowed_hosts):
        raise DownloadError("OFF_HOST", f"page redirected to a host that is not allow-listed: {page.url}")


def _run(page, request, deadline, session):
    navigate_guarded(page, request.page_url, deadline, session, request.timeout_seconds)

    # Refuse before touching anything: no credential is ever entered, so a login wall is terminal.
    if is_login_html(page.content()):
        raise DownloadError("LOGIN_WALL", "page is a login wall; the sidecar never authenticates")

    handle = _locate(page, request.link)

    click_error = None
    try:
        # Click only. The sidecar has no code path that fills or submits a form field.
        handle.click(timeout=_remaining_ms(deadline))
    except PlaywrightError as error:
        # A click that starts a download or hits an aborted navigation can raise here in Chromium;
        # what actually happened is decided by the wait below.
        click_error = error

    while True:
        if session.downloads:
            return _result_from_download(session.downloads[0], request, session)
        if session.blocked:
            raise DownloadError("OFF_HOST", f"navigation to {session.blocked[0]} is not allow-listed")
        attachment = session.attachment_url()
        if attachment and time.monotonic() - session.attachment_seen_at >= _ATTACHMENT_GRACE_SECONDS:
            return _result_from_response(attachment, request, session, deadline)
        if time.monotonic() >= deadline:
            if attachment:
                return _result_from_response(attachment, request, session, deadline)
            if click_error is not None:
                raise DownloadError(
                    "NAVIGATION_FAILED", f"click failed: {type(click_error).__name__}: {click_error}"
                )
            raise DownloadError("TIMEOUT", f"no download started within {request.timeout_seconds}s")
        page.wait_for_timeout(100)


def _locate(page, link):
    """C2 resolution order: selector → href_contains → text."""
    if link.selector:
        query = f"xpath={link.selector}" if link.selector.startswith(("//", "(//", "..")) else link.selector
        try:
            matches = page.query_selector_all(query)
        except PlaywrightError as error:
            raise DownloadError("INVALID_REQUEST", f"link.selector is not a valid selector: {error}") from error
        if matches:
            return matches[0]

    handles = page.query_selector_all(CLICKABLE_SELECTOR)
    described = page.eval_on_selector_all(CLICKABLE_SELECTOR, _COLLECT_JS) if handles else []
    elements = [
        LinkElement(
            index=index,
            tag=str(item.get("tag") or "a"),
            href=str(item.get("href") or ""),
            onclick=str(item.get("onclick") or ""),
            text=str(item.get("text") or ""),
        )
        for index, item in enumerate(described)
    ]
    match = resolve_link(elements, link)
    if match is None or match.index >= len(handles):
        raise DownloadError("LINK_NOT_FOUND", f"no clickable element matched {describe_link(link)}")
    return handles[match.index]


def _result_from_download(download, request, session):
    url = download.url
    if not is_host_allowed(url, session.allowed_hosts):
        _discard(download)
        raise DownloadError("OFF_HOST", f"download came from a host that is not allow-listed: {url}")
    _guard_content_length(session.responses.get(url, {}), request.max_bytes)
    try:
        path = download.path()
    except PlaywrightError as error:
        raise DownloadError("NAVIGATION_FAILED", f"download did not complete: {error}") from error
    if path is None:
        raise DownloadError("NAVIGATION_FAILED", "download produced no content")
    try:
        content = read_capped(str(path), request.max_bytes)
    finally:
        # The sidecar keeps nothing on disk; the crawler owns the archive.
        _discard(download)
    filename = (
        download.suggested_filename
        or filename_from_content_disposition(session.responses.get(url, {}).get("content_disposition"))
        or _filename_from_url(url)
    )
    return DownloadResult(
        content=content,
        filename=filename,
        content_type=_content_type_for(session.responses, url, content),
        final_url=url,
    )


def _result_from_response(url, request, session, deadline):
    """A navigation that returned `Content-Disposition: attachment` without a download event."""
    if not is_host_allowed(url, session.allowed_hosts):
        raise DownloadError("OFF_HOST", f"attachment came from a host that is not allow-listed: {url}")
    meta = session.responses.get(url, {})
    _guard_content_length(meta, request.max_bytes)
    response = meta.get("response")
    try:
        body = response.body()
    except Exception as error:  # noqa: BLE001 - a consumed navigation body is not readable back
        raise DownloadError("NAVIGATION_FAILED", f"could not read the attachment response: {error}") from error
    enforce_max_bytes(len(body), request.max_bytes)
    filename = filename_from_content_disposition(meta.get("content_disposition")) or _filename_from_url(url)
    return DownloadResult(
        content=body,
        filename=filename,
        content_type=_content_type_for(session.responses, url, body),
        final_url=url,
    )


def _content_type_for(responses, url, content):
    header = (responses.get(url, {}).get("content_type") or "").split(";")[0].strip()
    return sniff_content_type(content, fallback="") or header or "application/octet-stream"


def _guard_content_length(meta, max_bytes):
    try:
        declared = int((meta or {}).get("content_length") or "")
    except (TypeError, ValueError):
        return
    if declared > max_bytes:
        raise DownloadError("TOO_LARGE", f"Content-Length {declared} exceeds the {max_bytes} byte cap")


def _discard(download):
    try:
        download.delete()
    except Exception:  # noqa: BLE001 - best effort; the temp dir goes away with the browser anyway
        pass


def _filename_from_url(url):
    name = unquote(urlparse(url).path).rstrip("/").split("/")[-1]
    return name or "download.bin"
