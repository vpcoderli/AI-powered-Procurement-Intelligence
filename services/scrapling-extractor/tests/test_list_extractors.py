"""List-page extraction (contract C2) against real and synthetic portal list markup.

`tests/fixtures/list/*.html` are copies of the crawler's own list fixtures, so a heuristic
regression shows up here rather than in the crawler's adapter tests.
"""

import pathlib

import pytest

pytest.importorskip("scrapling")

from extractors import ExtractError  # noqa: E402
from list_extractors import LIST_FIELDS, detect_empty_state, extract_list  # noqa: E402

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
LIST_FIXTURES = FIXTURES / "list"
LIVE = FIXTURES / "live"

IL_URL = "https://www.bidbuy.illinois.gov/bso/external/publicBids.sdo"
CO_URL = "https://www.bidnetdirect.com/colorado/solicitations/open-bids"
ERIE_URL = "https://www.bidnetdirect.com/erie-county-ny/solicitations/open-bids"
CARDS_URL = "https://procurement.example.gov/solicitations"


def read(name, directory=LIST_FIXTURES):
    return (directory / name).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def storage_dir(tmp_path_factory):
    return str(tmp_path_factory.mktemp("list-storage"))


class TestIlBidBuyTable:
    @pytest.fixture(scope="class")
    def result(self, storage_dir):
        return extract_list(read("il_bidbuy_open_bids.html"), IL_URL, storage_dir=storage_dir)

    def test_returns_one_row_with_an_absolute_detail_url(self, result):
        assert len(result["items"]) == 1
        item = result["items"][0]
        assert item["url"] == "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001"

    def test_title_prefers_the_description_column_over_the_id_link(self, result):
        assert result["items"][0]["title"] == "Enterprise data integration services"

    def test_source_bid_id_comes_from_the_id_query_parameter(self, result):
        assert result["items"][0]["source_bid_id"] == "IL-BIDBUY-2026-001"

    def test_header_columns_supply_issuer_and_deadline(self, result):
        item = result["items"][0]
        assert item["issuer_name"] == "Illinois Department of Innovation and Technology"
        assert item["deadline_date"] == "06/30/2026 02:00 PM"

    def test_the_header_row_is_not_returned_as_an_item(self, result):
        assert all(item["url"] for item in result["items"])

    def test_diagnostics_report_the_heuristic_and_the_missing_field(self, result):
        assert result["diagnostics"]["title"] == "heuristic"
        assert result["diagnostics"]["url"] == "heuristic"
        assert result["diagnostics"]["published_date"] == "not_found"

    def test_item_selector_used_names_the_chosen_row_group(self, result):
        assert result["item_selector_used"] == "tbody > tr"

    def test_no_empty_state_on_a_page_with_rows(self, result):
        assert result["empty_state"] == {"detected": False, "marker": None}


class TestCoBidnetTableRows:
    @pytest.fixture(scope="class")
    def result(self, storage_dir):
        return extract_list(read("co_bidnet_open_bids.html"), CO_URL, storage_dir=storage_dir)

    def test_returns_the_mets_table_row(self, result):
        assert result["item_selector_used"] == "tr.mets-table-row"
        assert len(result["items"]) == 1

    def test_title_and_absolute_detail_url(self, result):
        item = result["items"][0]
        assert item["title"] == "RFP 26-034 FNS Point-of-Sale Computer Hardware"
        assert item["url"].startswith("https://www.bidnetdirect.com/colorado/solicitations/open-bids/")
        assert "0000425954" in item["url"]

    def test_labelled_dates_are_split_into_published_and_deadline(self, result):
        item = result["items"][0]
        assert item["published_date"] == "05/28/2026"
        assert item["deadline_date"] == "07/16/2026"

    def test_source_bid_id_comes_from_the_long_numeric_path_segment(self, result):
        assert result["items"][0]["source_bid_id"] == "0000425954"


class TestSyntheticCards:
    @pytest.fixture(scope="class")
    def result(self, storage_dir):
        return extract_list(read("synthetic_cards.html"), CARDS_URL, storage_dir=storage_dir)

    def test_card_group_wins_over_navigation_lists(self, result):
        assert result["item_selector_used"] == "article.bid-card"
        assert [item["title"] for item in result["items"]] == [
            "Street Sweeping Services 2026",
            "Fleet Fuel Supply",
            "Library HVAC Replacement",
        ]

    def test_urls_are_absolute_and_ids_come_from_the_path(self, result):
        assert result["items"][0]["url"] == "https://procurement.example.gov/solicitations/detail/0000412233"
        assert [item["source_bid_id"] for item in result["items"]] == ["0000412233", "0000412244", "0000412255"]

    def test_labelled_dates_and_issuer(self, result):
        item = result["items"][1]
        assert item["published_date"] == "05/06/2026"
        assert item["deadline_date"] == "06/20/2026"
        assert item["issuer_name"] == "Fleet Services Division"

    def test_max_items_truncates(self, storage_dir):
        limited = extract_list(
            read("synthetic_cards.html"), CARDS_URL, max_items=2, storage_dir=storage_dir
        )
        assert len(limited["items"]) == 2


class TestSelectorPrecedence:
    def test_item_selector_and_field_selectors_beat_the_heuristics(self, storage_dir):
        result = extract_list(
            read("synthetic_cards.html"),
            CARDS_URL,
            item_selector="article.bid-card",
            selectors={"title": "p.agency", "url": "h2.card-title a", "published_date": "span.closes"},
            storage_dir=storage_dir,
        )
        assert result["item_selector_used"] == "article.bid-card"
        assert result["items"][0]["title"] == "Department of Public Works"
        assert result["items"][0]["url"] == "https://procurement.example.gov/solicitations/detail/0000412233"
        # The caller's selector decides the field even when it points at the closing date.
        assert result["items"][0]["published_date"] == "Closes: 06/18/2026"
        assert result["diagnostics"]["title"] == "selector"
        assert result["diagnostics"]["url"] == "selector"
        assert result["diagnostics"]["deadline_date"] == "heuristic"

    def test_an_xpath_item_selector_is_accepted(self, storage_dir):
        result = extract_list(
            read("co_bidnet_open_bids.html"),
            CO_URL,
            item_selector="//tr[contains(@class,'mets-table-row')]",
            storage_dir=storage_dir,
        )
        assert len(result["items"]) == 1
        assert result["item_selector_used"] == "//tr[contains(@class,'mets-table-row')]"

    def test_a_selector_that_matches_nothing_yields_no_items(self, storage_dir):
        result = extract_list(
            read("synthetic_cards.html"), CARDS_URL, item_selector="article.no-such-card", storage_dir=storage_dir
        )
        assert result["items"] == []
        assert result["item_selector_used"] is None
        assert set(result["diagnostics"].values()) == {"not_found"}

    def test_fields_can_be_narrowed(self, storage_dir):
        result = extract_list(
            read("synthetic_cards.html"), CARDS_URL, fields=["title", "url"], storage_dir=storage_dir
        )
        assert set(result["items"][0]) == {"title", "url"}
        assert set(result["diagnostics"]) == {"title", "url"}


class TestEmptyState:
    @pytest.fixture(scope="class")
    def result(self, storage_dir):
        return extract_list(read("bidnet_erie_no_open_bids.html", LIVE), ERIE_URL, storage_dir=storage_dir)

    def test_the_real_erie_page_reports_an_empty_list(self, result):
        assert result["empty_state"] == {
            "detected": True,
            "marker": "There are no open bids at this time.",
        }

    def test_no_items_are_invented_from_page_chrome(self, result):
        assert result["items"] == []
        assert result["item_selector_used"] is None
        assert set(result["diagnostics"].values()) == {"not_found"}

    def test_the_row_heuristic_alone_also_finds_no_solicitation_rows(self):
        """The empty-state suppression is a safety net, not the only thing keeping chrome out."""
        from scrapling.parser import Selector

        from list_extractors import _heuristic_items

        page = Selector(read("bidnet_erie_no_open_bids.html", LIVE), url=ERIE_URL)
        elements, descriptor = _heuristic_items(page, ERIE_URL)
        assert (elements, descriptor) == ([], None)

    @pytest.mark.parametrize(
        "phrase,expected",
        [
            ("There are no open bids at this time.", "There are no open bids at this time."),
            ("No results found for your search.", "No results found for your search."),
            ("There are currently no solicitations posted.", "There are currently no solicitations posted."),
            ("No open solicitations are available.", "No open solicitations are available."),
        ],
    )
    def test_empty_phrases_are_recognized_with_their_sentence(self, phrase, expected):
        from scrapling.parser import Selector

        page = Selector(f"<html><body><div><p>{phrase}</p></div></body></html>", url=CARDS_URL)
        state = detect_empty_state(page)
        assert state["detected"] is True
        assert state["marker"] == expected

    def test_a_page_with_rows_is_not_an_empty_state(self):
        from scrapling.parser import Selector

        page = Selector(read("synthetic_cards.html"), url=CARDS_URL)
        assert detect_empty_state(page) == {"detected": False, "marker": None}


class TestValidation:
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"fields": ["price"]},
            {"fields": "title"},
            {"selectors": {"title": ""}},
            {"selectors": {"unknown": "p"}},
            {"selectors": "title"},
            {"item_selector": "   "},
            {"max_items": 0},
            {"max_items": 501},
            {"max_items": True},
            {"max_items": "10"},
        ],
    )
    def test_bad_arguments_raise_extract_error(self, kwargs):
        with pytest.raises(ExtractError):
            extract_list(read("synthetic_cards.html"), CARDS_URL, **kwargs)

    @pytest.mark.parametrize("url", ["javascript:alert(1)", "not-a-url", "", None])
    def test_url_must_be_absolute_http(self, url):
        with pytest.raises(ExtractError):
            extract_list(read("synthetic_cards.html"), url)

    def test_html_must_be_a_string(self):
        with pytest.raises(ExtractError):
            extract_list(None, CARDS_URL)

    def test_all_list_fields_are_returned_by_default(self, storage_dir):
        result = extract_list(read("synthetic_cards.html"), CARDS_URL, storage_dir=storage_dir)
        assert set(result["items"][0]) == set(LIST_FIELDS)


def test_the_adaptive_store_is_written_into_the_given_storage_dir(tmp_path):
    extract_list(
        read("synthetic_cards.html"),
        CARDS_URL,
        item_selector="article.bid-card",
        storage_dir=str(tmp_path),
    )
    assert (tmp_path / "elements_storage.db").exists()


def test_hidden_empty_state_row_does_not_hide_real_bidnet_rows():
    """Real Aurora page: 16 open solicitations plus an aria-hidden 'no open bids' template row."""
    from pathlib import Path

    from list_extractors import extract_list

    html = (Path(__file__).parent / "fixtures" / "list" / "bidnet_aurora_open_bids_with_hidden_empty_row.html").read_text(encoding="utf-8", errors="ignore")
    result = extract_list(html, "https://www.bidnetdirect.com/city-of-aurora/solicitations/open-bids",
                          fields=["title", "url", "published_date", "deadline_date", "source_bid_id"], max_items=200)
    assert result["empty_state"]["detected"] is False
    assert len(result["items"]) >= 16
    assert result["item_selector_used"] == "tr.mets-table-row"
    assert all(item["url"].startswith("https://www.bidnetdirect.com/") for item in result["items"])
    # The link text is the human title; the row cell (title + dates + labels) must not replace it.
    assert result["items"][0]["title"] == "Meadow Hills & Spring Hills Golf Course Irrigation Design"


def test_empty_state_uses_visible_text_only():
    from list_extractors import extract_list

    hidden = ('<html><body><div aria-hidden="true">There are no open bids at this time.</div>'
              '<table><tbody><tr><td><a href="/solicitations/1234567">Road salt</a></td></tr></tbody></table></body></html>')
    result = extract_list(hidden, "https://x.gov/list", fields=["title", "url"], max_items=50, auto_save=False)
    assert result["empty_state"]["detected"] is False and len(result["items"]) == 1
    visible = '<html><body><p>There are no open bids at this time.</p></body></html>'
    result = extract_list(visible, "https://x.gov/list", fields=["title", "url"], max_items=50, auto_save=False)
    assert result["empty_state"]["detected"] is True and result["items"] == []
