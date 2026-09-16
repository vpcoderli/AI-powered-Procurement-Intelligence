"""Headless-Chromium page rendering (contract C3).

`POST /render` exists for portal tenants whose solicitation list is built by JavaScript after the
document loads: the crawler cannot see those rows in the server-rendered HTML, so it asks this
service for the rendered document and hands that to the Scrapling sidecar's `/extract-list`.

Every boundary `/download` enforces applies here unchanged, because both routes go through
`downloader.browser_page` and `downloader.navigate_guarded`:

- a page that looks like a login wall is refused (`LOGIN_WALL`) and its HTML is never returned;
- navigation to a host outside `allowed_hosts` is aborted (`OFF_HOST`), on the first request and
  on any redirect the page makes afterwards;
- the crawler's own User-Agent is used, no credential is ever typed, no CAPTCHA is ever touched;
- one browser job at a time, process-wide, shared with `/download`;
- nothing is written to disk and the rendered document is capped at 2 MiB (`TOO_LARGE`).
"""

import time
from dataclasses import dataclass

from downloader import (
    BROWSER_LOCK,
    PLAYWRIGHT_IMPORT_ERROR,
    PlaywrightError,
    PlaywrightTimeoutError,
    assert_on_host,
    browser_page,
    navigate_guarded,
    sync_playwright,
)
from guards import DownloadError, enforce_render_cap, is_login_html

# Playwright's own floor for a wait; `_remaining_ms` in downloader.py uses the same minimum.
_MIN_WAIT_MS = 1000


@dataclass(frozen=True)
class RenderResult:
    final_url: str
    status: int
    title: str
    html: str

    def as_dict(self):
        return {"final_url": self.final_url, "status": self.status, "title": self.title, "html": self.html}

    @property
    def byte_size(self):
        return len(self.html.encode("utf-8", errors="ignore"))


def render_page(request):
    """Execute a validated C3 render request. Raises DownloadError on every failure path."""
    if sync_playwright is None:
        raise DownloadError("BROWSER_ERROR", f"playwright is not importable: {PLAYWRIGHT_IMPORT_ERROR}")
    if not BROWSER_LOCK.acquire(timeout=request.timeout_seconds):
        raise DownloadError("TIMEOUT", "another browser job is still running")
    deadline = time.monotonic() + request.timeout_seconds
    try:
        with browser_page(request.allowed_hosts) as (page, session):
            return _render_locked(page, request, deadline, session)
    finally:
        BROWSER_LOCK.release()


def _remaining_ms(deadline):
    return max(_MIN_WAIT_MS, int((deadline - time.monotonic()) * 1000))


def _render_locked(page, request, deadline, session):
    response = navigate_guarded(page, request.page_url, deadline, session, request.timeout_seconds)
    _wait(page, request, deadline)
    # A page is free to navigate while we wait for it; re-check where we actually ended up.
    assert_on_host(page, session)

    html = page.content()
    if is_login_html(html):
        # The HTML of a login wall is never returned: it carries nothing extractable and the
        # sidecar must not become a way to read pages the crawler is not allowed to read.
        raise DownloadError("LOGIN_WALL", "page is a login wall; the sidecar never authenticates")
    enforce_render_cap(html)
    try:
        title = page.title()
    except PlaywrightError:  # noqa: BLE001 - a missing title never fails the render
        title = ""
    return RenderResult(
        final_url=page.url,
        status=response.status if response is not None else 0,
        title=title or "",
        html=html,
    )


def _wait(page, request, deadline):
    wait_for = request.wait_for
    if wait_for.selector:
        try:
            page.wait_for_selector(wait_for.selector, timeout=_remaining_ms(deadline), state="attached")
        except PlaywrightTimeoutError as error:
            raise DownloadError(
                "TIMEOUT",
                f"wait_for.selector {wait_for.selector!r} did not appear within {request.timeout_seconds}s",
            ) from error
        except PlaywrightError as error:
            raise DownloadError(
                "INVALID_REQUEST", f"wait_for.selector is not a valid selector: {error}"
            ) from error
    if wait_for.network_idle:
        try:
            page.wait_for_load_state("networkidle", timeout=_remaining_ms(deadline))
        except PlaywrightTimeoutError as error:
            raise DownloadError(
                "TIMEOUT", f"the page kept making requests for {request.timeout_seconds}s"
            ) from error
