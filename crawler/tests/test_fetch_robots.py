import io
import json

from apsi_crawler import cli
from apsi_crawler.robots_fetch import fetch_robots, robots_url_for


class FakeResponse:
    def __init__(self, status_code, text, url=None, content_type="text/plain"):
        self.status_code = status_code
        self.text = text
        self.url = url
        self.headers = {"Content-Type": content_type}


class FakeSession:
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, headers=None, timeout=None, allow_redirects=True):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        return self.response

    def close(self):
        pass


def test_robots_url_is_derived_from_the_origin_only():
    assert robots_url_for("https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids") == "https://www.bidnetdirect.com/robots.txt"


def test_fetch_robots_uses_the_crawler_browser_headers_and_caps_the_body():
    session = FakeSession(FakeResponse(200, "User-agent: *\nDisallow: /private/\n" + "x" * 70000))
    result = fetch_robots({"base_url": "https://www.bidnetdirect.com/x/y"}, session=session)
    assert session.calls[0]["url"] == "https://www.bidnetdirect.com/robots.txt"
    assert session.calls[0]["headers"]["User-Agent"].startswith("Mozilla/5.0")
    assert result["status"] == 200 and result["truncated"] is True and len(result["body"]) == 64 * 1024


def test_fetch_robots_command_emits_one_json_document_and_rejects_bad_input():
    out = io.StringIO()
    import contextlib
    with contextlib.redirect_stdout(out):
        code = cli.fetch_robots_command(io.StringIO('{"base_url": "ftp://nope"}'))
    assert code == 2
    assert json.loads(out.getvalue())["error"]["code"] == "INVALID_REQUEST"
