"""Request validation, host allow-listing, size guards and the copied login-wall rule.

Runs without Playwright or a browser.
"""

import pytest

from guards import (
    DEFAULT_MAX_BYTES,
    DEFAULT_TIMEOUT_SECONDS,
    ERROR_STATUS,
    DownloadError,
    error_envelope,
    filename_from_content_disposition,
    header_safe,
    is_host_allowed,
    is_login_html,
    parse_download_request,
    read_capped,
    sniff_content_type,
)


def valid_payload(**overrides):
    payload = {
        "page_url": "https://www.bidbuy.illinois.gov/bidDetail.sdo?docId=27-444",
        "link": {"href_contains": "1807333", "text": "Solicitation.pdf", "selector": None},
        "timeout_seconds": 30,
        "max_bytes": 1048576,
        "allowed_hosts": ["www.bidbuy.illinois.gov"],
    }
    payload.update(overrides)
    return payload


class TestParseDownloadRequest:
    def test_accepts_a_full_c2_payload(self):
        request = parse_download_request(valid_payload())
        assert request.page_url == "https://www.bidbuy.illinois.gov/bidDetail.sdo?docId=27-444"
        assert request.link.href_contains == "1807333"
        assert request.link.text == "Solicitation.pdf"
        assert request.link.selector is None
        assert request.timeout_seconds == 30
        assert request.max_bytes == 1048576
        assert request.allowed_hosts == ("www.bidbuy.illinois.gov",)

    def test_applies_defaults_for_optional_fields(self):
        request = parse_download_request(
            {"page_url": "https://portal.example.gov/detail", "link": {"text": "Doc.pdf"}}
        )
        assert request.timeout_seconds == DEFAULT_TIMEOUT_SECONDS
        assert request.max_bytes == DEFAULT_MAX_BYTES
        # The page we are told to open is always reachable; extra hosts are opt-in.
        assert request.allowed_hosts == ("portal.example.gov",)

    def test_page_host_is_added_to_allowed_hosts(self):
        request = parse_download_request(valid_payload(allowed_hosts=["cdn.example.gov"]))
        assert set(request.allowed_hosts) == {"cdn.example.gov", "www.bidbuy.illinois.gov"}

    def test_rejects_a_non_object_body(self):
        with pytest.raises(DownloadError) as error:
            parse_download_request(["not", "an", "object"])
        assert error.value.code == "INVALID_REQUEST"

    @pytest.mark.parametrize(
        "page_url",
        ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.gov/a.pdf", "not a url", "", None],
    )
    def test_rejects_non_http_page_urls(self, page_url):
        with pytest.raises(DownloadError) as error:
            parse_download_request(valid_payload(page_url=page_url))
        assert error.value.code == "INVALID_REQUEST"
        assert error.value.status == 400

    def test_rejects_a_page_url_without_a_host(self):
        with pytest.raises(DownloadError):
            parse_download_request(valid_payload(page_url="https:///detail"))

    @pytest.mark.parametrize(
        "link",
        [None, {}, "Solicitation.pdf", {"href_contains": "", "text": "  ", "selector": None}, {"other": "x"}],
    )
    def test_rejects_an_empty_or_malformed_link_spec(self, link):
        with pytest.raises(DownloadError) as error:
            parse_download_request(valid_payload(link=link))
        assert error.value.code == "INVALID_REQUEST"

    @pytest.mark.parametrize("timeout", [0, -1, "30", 100000, None])
    def test_rejects_out_of_range_timeouts(self, timeout):
        with pytest.raises(DownloadError):
            parse_download_request(valid_payload(timeout_seconds=timeout))

    @pytest.mark.parametrize("max_bytes", [0, -5, "1048576", 1.5])
    def test_rejects_invalid_max_bytes(self, max_bytes):
        with pytest.raises(DownloadError):
            parse_download_request(valid_payload(max_bytes=max_bytes))

    def test_clamps_max_bytes_to_the_service_cap(self):
        request = parse_download_request(valid_payload(max_bytes=DEFAULT_MAX_BYTES * 10))
        assert request.max_bytes == DEFAULT_MAX_BYTES

    @pytest.mark.parametrize("hosts", ["example.gov", [123], [""], [None]])
    def test_rejects_malformed_allowed_hosts(self, hosts):
        with pytest.raises(DownloadError):
            parse_download_request(valid_payload(allowed_hosts=hosts))

    def test_never_accepts_credentials_in_the_payload(self):
        """The sidecar must have no way to be told to log in (C2 hard rule)."""
        request = parse_download_request(valid_payload(username="u", password="p", fill={"#user": "u"}))
        assert not hasattr(request, "username")
        assert not hasattr(request, "password")
        assert not hasattr(request, "fill")


class TestHostAllowList:
    def test_allows_an_exact_host_match(self):
        assert is_host_allowed("https://www.example.gov/a.pdf", ("www.example.gov",))

    def test_ignores_case_and_port(self):
        assert is_host_allowed("https://WWW.Example.GOV:8443/a.pdf", ("www.example.gov",))

    def test_rejects_a_different_host(self):
        assert not is_host_allowed("https://cdn.example.com/a.pdf", ("www.example.gov",))

    def test_rejects_a_subdomain_that_was_not_listed(self):
        assert not is_host_allowed("https://files.example.gov/a.pdf", ("example.gov",))

    def test_rejects_a_hostless_or_unparseable_url(self):
        assert not is_host_allowed("about:blank", ("www.example.gov",))
        assert not is_host_allowed("", ("www.example.gov",))

    def test_rejects_everything_when_the_list_is_empty(self):
        assert not is_host_allowed("https://www.example.gov/a.pdf", ())

    def test_treats_localhost_and_loopback_ip_as_different_hosts(self):
        # The integration test relies on this to build an off-host navigation locally.
        assert not is_host_allowed("http://localhost:9/a.pdf", ("127.0.0.1",))


class TestSizeGuard:
    def test_read_capped_returns_bytes_under_the_cap(self, tmp_path):
        path = tmp_path / "doc.pdf"
        path.write_bytes(b"%PDF-1.4 tiny")
        assert read_capped(str(path), 1024) == b"%PDF-1.4 tiny"

    def test_read_capped_accepts_a_file_exactly_at_the_cap(self, tmp_path):
        path = tmp_path / "doc.pdf"
        path.write_bytes(b"x" * 64)
        assert len(read_capped(str(path), 64)) == 64

    def test_read_capped_refuses_a_file_above_the_cap(self, tmp_path):
        path = tmp_path / "big.pdf"
        path.write_bytes(b"x" * 1025)
        with pytest.raises(DownloadError) as error:
            read_capped(str(path), 1024)
        assert error.value.code == "TOO_LARGE"
        assert error.value.status == 413

    def test_read_capped_stops_reading_at_the_cap(self, tmp_path):
        """A 50 MB cap must not pull an arbitrarily large file into memory first."""
        path = tmp_path / "huge.bin"
        path.write_bytes(b"x" * (5 * 1024 * 1024))
        with pytest.raises(DownloadError):
            read_capped(str(path), 1024, chunk_size=256)


class TestErrorEnvelope:
    def test_every_c2_code_has_a_status(self):
        assert ERROR_STATUS == {
            "INVALID_REQUEST": 400,
            "LOGIN_WALL": 403,
            "OFF_HOST": 403,
            "LINK_NOT_FOUND": 404,
            "TOO_LARGE": 413,
            "NAVIGATION_FAILED": 502,
            "BROWSER_ERROR": 500,
            "TIMEOUT": 504,
        }

    def test_envelope_shape(self):
        assert error_envelope("LOGIN_WALL", "login required") == {
            "error": {"code": "LOGIN_WALL", "message": "login required"}
        }

    def test_unknown_codes_fall_back_to_browser_error_status(self):
        assert DownloadError("SOMETHING_ELSE", "x").status == 500


class TestHeaderHelpers:
    def test_filename_from_content_disposition(self):
        assert filename_from_content_disposition('attachment; filename="Solicitation.pdf"') == "Solicitation.pdf"
        assert filename_from_content_disposition("attachment; filename=Solicitation.pdf") == "Solicitation.pdf"
        assert filename_from_content_disposition("attachment; filename*=UTF-8''Sol%20A.pdf") == "Sol A.pdf"
        assert filename_from_content_disposition("inline") is None
        assert filename_from_content_disposition(None) is None

    def test_filename_strips_path_separators(self):
        assert filename_from_content_disposition('attachment; filename="../../etc/passwd"') == "passwd"

    def test_header_safe_strips_non_ascii_and_newlines(self):
        safe = header_safe("招标文件.pdf")
        assert safe.endswith(".pdf")
        assert safe.isascii()
        assert header_safe("a\r\nb.pdf") == "ab.pdf"
        assert header_safe(None) == ""


class TestSniffContentType:
    @pytest.mark.parametrize(
        "data,expected",
        [
            (b"%PDF-1.4\n", "application/pdf"),
            (b"PK\x03\x04rest", "application/zip"),
            (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "application/x-ole-storage"),
            (b"random bytes", "application/octet-stream"),
            (b"", "application/octet-stream"),
        ],
    )
    def test_magic_bytes(self, data, expected):
        assert sniff_content_type(data) == expected


class TestLoginWallRule:
    """Parity with crawler/apsi_crawler/content_quality.is_login_html (rule copied, not imported)."""

    def test_detects_a_login_page(self):
        html = """
        <html><head><title>Sign In</title></head>
        <body><h1>Sign In</h1>
        <form action="/login"><input type="email" name="u"><input type="password" name="p">
        <button>Log in</button></form></body></html>
        """
        assert is_login_html(html) is True

    def test_detects_a_login_form_action_without_a_login_heading(self):
        html = """
        <html><head><title>Portal</title></head><body>
        <form action="/auth/signin"><input type="password" name="p"></form>
        </body></html>
        """
        assert is_login_html(html) is True

    def test_public_detail_page_with_a_site_wide_login_widget_is_not_a_login_wall(self):
        html = """
        <html><head><title>Solicitation 27-444</title></head><body>
        <header><form action="/login"><input type="password" name="p"></form></header>
        <h1>Solicitation 27-444</h1>
        <table><tr><td>Description</td><td>Janitorial services for the Springfield district office.</td></tr></table>
        <a href="/download?fileNbr=1807333">Solicitation.pdf</a>
        </body></html>
        """
        assert is_login_html(html) is False

    def test_page_without_credential_inputs_is_never_a_login_wall(self):
        html = "<html><body><h1>Log in to comment</h1><p>No inputs here.</p></body></html>"
        assert is_login_html(html) is False

    def test_empty_html_is_not_a_login_wall(self):
        assert is_login_html("") is False
