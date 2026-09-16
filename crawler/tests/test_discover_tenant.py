"""`python -m apsi_crawler.cli discover-tenant` (contract C4): read-only tenant-path probing.

The subcommand only ever SUGGESTS a base_url — an admin writes it back. It is deliberately
stingy with requests (max_requests, spaced by min_interval_seconds) and aborts the moment the
platform answers with a WAF challenge.
"""

import io
import json

import pytest

from apsi_crawler import cli
from apsi_crawler.tenant_discovery import (
    InvalidDiscoveryRequestError,
    build_candidate_urls,
    discover_tenant,
)


FRANKLIN = "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids"

ROW_HTML = """
<html><head><title>Franklin County - Bid Opportunities | BidNet Direct</title></head><body>
<table><tr class="mets-table-row"><td><a href="/private/supplier/solicitations/4599999/detail">Culvert repair</a></td></tr></table>
</body></html>
"""

EMPTY_HTML = """
<html><head><title>Franklin County - Bid Opportunities | BidNet Direct</title></head>
<body><p>There are no open bids at this time.</p></body></html>
"""

NOT_FOUND_HTML = "<html><head><title>Page not found | BidNet Direct</title></head><body>Not found</body></html>"


class FakeResponse:
    def __init__(self, status_code=200, text=NOT_FOUND_HTML):
        self.status_code = status_code
        self.text = text
        self.headers = {"Content-Type": "text/html"}
        self.url = None
        self.history = []


class FakeSession:
    def __init__(self, responses=None, default=None):
        self.responses = dict(responses or {})
        self.default = default or FakeResponse(status_code=404)
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append(url)
        return self.responses.get(url, self.default)

    def close(self):
        self.closed = True


class FakeSleeper:
    def __init__(self):
        self.slept = []

    def __call__(self, seconds):
        self.slept.append(seconds)


def _request(**overrides):
    payload = {
        "base_url": FRANKLIN,
        "label": "Franklin County, OH (BidNet)",
        "state_code": "OH",
        "provider_family": "bidnet",
        "max_requests": 6,
        "min_interval_seconds": 3,
    }
    payload.update(overrides)
    return payload


def test_candidate_generation_follows_the_contract_order_and_budget():
    candidates = build_candidate_urls(
        FRANKLIN, "Franklin County, OH (BidNet)", "OH", "bidnet", max_requests=6
    )

    assert candidates == [
        "https://www.bidnetdirect.com/ohio/franklin-county-oh/solicitations/open-bids",
        "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids",
        "https://www.bidnetdirect.com/ohio/franklin-county-ohio/solicitations/open-bids",
        "https://www.bidnetdirect.com/franklin-county-oh/solicitations/open-bids",
        "https://www.bidnetdirect.com/franklin-county/solicitations/open-bids",
        "https://www.bidnetdirect.com/franklin-county-ohio/solicitations/open-bids",
    ]


def test_candidate_generation_keeps_the_current_url_and_respects_a_small_budget():
    candidates = build_candidate_urls(
        "https://www.bidnetdirect.com/new-york/erie-county/solicitations/open-bids?selectedContent=BUYER",
        "Erie County, NY (BidNet)",
        "NY",
        "bidnet",
        max_requests=2,
    )

    assert len(candidates) == 2
    assert candidates[0].endswith("/new-york/erie-county/solicitations/open-bids?selectedContent=BUYER")


def test_stops_at_the_first_candidate_that_matches_the_label_and_has_rows():
    hit = "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids"
    session = FakeSession(responses={hit: FakeResponse(text=ROW_HTML)})
    sleeper = FakeSleeper()

    result = discover_tenant(_request(), session=session, sleep=sleeper)

    assert result["suggested_base_url"] == hit
    assert result["reason"] == "confirmed"
    assert len(session.calls) == 2
    assert [candidate["url"] for candidate in result["candidates"]] == session.calls
    assert result["candidates"][0] == {
        "url": "https://www.bidnetdirect.com/ohio/franklin-county-oh/solicitations/open-bids",
        "status": 404,
        "title": "Page not found | BidNet Direct",
        "label_match": False,
        "rows": 0,
        "empty_state": False,
    }
    assert result["candidates"][1]["rows"] == 1
    assert result["candidates"][1]["label_match"] is True
    # One inter-request pause, never before the first request.
    assert sleeper.slept == [3]


def test_a_verified_empty_tenant_page_also_confirms_the_path():
    hit = "https://www.bidnetdirect.com/ohio/franklin-county-oh/solicitations/open-bids"
    session = FakeSession(responses={hit: FakeResponse(text=EMPTY_HTML)})

    result = discover_tenant(_request(), session=session, sleep=FakeSleeper())

    assert result["suggested_base_url"] == hit
    assert result["candidates"][0]["empty_state"] is True
    assert len(session.calls) == 1


def test_no_candidate_matches_leaves_the_suggestion_empty():
    session = FakeSession()

    result = discover_tenant(_request(max_requests=3), session=session, sleep=FakeSleeper())

    assert result["suggested_base_url"] is None
    assert result["reason"] == "no_candidate_matched"
    assert len(session.calls) == 3


def test_a_waf_challenge_aborts_the_probe_immediately():
    blocked = "https://www.bidnetdirect.com/ohio/franklin-county-oh/solicitations/open-bids"
    session = FakeSession(responses={blocked: FakeResponse(status_code=202, text="challenge")})

    result = discover_tenant(_request(), session=session, sleep=FakeSleeper())

    assert result["reason"] == "waf_challenge"
    assert result["suggested_base_url"] is None
    assert len(session.calls) == 1
    assert result["candidates"][0]["status"] == 202


def test_requests_are_spaced_by_the_configured_interval():
    sleeper = FakeSleeper()
    discover_tenant(_request(max_requests=4, min_interval_seconds=5), session=FakeSession(), sleep=sleeper)

    assert sleeper.slept == [5, 5, 5]


def test_an_unsupported_provider_family_reports_why_without_any_request():
    session = FakeSession()

    result = discover_tenant(_request(provider_family="bonfire"), session=session, sleep=FakeSleeper())

    assert result == {"candidates": [], "suggested_base_url": None, "reason": "unsupported_provider_family"}
    assert session.calls == []


@pytest.mark.parametrize("payload", [{}, {"base_url": ""}, {"base_url": "not-a-url"}, {"base_url": FRANKLIN, "label": ""}])
def test_invalid_requests_are_rejected(payload):
    with pytest.raises(InvalidDiscoveryRequestError):
        discover_tenant(payload, session=FakeSession(), sleep=FakeSleeper())


# --- CLI wiring ---------------------------------------------------------------------------


def _run_cli(stdin_text, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin_text))
    exit_code = cli.main(["discover-tenant"])
    return exit_code, json.loads(capsys.readouterr().out)


def test_cli_round_trips_stdin_json_to_stdout_json(monkeypatch, capsys):
    hit = "https://www.bidnetdirect.com/ohio/franklin-county/solicitations/open-bids"
    session = FakeSession(responses={hit: FakeResponse(text=ROW_HTML)})
    monkeypatch.setattr("apsi_crawler.tenant_discovery.requests.Session", lambda: session)
    monkeypatch.setattr("apsi_crawler.tenant_discovery.time.sleep", lambda seconds: None)

    exit_code, response = _run_cli(json.dumps(_request()), monkeypatch, capsys)

    assert exit_code == 0
    assert response["suggested_base_url"] == hit
    assert response["reason"] == "confirmed"


def test_cli_exits_2_on_invalid_json(monkeypatch, capsys):
    exit_code, response = _run_cli("{not json", monkeypatch, capsys)

    assert exit_code == 2
    assert response["error"]["code"] == "INVALID_REQUEST"


def test_cli_exits_2_on_an_unusable_request(monkeypatch, capsys):
    exit_code, response = _run_cli(json.dumps({"label": "Franklin County, OH (BidNet)"}), monkeypatch, capsys)

    assert exit_code == 2
    assert response["error"]["code"] == "INVALID_REQUEST"


def test_discover_tenant_is_registered_in_the_cli_parser():
    parser = cli.build_parser()
    assert "discover-tenant" in parser._subparsers._group_actions[0].choices
