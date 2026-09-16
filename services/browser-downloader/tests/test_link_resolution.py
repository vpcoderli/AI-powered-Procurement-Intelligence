"""Link matching is pure so the C2 resolution order can be tested without a browser."""

import pytest

from guards import LinkSpec
from link_resolution import LinkElement, describe_link, normalize_text, resolve_link


def page_elements():
    return [
        LinkElement(index=0, tag="a", href="/home", onclick="", text="Home"),
        LinkElement(index=1, tag="a", href="javascript:downloadFile('1807333');", onclick="", text="Solicitation.pdf"),
        LinkElement(index=2, tag="a", href="/bidDetail.sdo?downloadFileNbr=99", onclick="", text="Addendum 1.pdf"),
        LinkElement(index=3, tag="button", href="", onclick="downloadFile('551100')", text="Attachment B"),
    ]


class TestNormalizeText:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("  Solicitation.pdf \n", "Solicitation.pdf"),
            ("Solicitation Doc.pdf", "Solicitation Doc.pdf"),
            ("A   B", "A B"),
            (None, ""),
            (123, ""),
        ],
    )
    def test_collapses_whitespace(self, raw, expected):
        assert normalize_text(raw) == expected


class TestResolveLink:
    def test_selector_matches_win_over_everything(self):
        elements = page_elements()
        selector_match = LinkElement(index=7, tag="a", href="/picked", onclick="", text="Picked")
        found = resolve_link(
            elements,
            LinkSpec(selector="a.download", href_contains="1807333", text="Solicitation.pdf"),
            selector_matches=[selector_match, elements[1]],
        )
        assert found is selector_match

    def test_falls_through_to_href_contains_when_the_selector_matched_nothing(self):
        found = resolve_link(
            page_elements(),
            LinkSpec(selector="a.download", href_contains="1807333", text="Addendum 1.pdf"),
            selector_matches=[],
        )
        assert found.index == 1

    def test_href_contains_matches_the_href(self):
        found = resolve_link(page_elements(), LinkSpec(href_contains="downloadFileNbr=99"))
        assert found.index == 2

    def test_href_contains_matches_an_onclick_handler(self):
        found = resolve_link(page_elements(), LinkSpec(href_contains="551100"))
        assert found.index == 3

    def test_href_contains_is_case_insensitive(self):
        found = resolve_link(page_elements(), LinkSpec(href_contains="DOWNLOADFILENBR=99"))
        assert found.index == 2

    def test_href_contains_matches_a_whole_token_not_a_substring(self):
        # "download" is glued to "File" in every control, so it is not a token of any href;
        # a bare id is. Substring matching would have picked the first control blindly.
        assert resolve_link(page_elements(), LinkSpec(href_contains="download")) is None
        assert resolve_link(page_elements(), LinkSpec(href_contains="1807333")).index == 1
        assert resolve_link(page_elements(), LinkSpec(href_contains="99")).index == 2

    def test_text_match_is_exact_after_normalization(self):
        found = resolve_link(page_elements(), LinkSpec(text="  addendum 1.pdf  "))
        assert found.index == 2

    def test_text_match_does_not_accept_a_substring(self):
        assert resolve_link(page_elements(), LinkSpec(text="Addendum")) is None

    def test_href_contains_is_tried_before_text(self):
        found = resolve_link(page_elements(), LinkSpec(href_contains="1807333", text="Addendum 1.pdf"))
        assert found.index == 1

    def test_text_is_used_when_href_contains_finds_nothing(self):
        found = resolve_link(page_elements(), LinkSpec(href_contains="not-on-the-page", text="Attachment B"))
        assert found.index == 3

    def test_returns_none_when_nothing_matches(self):
        assert resolve_link(page_elements(), LinkSpec(href_contains="nope", text="also nope")) is None

    def test_returns_none_for_an_empty_page(self):
        assert resolve_link([], LinkSpec(href_contains="1807333")) is None


class TestDescribeLink:
    def test_describes_the_spec_for_error_messages_without_leaking_page_content(self):
        described = describe_link(LinkSpec(selector=None, href_contains="1807333", text="Solicitation.pdf"))
        assert "1807333" in described
        assert "Solicitation.pdf" in described




def test_href_token_match_never_matches_a_longer_id_and_disambiguates_by_label():
    from link_resolution import find_by_href_contains

    elements = [
        LinkElement(index=0, href="javascript:downloadFile('1812426');", text="Library IFB.pdf"),
        LinkElement(index=1, href="javascript:downloadFile('1812427');", text="Lots Outlined.png"),
        LinkElement(index=2, href="javascript:downloadFile('18124271');", text="Other.pdf"),
    ]
    assert find_by_href_contains(elements, "1812427").index == 1
    # Pagination noise such as currentPage=1 must never select the first link.
    assert find_by_href_contains(elements, "1") is None
    # Two controls carrying the same token: the label decides; no label match -> unresolved.
    twins = [LinkElement(index=0, href="/dl?file=77", text="Preview"), LinkElement(index=1, href="/dl?file=77&mode=download", text="Scope.pdf")]
    assert find_by_href_contains(twins, "77", "Scope.pdf").index == 1
    assert find_by_href_contains(twins, "77", "Missing.pdf") is None
    assert resolve_link(twins, LinkSpec(href_contains="77", text="Scope.pdf")).index == 1
