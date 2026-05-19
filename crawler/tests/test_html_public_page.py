import requests
import pytest

from apsi_crawler.html.public_page import (
    HtmlPageError,
    absolute_url,
    extract_table_rows,
    fetch_html,
    normalize_space,
    read_html_fixture,
)


class FakeResponse:
    def __init__(self, status_code=200, text="", headers=None):
        self.status_code = status_code
        self.text = text
        self.headers = headers or {"Content-Type": "text/html; charset=utf-8"}


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []
        self.closed = False

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(
            {"url": url, "params": params, "headers": headers, "timeout": timeout}
        )
        if isinstance(self.response, Exception):
            raise self.response
        return self.response

    def close(self):
        self.closed = True


def test_read_html_fixture_returns_text(tmp_path):
    fixture = tmp_path / "page.html"
    fixture.write_text("<html><body>BidBuy</body></html>", encoding="utf-8")

    assert read_html_fixture(str(fixture)) == "<html><body>BidBuy</body></html>"


def test_normalize_space_collapses_whitespace_and_nbsp():
    assert normalize_space("  Bid\u00a0 Solicitation \n #  ") == "Bid Solicitation #"


def test_absolute_url_resolves_relative_links():
    assert absolute_url("https://www.bidbuy.illinois.gov/bso/search", "../detail/123") == (
        "https://www.bidbuy.illinois.gov/detail/123"
    )


def test_fetch_html_uses_session_and_returns_html_text():
    session = FakeSession(FakeResponse(text="<html>Open Bids</html>"))

    html = fetch_html(
        "https://www.bidbuy.illinois.gov/bso/",
        session=session,
        timeout=12,
        params={"openBids": "true"},
    )

    assert html == "<html>Open Bids</html>"
    assert session.calls == [
        {
            "url": "https://www.bidbuy.illinois.gov/bso/",
            "params": {"openBids": "true"},
            "headers": {"Accept": "text/html,application/xhtml+xml"},
            "timeout": 12,
        }
    ]
    assert session.closed is False


def test_fetch_html_closes_owned_session(monkeypatch):
    session = FakeSession(FakeResponse(text="<html>Open Bids</html>"))
    monkeypatch.setattr("apsi_crawler.html.public_page.requests.Session", lambda: session)

    assert fetch_html("https://www.bidbuy.illinois.gov/bso/") == "<html>Open Bids</html>"
    assert session.closed is True


def test_fetch_html_raises_on_request_error():
    session = FakeSession(requests.Timeout("slow"))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML request failed: slow"


def test_fetch_html_raises_on_http_error():
    session = FakeSession(FakeResponse(status_code=503, text="maintenance"))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML request failed with status 503: maintenance"


def test_fetch_html_raises_on_non_html_response():
    session = FakeSession(
        FakeResponse(text='{"error":true}', headers={"Content-Type": "application/json"})
    )

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML response content type was not HTML: application/json"


def test_fetch_html_raises_on_empty_html():
    session = FakeSession(FakeResponse(text="   "))

    with pytest.raises(HtmlPageError) as error:
        fetch_html("https://www.bidbuy.illinois.gov/bso/", session=session)

    assert str(error.value) == "HTML response was empty"


def test_extract_table_rows_returns_text_and_cell_links():
    html = """
    <table>
      <thead>
        <tr>
          <th>Bid Solicitation #</th>
          <th>Description</th>
          <th>Organization Name</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><a href="/bso/detail.xhtml?bidId=IL-2026-001">IL-2026-001</a></td>
          <td>Cloud migration</td>
          <td>Illinois Department of Innovation</td>
        </tr>
      </tbody>
    </table>
    """

    rows = extract_table_rows(
        html,
        required_headers=("Bid Solicitation #", "Description", "Organization Name"),
    )

    assert rows == [
        {
            "Bid Solicitation #": "IL-2026-001",
            "Description": "Cloud migration",
            "Organization Name": "Illinois Department of Innovation",
            "_links": {"Bid Solicitation #": "/bso/detail.xhtml?bidId=IL-2026-001"},
        }
    ]


def test_extract_table_rows_fills_missing_cell_values_with_empty_string():
    html = """
    <table>
      <thead>
        <tr>
          <th>Bid Solicitation #</th>
          <th>Description</th>
          <th>Organization Name</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><a href="/bso/detail.xhtml?bidId=IL-2026-002">IL-2026-002</a></td>
          <td>Network modernization</td>
        </tr>
      </tbody>
    </table>
    """

    rows = extract_table_rows(
        html,
        required_headers=("Bid Solicitation #", "Description", "Organization Name"),
    )

    assert rows == [
        {
            "Bid Solicitation #": "IL-2026-002",
            "Description": "Network modernization",
            "Organization Name": "",
            "_links": {"Bid Solicitation #": "/bso/detail.xhtml?bidId=IL-2026-002"},
        }
    ]


def test_extract_table_rows_raises_when_required_headers_are_missing():
    html = """
    <table>
      <tr><th>Description</th></tr>
      <tr><td>Cloud migration</td></tr>
    </table>
    """

    with pytest.raises(HtmlPageError) as error:
        extract_table_rows(html, required_headers=("Bid Solicitation #", "Description"))

    assert str(error.value) == "HTML table was missing required headers: Bid Solicitation #"
