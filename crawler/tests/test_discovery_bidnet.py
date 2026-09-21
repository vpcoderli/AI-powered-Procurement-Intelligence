"""`apsi_crawler.discovery.bidnet` (contract C1): read-only harvest of BidNet's public directory.

Every test here runs off the three real directory pages archived on 2026-09-21 plus two small
synthetic pages for the cases those three cannot show (a last page, a WAF interstitial). No test
touches the network: the fetcher is injected, and the one test that exercises the real
`public_page.fetch_html` hands it a fake session so the browser headers can be asserted.

The harvester only ever READS. It never registers a source, never writes a base_url, and it stops
the moment the platform answers with a challenge instead of trying to get around it.
"""

import os

import pytest

from apsi_crawler.discovery.bidnet import (
    BIDNET_BASE_URL,
    DEFAULT_MAX_PAGES,
    DEFAULT_MIN_INTERVAL_SECONDS,
    directory_page_url,
    harvest_bidnet,
    has_next_control,
    looks_like_waf_challenge,
    parse_agency_links,
    parse_purchasing_groups,
    state_code_for_group,
)
from apsi_crawler.html.public_page import BROWSER_REQUEST_HEADERS, HtmlPageError


FIXTURE_DIR = os.path.join(os.path.dirname(__file__), "fixtures", "discovery")

GROUPS_URL = BIDNET_BASE_URL + "/purchasing-groups"


def _fixture(name):
    with open(os.path.join(FIXTURE_DIR, name), encoding="utf-8") as handle:
        return handle.read()


PAGE_1 = _fixture("bidnet_participating_buyers_page1.html")
PAGE_2 = _fixture("bidnet_participating_buyers_page2.html")
LAST_PAGE = _fixture("bidnet_participating_buyers_last_page.html")
GROUPS = _fixture("bidnet_purchasing_groups.html")
WAF_CHALLENGE = _fixture("bidnet_waf_challenge.html")


class FakeSleeper:
    def __init__(self):
        self.slept = []

    def __call__(self, seconds):
        self.slept.append(seconds)


class FakeResponse:
    def __init__(self, text, status_code=200):
        self.text = text
        self.status_code = status_code
        self.headers = {"Content-Type": "text/html"}
        self.history = []
        self.url = None


class FakeSession:
    """Enough of `requests.Session` for the real `public_page.fetch_html` to run against."""

    def __init__(self, responses):
        self.responses = responses
        self.calls = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append({"url": url, "params": params, "headers": headers, "timeout": timeout})
        return self.responses(url) if callable(self.responses) else self.responses[url]


class FakeFetcher:
    """Stands in for `public_page.fetch_html`: URL -> HTML, or a callable raising/returning."""

    def __init__(self, pages):
        self.pages = dict(pages)
        self.calls = []

    def __call__(self, url, session=None, timeout=None):
        self.calls.append(url)
        page = self.pages.get(url)
        if page is None:
            raise HtmlPageError("no fixture registered for " + url)
        if callable(page):
            return page()
        return page


def _pages(*directory_pages, **overrides):
    """`/purchasing-groups` plus directory pages 1..N, keyed by the URLs C1 mandates."""
    pages = {GROUPS_URL: GROUPS}
    for index, html in enumerate(directory_pages, start=1):
        pages[directory_page_url(index)] = html
    pages.update(overrides)
    return pages


def _run(*directory_pages, **kwargs):
    request = kwargs.pop("request", None) or {}
    fetcher = FakeFetcher(_pages(*directory_pages, **kwargs.pop("overrides", {})))
    sleeper = FakeSleeper()
    result = harvest_bidnet(request, session=object(), sleep=sleeper, fetch_html=fetcher)
    return result, fetcher, sleeper


# --- pure parsing off the archived pages -----------------------------------------------------


def test_page_one_yields_every_agency_card_with_a_clean_name_and_tenant_path():
    agencies = parse_agency_links(PAGE_1)

    assert len(agencies) == 48
    assert agencies[0] == {
        "name": "35th District Court",
        "tenant_path": "/mitn/35thdistrictcourt",
        "tenant_url": "https://www.bidnetdirect.com/mitn/35thdistrictcourt/solicitations/open-bids",
        "group": "mitn",
        "state_code": "MI",
    }
    assert agencies[5] == {
        "name": "Adams County",
        "tenant_path": "/colorado/adams-county",
        "tenant_url": "https://www.bidnetdirect.com/colorado/adams-county/solicitations/open-bids",
        "group": "colorado",
        "state_code": "CO",
    }
    # The accessible copy is "Organization logo of <name><name>" — none of that leaks through.
    assert not [agency for agency in agencies if "Organization logo" in agency["name"]]
    assert not [agency for agency in agencies if agency["name"] != agency["name"].strip()]


def test_agency_names_are_html_unescaped():
    names = {agency["name"] for agency in parse_agency_links(PAGE_1)}

    assert "Alabama A&M University" in names
    assert "Arapahoe County Water & Wastewater Authority" in names


def test_page_two_is_a_different_set_of_agencies():
    page_one = parse_agency_links(PAGE_1)
    page_two = parse_agency_links(PAGE_2)

    assert len(page_two) == 48
    assert not {agency["tenant_path"] for agency in page_one} & {
        agency["tenant_path"] for agency in page_two
    }
    assert page_two[0]["name"] == "Atlantic City"
    assert page_two[0]["tenant_path"] == "/new-jersey/atlanticcity"


def test_directory_navigation_and_chrome_links_are_never_agencies():
    paths = {agency["tenant_path"] for agency in parse_agency_links(PAGE_1)}

    # The footer carries a one-segment link per purchasing group, and the header carries the
    # tab/auth/resource links. A naive href sweep would register all of them as tenants.
    for chrome in ("/ohio", "/colorado", "/mitn", "/participating-buyers", "/purchasing-groups",
                   "/resources", "/buyers", "/tsandcs", "/solicitations/open-bids",
                   "/public/authentication/login", "/public/user-registration"):
        assert chrome not in paths
    assert all(agency["tenant_path"].startswith("/") for agency in parse_agency_links(PAGE_1))


def test_one_segment_tenants_and_logo_only_cards_are_still_harvested():
    agencies = parse_agency_links(LAST_PAGE)

    assert [agency["tenant_path"] for agency in agencies] == [
        "/ohio/franklincountychildrensservices",
        "/city-of-aurora",
        "/bgis/bgis",
    ]
    # No grid-name span on this card: the accessible logo copy is the only name available.
    assert agencies[1] == {
        "name": "City of Aurora",
        "tenant_path": "/city-of-aurora",
        "tenant_url": "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids",
        "group": None,
        "state_code": None,
    }
    assert agencies[2]["group"] == "bgis"
    assert agencies[2]["state_code"] is None


def test_purchasing_groups_page_yields_the_group_slugs_and_their_states():
    groups = parse_purchasing_groups(GROUPS)
    by_slug = {group["slug"]: group for group in groups}

    assert len(groups) == 49
    assert len(by_slug) == 49
    assert by_slug["ohio"] == {
        "slug": "ohio",
        "label": "Ohio Purchasing Group",
        "state_code": "OH",
    }
    # BidNet's Colorado and Michigan groups are branded, not named after the state — both slugs
    # still resolve, which is the only way their agencies reach a jurisdiction match.
    assert by_slug["colorado"]["label"] == "Rocky Mountain E-Purchasing System"
    assert by_slug["colorado"]["state_code"] == "CO"
    assert by_slug["mitn"]["label"] == "MITN Purchasing Group"
    assert by_slug["mitn"]["state_code"] == "MI"
    assert "michigan" not in by_slug and "wyoming" not in by_slug


def test_every_group_on_the_saved_directory_resolves_to_a_state():
    """The regression that would have caught `mitn` sitting unmapped.

    Every slug BidNet publishes on /purchasing-groups is a single US state, so an unmapped one
    is a bug, not a fact about the platform. `mitn` was the only unmapped slug on this page and
    went unnoticed until a live run stranded all 339 of its agencies in review.
    """
    groups = parse_purchasing_groups(GROUPS)
    unmapped = [group["slug"] for group in groups if group["state_code"] is None]

    assert len(groups) == 49
    assert unmapped == []


def test_state_slugs_resolve_for_every_state_and_dc_but_not_for_platform_groups():
    assert state_code_for_group("ohio") == "OH"
    assert state_code_for_group("new-hampshire") == "NH"
    assert state_code_for_group("district-of-columbia") == "DC"
    # `bgis` is a genuinely multi-state programme: no single state code is correct for it.
    assert state_code_for_group("bgis") is None
    assert state_code_for_group(None) is None


def test_the_mitn_group_is_michigan_despite_its_branded_slug():
    """`mitn` is Michigan, not an unresolvable platform group.

    Measured 2026-09-21: `/mitn` is titled "Michigan Bids, State Government Contracts & RFPs |
    BidNet Direct" and its body reads "Michigan Inter-governmental Trade Network (MITN)
    participating local government purchasing departments...". In a full live run its 339 listed
    agencies produced 166 exact/prefix matches against Michigan counties and places; leaving the
    slug unmapped stranded 167 county/city agencies in review — the single biggest loss of the
    run. Michigan has no `/michigan` group of its own, so `mitn` is its only route in.
    """
    assert state_code_for_group("mitn") == "MI"
    assert state_code_for_group("michigan") == "MI"
    assert state_code_for_group("MITN") == "MI"

    # The nine mitn cards on page 1 are Michigan agencies, and a `states: ["MI"]` run finds them.
    michigan = [agency for agency in parse_agency_links(PAGE_1) if agency["state_code"] == "MI"]
    assert len(michigan) == 9
    assert {agency["group"] for agency in michigan} == {"mitn"}


def test_next_control_presence_is_read_from_the_pagination_block():
    assert has_next_control(PAGE_1) is True
    assert has_next_control(PAGE_2) is True
    # The real last page empties the control the way page 1 empties "previous".
    assert has_next_control(LAST_PAGE) is False


def test_the_challenge_interstitial_is_recognised_and_real_pages_are_not():
    assert looks_like_waf_challenge(WAF_CHALLENGE) is True
    assert looks_like_waf_challenge(PAGE_1) is False
    assert looks_like_waf_challenge(GROUPS) is False


def test_the_paging_url_is_exactly_the_endpoint_the_contract_names():
    assert directory_page_url(1) == (
        "https://www.bidnetdirect.com/participating-buyers/changePage"
        "?target=paginationChange&purchasingGroupContext=true&pageNumber=1"
    )
    assert directory_page_url(7).endswith("&pageNumber=7")


# --- harvesting ------------------------------------------------------------------------------


def test_a_full_harvest_walks_the_groups_page_then_every_directory_page():
    result, fetcher, _ = _run(PAGE_1, PAGE_2, LAST_PAGE)

    assert fetcher.calls == [
        GROUPS_URL,
        directory_page_url(1),
        directory_page_url(2),
        directory_page_url(3),
    ]
    # 99 cards across the three pages, but `/bgis/bgis` is on both the real page 2 and the
    # synthetic last page: a repeat is dropped and counted, and does not stop the walk.
    assert result["stats"] == {
        "pages": 3,
        "agencies": 98,
        "stopped_reason": "exhausted",
        "duplicates": 1,
        "unresolved_state_skipped": 0,
    }
    assert len(result["agencies"]) == 98
    assert result["stats"]["agencies"] == len(result["agencies"])
    assert result["agencies"][0]["tenant_path"] == "/mitn/35thdistrictcourt"
    assert result["agencies"][-1]["tenant_path"] == "/city-of-aurora"
    assert len({agency["tenant_path"] for agency in result["agencies"]}) == 98
    # Only `/bgis/bgis` and the synthetic one-segment `/city-of-aurora` resolve to no state.
    resolvable = [agency for agency in result["agencies"] if agency["state_code"]]
    assert len(resolvable) == 96


def test_the_run_stops_when_the_platform_offers_no_next_control():
    result, fetcher, _ = _run(LAST_PAGE)

    assert result["stats"]["pages"] == 1
    assert result["stats"]["stopped_reason"] == "exhausted"
    assert fetcher.calls == [GROUPS_URL, directory_page_url(1)]


def test_a_page_that_repeats_the_previous_one_stops_the_walk_as_no_new_links():
    result, fetcher, _ = _run(PAGE_1, PAGE_1)

    assert fetcher.calls == [GROUPS_URL, directory_page_url(1), directory_page_url(2)]
    assert result["stats"] == {
        "pages": 2,
        "agencies": 48,
        "stopped_reason": "no_new_links",
        "duplicates": 48,
        "unresolved_state_skipped": 0,
    }
    assert len(result["agencies"]) == 48


def test_max_pages_caps_the_walk_and_is_reported():
    result, fetcher, _ = _run(PAGE_1, PAGE_2, LAST_PAGE, request={"max_pages": 2})

    assert fetcher.calls == [GROUPS_URL, directory_page_url(1), directory_page_url(2)]
    assert result["stats"]["pages"] == 2
    assert result["stats"]["agencies"] == 96
    assert result["stats"]["stopped_reason"] == "max_pages"


def test_a_challenge_body_stops_the_run_and_keeps_what_was_already_collected():
    result, fetcher, _ = _run(PAGE_1, WAF_CHALLENGE, PAGE_2)

    assert fetcher.calls == [GROUPS_URL, directory_page_url(1), directory_page_url(2)]
    assert result["stats"]["stopped_reason"] == "waf_challenge"
    assert result["stats"]["pages"] == 1
    assert result["stats"]["agencies"] == 48
    assert len(result["agencies"]) == 48


def test_an_http_202_stops_the_run_the_same_way():
    def challenge():
        error = HtmlPageError("HTML request failed with status 202: challenge")
        error.status_code = 202
        raise error

    result, fetcher, _ = _run(PAGE_1, request={"max_pages": 5},
                              overrides={directory_page_url(2): challenge})

    assert result["stats"]["stopped_reason"] == "waf_challenge"
    assert result["stats"]["pages"] == 1
    assert len(result["agencies"]) == 48
    assert fetcher.calls[-1] == directory_page_url(2)


def test_a_challenge_on_the_groups_page_stops_before_any_directory_request():
    result, fetcher, _ = _run(PAGE_1, overrides={GROUPS_URL: WAF_CHALLENGE})

    assert fetcher.calls == [GROUPS_URL]
    assert result == {
        "agencies": [],
        "stats": {
            "pages": 0,
            "agencies": 0,
            "stopped_reason": "waf_challenge",
            "duplicates": 0,
            "unresolved_state_skipped": 0,
        },
    }


def test_a_plain_failure_on_the_groups_page_does_not_abort_the_harvest():
    def boom():
        error = HtmlPageError("HTML request failed with status 503: nope")
        error.status_code = 503
        raise error

    result, fetcher, _ = _run(PAGE_1, LAST_PAGE, overrides={GROUPS_URL: boom})

    assert result["stats"]["stopped_reason"] == "exhausted"
    assert result["stats"]["agencies"] == 51
    assert fetcher.calls == [GROUPS_URL, directory_page_url(1), directory_page_url(2)]


def test_a_failing_directory_page_ends_the_walk_without_losing_earlier_pages():
    def boom():
        raise HtmlPageError("HTML request failed with status 500: nope")

    result, _, _ = _run(PAGE_1, request={"max_pages": 5},
                        overrides={directory_page_url(2): boom})

    assert result["stats"]["pages"] == 1
    assert result["stats"]["agencies"] == 48
    assert result["stats"]["stopped_reason"] == "fetch_failed"


def test_a_programming_error_is_not_disguised_as_a_polite_stop():
    def bug():
        raise ZeroDivisionError("this is a bug, not a portal problem")

    with pytest.raises(ZeroDivisionError):
        _run(PAGE_1, request={"max_pages": 5}, overrides={directory_page_url(2): bug})


def test_the_fetched_group_list_keeps_group_landing_pages_out_of_the_agency_set():
    # `/bgis` is a purchasing group, not a tenant, and it is not in the built-in state table —
    # only the list read from /purchasing-groups can rule it out.
    html = """
    <div class="participatingAgencyGrid">
      <a href="/bgis" class="mets-command-link">
        <div class="organizationLogo"><span class="accessibility-hidden">Organization logo of BGIS</span></div>
      </a>
      <a href="/kansas/bartoncounty" class="mets-command-link">
        <div class="organizationLogo"><span class="accessibility-hidden">Organization logo of Barton County</span></div>
      </a>
    </div>
    """

    assert [agency["tenant_path"] for agency in parse_agency_links(html)] == [
        "/bgis",
        "/kansas/bartoncounty",
    ]
    assert [
        agency["tenant_path"] for agency in parse_agency_links(html, known_groups={"bgis"})
    ] == ["/kansas/bartoncounty"]


# --- politeness ------------------------------------------------------------------------------


def test_every_request_after_the_first_is_spaced_by_the_configured_interval():
    _, fetcher, sleeper = _run(PAGE_1, PAGE_2, LAST_PAGE, request={"min_interval_seconds": 5})

    assert len(fetcher.calls) == 4
    assert sleeper.slept == [5, 5, 5]


def test_the_default_interval_is_the_three_seconds_bidnet_needs():
    _, _, sleeper = _run(PAGE_1, LAST_PAGE)

    assert DEFAULT_MIN_INTERVAL_SECONDS == 3.0
    assert DEFAULT_MAX_PAGES == 400
    assert sleeper.slept == [3.0, 3.0]


def test_requests_carry_the_crawlers_browser_headers_and_no_query_of_their_own():
    session = FakeSession(lambda url: FakeResponse(GROUPS if url == GROUPS_URL else LAST_PAGE))

    result = harvest_bidnet(
        {"timeout_seconds": 11}, session=session, sleep=FakeSleeper(), fetch_html=None
    )

    assert result["stats"]["agencies"] == 3
    assert [call["url"] for call in session.calls] == [GROUPS_URL, directory_page_url(1)]
    for call in session.calls:
        assert call["headers"] == BROWSER_REQUEST_HEADERS
        assert call["params"] is None
        assert call["timeout"] == 11


def test_a_real_202_through_the_crawlers_own_fetcher_is_classified_as_a_challenge():
    # The production path: `fetch_html` turns a 202 into `HtmlPageError.status_code`, and the
    # harvester has to recognise it there rather than only in the body.
    def respond(url):
        if url == GROUPS_URL:
            return FakeResponse(GROUPS)
        if url == directory_page_url(1):
            return FakeResponse(PAGE_1)
        return FakeResponse("<html><body>challenge</body></html>", status_code=202)

    session = FakeSession(respond)

    result = harvest_bidnet(
        {"max_pages": 9}, session=session, sleep=FakeSleeper(), fetch_html=None
    )

    assert result["stats"]["stopped_reason"] == "waf_challenge"
    assert result["stats"]["pages"] == 1
    assert result["stats"]["agencies"] == 48
    # Stopped at the challenge instead of retrying or working around it.
    assert [call["url"] for call in session.calls] == [
        GROUPS_URL,
        directory_page_url(1),
        directory_page_url(2),
    ]


# --- state filter ----------------------------------------------------------------------------


def test_states_filters_by_resolved_state_code_and_excludes_unresolved_groups():
    result, _, _ = _run(PAGE_1, PAGE_2, request={"states": ["co"]})

    # Asking for Colorado returns Colorado — not every mitn/bgis agency as well.
    assert {agency["group"] for agency in result["agencies"]} == {"colorado"}
    assert len(result["agencies"]) == 27
    assert not [agency for agency in result["agencies"] if agency["state_code"] != "CO"]
    # `stats.agencies` always describes the list handed over, so a consumer that classifies it
    # can keep its own per-level counts summing to this number.
    assert result["stats"]["agencies"] == 27
    assert result["stats"]["pages"] == 2
    # The one bgis card is excluded, but counted rather than silently dropped.
    assert result["stats"]["unresolved_state_skipped"] == 1


def test_states_accepts_several_codes_and_no_states_means_everything():
    filtered, _, _ = _run(PAGE_1, PAGE_2, request={"states": ["KS", "TN"]})
    everything, _, _ = _run(PAGE_1, PAGE_2, request={"states": None})

    # Tennessee has two agencies on page 1, Kansas one on page 2 — both codes are honoured.
    assert {agency["group"] for agency in filtered["agencies"]} == {"tennessee", "kansas"}
    assert filtered["stats"]["agencies"] == 3
    assert filtered["stats"]["unresolved_state_skipped"] == 1

    assert len(everything["agencies"]) == 96
    assert everything["stats"]["unresolved_state_skipped"] == 0


def test_a_states_run_reaches_the_michigan_agencies_hiding_behind_the_mitn_slug():
    result, _, _ = _run(PAGE_1, request={"states": ["MI"]})

    assert len(result["agencies"]) == 9
    assert {agency["group"] for agency in result["agencies"]} == {"mitn"}
    assert result["stats"]["unresolved_state_skipped"] == 0


def test_an_unfiltered_run_still_returns_the_agencies_no_state_could_be_resolved_for():
    result, _, _ = _run(LAST_PAGE)

    unresolved = [agency for agency in result["agencies"] if agency["state_code"] is None]
    assert [agency["tenant_path"] for agency in unresolved] == ["/city-of-aurora", "/bgis/bgis"]
    assert result["stats"]["unresolved_state_skipped"] == 0


@pytest.mark.parametrize("states", [[], None, ()])
def test_an_empty_state_list_is_not_a_filter(states):
    result, _, _ = _run(PAGE_1, request={"states": states})

    assert len(result["agencies"]) == 48
    assert result["stats"]["unresolved_state_skipped"] == 0


# --- request hygiene -------------------------------------------------------------------------


def test_a_missing_or_junk_request_falls_back_to_the_documented_defaults():
    for request in (None, {}, {"max_pages": None, "min_interval_seconds": None}):
        result, _, sleeper = _run(LAST_PAGE, request=request)

        assert result["stats"]["stopped_reason"] == "exhausted"
        assert sleeper.slept == [DEFAULT_MIN_INTERVAL_SECONDS]


def test_max_pages_is_clamped_to_at_least_one_page():
    result, fetcher, _ = _run(PAGE_1, request={"max_pages": 0})

    assert result["stats"]["pages"] == 1
    assert result["stats"]["stopped_reason"] == "max_pages"
    assert fetcher.calls == [GROUPS_URL, directory_page_url(1)]
