import pytest

from apsi_crawler.date_window import (
    DateWindowError,
    apply_date_window,
    parse_published_date,
)


def _bid(bid_id, published_date):
    return {"source_bid_id": bid_id, "published_date": published_date}


class TestParsePublishedDate:
    def test_parses_us_slash_dates(self):
        assert parse_published_date("8/20/2026").isoformat() == "2026-08-20"
        assert parse_published_date("06/05/2026").isoformat() == "2026-06-05"

    def test_parses_iso_date(self):
        assert parse_published_date("2026-06-12").isoformat() == "2026-06-12"

    def test_parses_iso_datetime(self):
        assert parse_published_date("2026-06-12T22:00:00").isoformat() == "2026-06-12"
        assert parse_published_date("2026-06-10T14:00:00Z").isoformat() == "2026-06-10"

    def test_parses_us_slash_datetime(self):
        assert parse_published_date("06/15/2026 14:00:00").isoformat() == "2026-06-15"

    def test_returns_none_for_unparseable_or_missing(self):
        assert parse_published_date(None) is None
        assert parse_published_date("") is None
        assert parse_published_date("Not provided") is None
        assert parse_published_date("Central Time") is None


class TestApplyDateWindow:
    def test_no_window_returns_bids_unchanged(self):
        bids = [_bid("a", "8/20/2026")]
        filtered, stats = apply_date_window(bids, None)
        assert filtered == bids
        assert stats is None

    def test_filters_outside_window_inclusive_edges(self):
        bids = [
            _bid("before", "2026-07-31"),
            _bid("on-from", "2026-08-01"),
            _bid("inside", "8/10/2026"),
            _bid("on-to", "2026-08-21"),
            _bid("after", "2026-08-22"),
        ]
        filtered, stats = apply_date_window(bids, {"from": "2026-08-01", "to": "2026-08-21"})
        assert [b["source_bid_id"] for b in filtered] == ["on-from", "inside", "on-to"]
        assert stats == {
            "from": "2026-08-01",
            "to": "2026-08-21",
            "kept": 3,
            "dropped": 2,
            "unparsed": 0,
        }

    def test_from_only_and_to_only(self):
        bids = [_bid("old", "2026-01-01"), _bid("new", "2026-08-20")]
        filtered, _ = apply_date_window(bids, {"from": "2026-06-01"})
        assert [b["source_bid_id"] for b in filtered] == ["new"]

        filtered, _ = apply_date_window(bids, {"to": "2026-06-01"})
        assert [b["source_bid_id"] for b in filtered] == ["old"]

    def test_unparseable_dates_fail_open_and_are_counted(self):
        bids = [
            _bid("undated", None),
            _bid("weird", "TBD"),
            _bid("dated-out", "2026-01-01"),
        ]
        filtered, stats = apply_date_window(bids, {"from": "2026-08-01", "to": "2026-08-21"})
        assert [b["source_bid_id"] for b in filtered] == ["undated", "weird"]
        assert stats == {
            "from": "2026-08-01",
            "to": "2026-08-21",
            "kept": 2,
            "dropped": 1,
            "unparsed": 2,
        }

    def test_invalid_window_values_raise(self):
        with pytest.raises(DateWindowError):
            apply_date_window([], {"from": "08/01/2026"})
        with pytest.raises(DateWindowError):
            apply_date_window([], {"to": "not-a-date"})
        with pytest.raises(DateWindowError):
            apply_date_window([], {"from": "2026-08-21", "to": "2026-08-01"})

    def test_empty_window_object_is_treated_as_no_window(self):
        bids = [_bid("a", "8/20/2026")]
        filtered, stats = apply_date_window(bids, {})
        assert filtered == bids
        assert stats is None
