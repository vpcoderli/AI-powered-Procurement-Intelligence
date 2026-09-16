"""Hardened attachment archiving: magic sniffing, relative paths, failure kinds, browser mode."""

import io
import zipfile

import pytest
import requests

from apsi_crawler.storage import content_sniff
from apsi_crawler.storage.archive import looks_browser_or_login_required
from apsi_crawler.storage.archive_attachments import (
    InvalidArchiveRequestError,
    archive_attachments,
)
from apsi_crawler.storage.browser_download import (
    BrowserDownloadError,
    browser_link_identifier,
    build_browser_download_request,
)


PDF_BYTES = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n"
DOC_BYTES = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64
LOGIN_HTML = (
    "<html><head><title>Sign In</title></head><body>"
    "<h1>Log in</h1>"
    "<form action='/login'><input type='password' name='pw'/>"
    "<input type='submit' value='Log in'/></form>"
    "</body></html>"
)
ERROR_HTML = "<!DOCTYPE html><html><body><p>ERROR IN PROCESSING YOUR SESSION</p></body></html>"


def _ooxml_bytes(content_types_payload, member):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types_payload)
        archive.writestr(member, "x")
    return buffer.getvalue()


DOCX_BYTES = _ooxml_bytes(
    '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "word/document.xml",
)
XLSX_BYTES = _ooxml_bytes(
    '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "xl/workbook.xml",
)
PPTX_BYTES = _ooxml_bytes(
    '<?xml version="1.0"?><Types><Override ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
    "ppt/presentation.xml",
)


class FakeResponse:
    def __init__(self, content=b"", status_code=200, headers=None, url=None, history=()):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}
        self.url = url
        self.history = list(history)
        self.closed = False

    def iter_content(self, chunk_size=8192):
        for start in range(0, len(self.content), chunk_size):
            yield self.content[start:start + chunk_size]

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, responses=None, posts=None):
        self.responses = list(responses or [])
        self.posts = list(posts or [])
        self.calls = []
        self.post_calls = []
        self.closed = False

    def get(self, url, headers=None, timeout=None, stream=False, **kwargs):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout, "stream": stream})
        if not self.responses:
            raise AssertionError("No fake GET response queued for {0}".format(url))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def post(self, url, json=None, timeout=None, **kwargs):
        self.post_calls.append({"url": url, "json": json, "timeout": timeout})
        if not self.posts:
            raise AssertionError("No fake POST response queued for {0}".format(url))
        response = self.posts.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        self.closed = True


class FakeJsonResponse:
    def __init__(self, status_code, payload=None, content=b"", headers=None):
        self.status_code = status_code
        self._payload = payload
        self.content = content
        self.headers = headers or {}

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


class Sleeper:
    def __init__(self):
        self.slept = []
        self.clock = 0.0

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.clock += seconds

    def monotonic(self):
        return self.clock


def _request(items, tmp_path, **source_overrides):
    source = {
        "id": "il_bidbuy",
        "label": "Illinois BidBuy",
        "mode": "direct",
        "min_interval_seconds": 0,
        "timeout_seconds": 30,
        "max_bytes": 52428800,
        "browser_link_selector": None,
    }
    source.update(source_overrides)
    return {
        "archive_root": str(tmp_path),
        "browser_downloader_url": None,
        "source": source,
        "items": items,
    }


def _item(url, **overrides):
    item = {
        "id": "il_bidbuy:27-444:attachment:1",
        "bid_id": "il_bidbuy:27-444",
        "bid_source": "Illinois BidBuy",
        "source_bid_id": "27-444DHS-P",
        "page_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=27-444DHS-P",
        "url": url,
        "name": "Solicitation.pdf",
        "expected_extension": ".pdf",
    }
    item.update(overrides)
    return item


def _run(items, tmp_path, session=None, sleeper=None, **source_overrides):
    sleeper = sleeper or Sleeper()
    return archive_attachments(
        _request(items, tmp_path, **source_overrides),
        session=session or FakeSession(),
        sleep=sleeper.sleep,
        monotonic=sleeper.monotonic,
        now=lambda: "2026-09-16T03:00:00+00:00",
    )


# --------------------------------------------------------------------------- content sniffing


@pytest.mark.parametrize(
    "payload,expected",
    [
        (PDF_BYTES, "application/pdf"),
        (DOCX_BYTES, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        (XLSX_BYTES, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        (PPTX_BYTES, "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
        (b"PK\x03\x04" + b"\x00" * 40, "application/zip"),
        (DOC_BYTES, "application/msword"),
        (b"name,amount\nroad,12\n", "text/plain"),
        (b"<!DOCTYPE html><html></html>", "text/html"),
        (b"   \n\r\n<html><body>hi</body></html>", "text/html"),
        (b"\xef\xbb\xbf<!doctype HTML>", "text/html"),
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, None),
    ],
)
def test_sniff_bytes_recognizes_document_magic(payload, expected):
    assert content_sniff.sniff_bytes(payload) == expected


def test_sniff_bytes_uses_header_to_separate_xls_from_doc():
    assert content_sniff.sniff_bytes(DOC_BYTES, "application/vnd.ms-excel") == "application/vnd.ms-excel"


def test_sniff_bytes_reports_csv_when_header_says_csv():
    assert content_sniff.sniff_bytes(b"a,b\n1,2\n", "text/csv") == "text/csv"


def test_is_html_bytes_tolerates_leading_whitespace_and_case():
    assert content_sniff.is_html_bytes(b"\n\t  <HTML>")
    assert content_sniff.is_html_bytes(b"<!doctype html>")
    assert not content_sniff.is_html_bytes(PDF_BYTES)
    assert not content_sniff.is_html_bytes(b"plain text, no markup")


def test_extension_for_content_type_maps_known_types():
    assert content_sniff.extension_for_content_type("application/pdf") == ".pdf"
    assert content_sniff.extension_for_content_type(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ) == ".xlsx"
    assert content_sniff.extension_for_content_type("text/csv") == ".csv"
    assert content_sniff.extension_for_content_type("application/x-nonsense") is None


# --------------------------------------------------------------------------- blocklist


@pytest.mark.parametrize(
    "url",
    [
        "https://example.gov/login/download",
        "https://example.gov/signin",
        "https://example.gov/auth/token",
        "https://example.gov/sign-in/",
        "https://example.gov/browser_check",
        "https://example.gov/captcha/image",
    ],
)
def test_blocklist_matches_whole_path_segments(url):
    assert looks_browser_or_login_required(url) is True


@pytest.mark.parametrize(
    "url",
    [
        "https://example.gov/authority/bid/7/doc.pdf",
        "https://example.gov/associations/loginson/file.pdf",
        "https://example.gov/documents/authorization-form.pdf",
        "https://example.gov/bso/external/bidDetail.sdo?downloadFileNbr=1807333",
    ],
)
def test_blocklist_allows_urls_that_merely_contain_a_marker(url):
    assert looks_browser_or_login_required(url) is False


# --------------------------------------------------------------------------- direct downloads


def test_archives_pdf_with_relative_storage_path_and_sniffed_type(tmp_path):
    session = FakeSession([
        FakeResponse(
            PDF_BYTES,
            headers={"Content-Type": "application/octet-stream"},
            url="https://www.bidbuy.illinois.gov/documents/scope.pdf",
        )
    ])

    response = _run([_item("https://www.bidbuy.illinois.gov/documents/scope.pdf")], tmp_path, session=session)

    result = response["results"][0]
    assert result["archive_status"] == "archived"
    assert result["storage_path"] == "il_bidbuy/il_bidbuy_27-444/il_bidbuy_27-444_attachment_1.pdf"
    assert (tmp_path / result["storage_path"]).read_bytes() == PDF_BYTES
    assert result["byte_size"] == len(PDF_BYTES)
    assert result["content_type"] == "application/pdf"
    assert result["checksum_sha256"]
    assert result["failure_kind"] is None
    assert result["archive_error"] is None
    assert result["method"] == "direct"
    assert result["fetched_at"] == "2026-09-16T03:00:00+00:00"
    assert response["stats"]["archived"] == 1
    assert response["stats"]["failed"] == 0
    assert isinstance(response["stats"]["duration_ms"], int)


def test_direct_download_sends_browser_headers_and_referer(tmp_path):
    session = FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})])

    _run([_item("https://www.bidbuy.illinois.gov/documents/scope.pdf")], tmp_path, session=session)

    call = session.calls[0]
    assert call["stream"] is True
    assert call["timeout"] == 30
    assert call["headers"]["User-Agent"].startswith("Mozilla/5.0 (Macintosh")
    assert call["headers"]["Referer"] == (
        "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=27-444DHS-P"
    )


def test_html_content_type_is_never_written_to_disk(tmp_path):
    session = FakeSession([
        FakeResponse(ERROR_HTML.encode("utf-8"), headers={"Content-Type": "text/html; charset=utf-8"})
    ])

    response = _run([_item("https://www.bidbuy.illinois.gov/bidDetail.sdo?downloadFileNbr=1")], tmp_path, session=session)

    result = response["results"][0]
    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "html_response"
    assert result["storage_path"] is None
    assert result["byte_size"] is None
    assert list(tmp_path.rglob("*")) == []
    assert response["stats"]["failed"] == 1


def test_html_magic_bytes_behind_a_pdf_content_type_are_rejected(tmp_path):
    session = FakeSession([
        FakeResponse(b"  <html><body>nope</body></html>", headers={"Content-Type": "application/pdf"})
    ])

    result = _run([_item("https://example.gov/docs/scope.pdf")], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "html_response"
    assert list(tmp_path.rglob("*")) == []


def test_login_html_is_reported_as_login_wall(tmp_path):
    session = FakeSession([FakeResponse(LOGIN_HTML.encode("utf-8"), headers={"Content-Type": "text/html"})])

    result = _run([_item("https://example.gov/docs/scope.pdf")], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "login_wall"
    assert list(tmp_path.rglob("*")) == []


def test_redirect_off_target_is_reported_without_downloading(tmp_path):
    session = FakeSession([
        FakeResponse(
            PDF_BYTES,
            headers={"Content-Type": "application/pdf"},
            url="https://identity.example.gov/login",
            history=[object()],
        )
    ])

    result = _run([_item("https://example.gov/docs/scope.pdf")], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "off_target"
    assert result["final_url"] == "https://identity.example.gov/login"
    assert list(tmp_path.rglob("*")) == []


@pytest.mark.parametrize(
    "status_code,expected",
    [(403, "http_4xx"), (404, "http_4xx"), (500, "http_5xx"), (503, "http_5xx")],
)
def test_http_error_statuses_map_to_failure_kinds(tmp_path, status_code, expected):
    session = FakeSession([FakeResponse(b"oops", status_code=status_code)])

    result = _run([_item("https://example.gov/docs/scope.pdf")], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == expected
    assert str(status_code) in result["archive_error"]


def test_timeout_and_connection_errors_map_to_failure_kinds(tmp_path):
    timeout = _run(
        [_item("https://example.gov/docs/scope.pdf")],
        tmp_path,
        session=FakeSession([requests.Timeout("timed out")]),
    )["results"][0]
    network = _run(
        [_item("https://example.gov/docs/scope.pdf")],
        tmp_path,
        session=FakeSession([requests.ConnectionError("refused")]),
    )["results"][0]

    assert timeout["failure_kind"] == "timeout"
    assert network["failure_kind"] == "network"


def test_max_bytes_is_enforced_while_streaming_and_leaves_no_partial_file(tmp_path):
    session = FakeSession([
        FakeResponse(PDF_BYTES + b"x" * 5000, headers={"Content-Type": "application/pdf"})
    ])

    response = _run(
        [_item("https://example.gov/docs/scope.pdf")],
        tmp_path,
        session=session,
        max_bytes=64,
    )

    result = response["results"][0]
    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "too_large"
    assert result["storage_path"] is None
    assert list(tmp_path.rglob("*")) == []


def test_min_interval_seconds_is_honoured_between_requests(tmp_path):
    sleeper = Sleeper()
    session = FakeSession([
        FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"}),
        FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"}),
        FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"}),
    ])
    items = [
        _item("https://example.gov/docs/a.pdf", id="a:1", bid_id="bid:a"),
        _item("https://example.gov/docs/b.pdf", id="a:2", bid_id="bid:a"),
        _item("https://example.gov/docs/c.pdf", id="a:3", bid_id="bid:a"),
    ]

    response = _run(items, tmp_path, session=session, sleeper=sleeper, min_interval_seconds=3)

    assert [result["archive_status"] for result in response["results"]] == ["archived"] * 3
    assert sleeper.slept == [3, 3]


def test_no_throttle_before_the_first_request(tmp_path):
    sleeper = Sleeper()
    session = FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})])

    _run([_item("https://example.gov/docs/a.pdf")], tmp_path, session=session, sleeper=sleeper, min_interval_seconds=5)

    assert sleeper.slept == []


def test_skipped_items_do_not_consume_the_throttle(tmp_path):
    sleeper = Sleeper()
    session = FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})])
    items = [
        _item("mailto:buyer@example.gov", id="a:1"),
        _item("https://example.gov/docs/b.pdf", id="a:2"),
    ]

    _run(items, tmp_path, session=session, sleeper=sleeper, min_interval_seconds=3)

    assert sleeper.slept == []


def test_non_http_urls_are_unavailable_without_a_request(tmp_path):
    session = FakeSession([])

    response = _run(
        [
            _item("mailto:buyer@example.gov", id="a:1"),
            _item("/attachments/demo.pdf", id="a:2"),
        ],
        tmp_path,
        session=session,
    )

    assert [result["archive_status"] for result in response["results"]] == ["unavailable", "unavailable"]
    assert [result["failure_kind"] for result in response["results"]] == ["unavailable", "unavailable"]
    assert session.calls == []
    assert response["stats"]["unavailable"] == 2


def test_blocked_login_url_is_unavailable_but_authority_path_is_downloaded(tmp_path):
    session = FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})])

    response = _run(
        [
            _item("https://example.gov/login/file.pdf", id="a:1"),
            _item("https://example.gov/authority/file.pdf", id="a:2"),
        ],
        tmp_path,
        session=session,
    )

    assert [result["archive_status"] for result in response["results"]] == ["unavailable", "archived"]
    assert len(session.calls) == 1


def test_extension_falls_back_to_url_then_expected_then_bin(tmp_path):
    session = FakeSession([
        FakeResponse(b"\x89PNG\r\n\x1a\n" + b"\x00" * 16, headers={"Content-Type": "image/png"}),
        FakeResponse(b"\x00\x01binary-blob", headers={"Content-Type": "application/octet-stream"}),
        FakeResponse(b"\x00\x01binary-blob", headers={"Content-Type": "application/octet-stream"}),
    ])
    items = [
        _item("https://example.gov/docs/site.png", id="a:1", expected_extension=None),
        _item("https://example.gov/docs/download?id=9", id="a:2", expected_extension=".docx"),
        _item("https://example.gov/docs/download?id=8", id="a:3", expected_extension=None),
    ]

    results = _run(items, tmp_path, session=session)["results"]

    assert results[0]["storage_path"].endswith(".png")
    assert results[1]["storage_path"].endswith(".docx")
    assert results[2]["storage_path"].endswith(".bin")


def test_unrecognized_bytes_without_a_header_type_are_unsupported(tmp_path):
    session = FakeSession([FakeResponse(b"\x00\x01\x02\x03blob", headers={})])

    result = _run([_item("https://example.gov/docs/download?id=1", expected_extension=None)], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "unsupported_type"
    assert list(tmp_path.rglob("*")) == []


def test_empty_response_is_failed_and_writes_nothing(tmp_path):
    session = FakeSession([FakeResponse(b"", headers={"Content-Type": "application/pdf"})])

    result = _run([_item("https://example.gov/docs/scope.pdf")], tmp_path, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "network"
    assert list(tmp_path.rglob("*")) == []


def test_unexpected_per_item_error_is_failed_without_stopping_the_run(tmp_path):
    session = FakeSession([
        TypeError("boom"),
        FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"}),
    ])

    response = _run(
        [
            _item("https://example.gov/docs/a.pdf", id="a:1"),
            _item("https://example.gov/docs/b.pdf", id="a:2"),
        ],
        tmp_path,
        session=session,
    )

    assert [result["archive_status"] for result in response["results"]] == ["failed", "archived"]
    assert "boom" in response["results"][0]["archive_error"]


def test_safe_segments_never_escape_the_archive_root(tmp_path):
    session = FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})])

    result = _run(
        [_item("https://example.gov/docs/a.pdf", id="../../etc/passwd", bid_id="../..")],
        tmp_path,
        session=session,
    )["results"][0]

    assert ".." not in result["storage_path"]
    assert (tmp_path / result["storage_path"]).is_file()


# --------------------------------------------------------------------------- browser mode


def test_browser_link_identifier_prefers_the_last_numeric_query_parameter():
    assert browser_link_identifier(
        "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=1807333&docId=27-444DHS-P"
    ) == "1807333"
    assert browser_link_identifier("https://example.gov/docs/scope.pdf") == "scope.pdf"
    assert browser_link_identifier("https://example.gov/") == "example.gov"


def test_build_browser_download_request_matches_the_sidecar_contract():
    request = build_browser_download_request(
        _item("https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=1807333&docId=27-444DHS-P"),
        timeout_seconds=30,
        max_bytes=52428800,
        selector=None,
    )

    assert request == {
        "page_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=27-444DHS-P",
        "link": {"href_contains": "1807333", "text": "Solicitation.pdf", "selector": None},
        "timeout_seconds": 30,
        "max_bytes": 52428800,
        "allowed_hosts": ["www.bidbuy.illinois.gov"],
    }


def test_browser_mode_archives_the_sidecar_payload(tmp_path):
    session = FakeSession(posts=[
        FakeJsonResponse(
            200,
            content=PDF_BYTES,
            headers={
                "X-Download-Filename": "Solicitation.pdf",
                "X-Download-Content-Type": "application/pdf",
                "X-Download-Final-Url": "https://www.bidbuy.illinois.gov/download/1807333",
                "X-Download-Byte-Size": str(len(PDF_BYTES)),
            },
        )
    ])
    request = _request(
        [_item("https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=1807333&docId=27-444DHS-P")],
        tmp_path,
        mode="browser",
    )
    request["browser_downloader_url"] = "http://127.0.0.1:8092"

    response = archive_attachments(request, session=session, now=lambda: "2026-09-16T03:00:00+00:00")

    result = response["results"][0]
    assert result["archive_status"] == "archived"
    assert result["method"] == "browser"
    assert result["content_type"] == "application/pdf"
    assert result["final_url"] == "https://www.bidbuy.illinois.gov/download/1807333"
    assert (tmp_path / result["storage_path"]).read_bytes() == PDF_BYTES
    assert session.post_calls[0]["url"] == "http://127.0.0.1:8092/download"
    assert session.post_calls[0]["json"]["allowed_hosts"] == ["www.bidbuy.illinois.gov"]
    assert session.post_calls[0]["json"]["link"]["href_contains"] == "1807333"
    assert session.calls == []


def test_browser_mode_passes_the_per_source_link_selector(tmp_path):
    session = FakeSession(posts=[
        FakeJsonResponse(200, content=PDF_BYTES, headers={"X-Download-Content-Type": "application/pdf"})
    ])
    request = _request(
        [_item("https://example.gov/bidDetail?downloadFileNbr=99")],
        tmp_path,
        mode="browser",
        browser_link_selector="a.download",
    )
    request["browser_downloader_url"] = "http://127.0.0.1:8092"

    archive_attachments(request, session=session)

    assert session.post_calls[0]["json"]["link"]["selector"] == "a.download"


@pytest.mark.parametrize(
    "status_code,code,expected",
    [
        (403, "LOGIN_WALL", "login_wall"),
        (404, "LINK_NOT_FOUND", "link_not_found"),
        (504, "TIMEOUT", "timeout"),
        (413, "TOO_LARGE", "too_large"),
        (403, "OFF_HOST", "off_target"),
        (502, "NAVIGATION_FAILED", "browser_error"),
        (500, "BROWSER_ERROR", "browser_error"),
        (400, "INVALID_REQUEST", "browser_error"),
    ],
)
def test_browser_error_codes_map_to_failure_kinds(tmp_path, status_code, code, expected):
    session = FakeSession(posts=[
        FakeJsonResponse(status_code, payload={"error": {"code": code, "message": "nope"}})
    ])
    request = _request([_item("https://example.gov/bidDetail?downloadFileNbr=99")], tmp_path, mode="browser")
    request["browser_downloader_url"] = "http://127.0.0.1:8092"

    result = archive_attachments(request, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == expected
    assert list(tmp_path.rglob("*")) == []


def test_browser_mode_html_payload_is_rejected_like_a_direct_download(tmp_path):
    session = FakeSession(posts=[
        FakeJsonResponse(200, content=LOGIN_HTML.encode("utf-8"), headers={"X-Download-Content-Type": "text/html"})
    ])
    request = _request([_item("https://example.gov/bidDetail?downloadFileNbr=99")], tmp_path, mode="browser")
    request["browser_downloader_url"] = "http://127.0.0.1:8092"

    result = archive_attachments(request, session=session)["results"][0]

    assert result["failure_kind"] == "login_wall"
    assert list(tmp_path.rglob("*")) == []


def test_unreachable_sidecar_is_browser_unavailable(tmp_path):
    session = FakeSession(posts=[requests.ConnectionError("Connection refused")])
    request = _request([_item("https://example.gov/bidDetail?downloadFileNbr=99")], tmp_path, mode="browser")
    request["browser_downloader_url"] = "http://127.0.0.1:8092"

    result = archive_attachments(request, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "browser_unavailable"


def test_browser_mode_without_a_downloader_url_is_browser_unavailable(tmp_path):
    session = FakeSession()
    request = _request([_item("https://example.gov/bidDetail?downloadFileNbr=99")], tmp_path, mode="browser")

    result = archive_attachments(request, session=session)["results"][0]

    assert result["archive_status"] == "failed"
    assert result["failure_kind"] == "browser_unavailable"
    assert session.post_calls == []


def test_browser_download_error_carries_a_failure_kind():
    error = BrowserDownloadError("timeout", "sidecar timed out")

    assert error.failure_kind == "timeout"
    assert "timed out" in str(error)


# --------------------------------------------------------------------------- request validation


@pytest.mark.parametrize(
    "request_payload",
    [
        [],
        {"items": []},
        {"archive_root": "", "items": []},
        {"archive_root": "/tmp/x", "items": {}},
        {"archive_root": "/tmp/x", "items": [{"url": "https://example.gov/a.pdf"}]},
        {"archive_root": "/tmp/x", "items": [], "source": {"id": "x", "mode": "ftp"}},
        {"archive_root": "/tmp/x", "items": ["not-an-object"]},
    ],
)
def test_invalid_requests_raise(request_payload):
    with pytest.raises(InvalidArchiveRequestError):
        archive_attachments(request_payload, session=FakeSession())


def test_empty_item_list_produces_an_empty_result_set(tmp_path):
    response = _run([], tmp_path)

    assert response["results"] == []
    assert response["stats"]["archived"] == 0


def test_browser_link_identifier_prefers_the_file_parameter_over_pagination_noise():
    from apsi_crawler.storage.browser_download import browser_link_identifier

    url = "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=1812427&docId=27-350SOS&currentPage=1&mode=download"
    assert browser_link_identifier(url) == "1812427"
    # Unknown parameter names: the longest numeric value wins, never `page=1`.
    assert browser_link_identifier("https://x.gov/dl?page=1&nbr=99887766") == "99887766"
    assert browser_link_identifier("https://x.gov/docs/scope.pdf?currentPage=1") == "scope.pdf"
