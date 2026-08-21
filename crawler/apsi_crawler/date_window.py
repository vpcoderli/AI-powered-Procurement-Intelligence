"""Published-date window filtering for fetch-task runs.

The window arrives in the fetch-task payload as `date_range: {"from": "yyyy-mm-dd",
"to": "yyyy-mm-dd"}` (either side optional). Filtering is fail-open: bids whose
published_date is missing or unparseable are KEPT — we never silently drop data
just because a portal uses a date format we cannot parse — and the returned stats
make the effect transparent to the caller.
"""

from datetime import date, datetime


_DATE_FORMATS = (
    "%m/%d/%Y",
    "%m/%d/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M",
    "%Y-%m-%d",
)


class DateWindowError(Exception):
    """Raised when the requested window itself is invalid (contract violation)."""


def parse_published_date(value):
    """Best-effort parse of a normalized bid's published_date into a date, else None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    # ISO datetime variants ("2026-06-12T22:00:00", trailing "Z", offsets).
    iso_text = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        return datetime.fromisoformat(iso_text).date()
    except ValueError:
        pass
    try:
        return date.fromisoformat(iso_text[:10])
    except ValueError:
        return None


def _window_bound(date_range, key):
    raw = date_range.get(key)
    if raw in (None, ""):
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError as error:
        raise DateWindowError(
            f"date_range.{key} must be an ISO date (yyyy-mm-dd), got: {raw!r}"
        ) from error


def apply_date_window(bids, date_range):
    """Filter bids by published_date within the inclusive window.

    Returns (filtered_bids, stats). stats is None when no window was requested,
    otherwise {"from", "to", "kept", "dropped", "unparsed"}.
    """
    if not date_range:
        return bids, None

    window_from = _window_bound(date_range, "from")
    window_to = _window_bound(date_range, "to")
    if window_from is None and window_to is None:
        return bids, None
    if window_from and window_to and window_from > window_to:
        raise DateWindowError(
            f"date_range.from ({window_from}) is after date_range.to ({window_to})"
        )

    kept = []
    dropped = 0
    unparsed = 0
    for bid in bids:
        published = parse_published_date(bid.get("published_date"))
        if published is None:
            unparsed += 1
            kept.append(bid)
            continue
        if window_from and published < window_from:
            dropped += 1
            continue
        if window_to and published > window_to:
            dropped += 1
            continue
        kept.append(bid)

    stats = {
        "from": window_from.isoformat() if window_from else None,
        "to": window_to.isoformat() if window_to else None,
        "kept": len(kept),
        "dropped": dropped,
        "unparsed": unparsed,
    }
    return kept, stats
