"""US state names and USPS codes, and the one place an agency name may state its own state.

Spec 2026-09-24 §6.4: when a directory agency writes its state AFTER A COMMA ("Laramie County,
Wyoming Government", "Town of Dover, NY"), that state outranks the purchasing group the
directory files it under -- BidNet lists Laramie County, WY inside its colorado group. Nothing
else in a name counts: "City of Idaho Springs", "City of Iowa Park" and "Colorado River Indian
Tribes" name a state without being in it.

A standalone module on purpose: the BidNet harvester and the discovery service import it at
module level, and neither may drag in `apsi_crawler.jurisdictions` (the discovery CLI loads the
Census table lazily). Pure functions, stdlib only, no I/O.
"""

import re


__all__ = ["STATE_CODES", "STATE_NAMES", "name_state", "strip_state_suffix"]


#: Lowercase full name -> USPS code: the 50 states and the District of Columbia.
STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
    "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI", "minnesota": "MN",
    "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR",
    "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
}
STATE_CODES = frozenset(STATE_NAMES.values())

# Longest names first, so "west virginia" is tried before "virginia".
_NAMES_LONGEST_FIRST = sorted(STATE_NAMES, key=lambda state_name: -len(state_name.split()))

# "..., Washington County" / "..., New York City" name a place that shares a state's name.
_JURISDICTION_WORDS = frozenset(
    ("county", "parish", "borough", "city", "town", "township", "village", "municipality")
)

# A USPS code only counts when written as one: two capitals standing alone ("NY", "WY").
# "in", "or", "LLC" and "Inc" are words.
_CODE_RE = re.compile(r"([A-Z]{2})(?![A-Za-z0-9])")
_WORD_RE = re.compile(r"[a-z]+")
_LETTERS_AND_SPACES_RE = re.compile(r"[A-Za-z ]+")


def _state_opening(tail):
    """The state a comma's tail opens with, or None."""
    code = _CODE_RE.match(tail)
    if code and code.group(1) in STATE_CODES:
        return code.group(1)
    words = _WORD_RE.findall(tail.casefold())
    for state_name in _NAMES_LONGEST_FIRST:
        size = len(state_name.split())
        if " ".join(words[:size]) == state_name:
            following = words[size] if len(words) > size else None
            return None if following in _JURISDICTION_WORDS else STATE_NAMES[state_name]
    return None


def name_state(name):
    """The USPS code an agency name states after a comma, else None.

    Every comma is looked at. When the commas point at two different states the name proves
    nothing and the answer is None, so the purchasing group stays in charge (spec §11).
    """
    if not isinstance(name, str) or "," not in name:
        return None
    found = set()
    for tail in name.split(",")[1:]:
        state = _state_opening(tail.strip())
        if state:
            found.add(state)
    return found.pop() if len(found) == 1 else None


def strip_state_suffix(name):
    """`"Town of Dover, NY"` -> `"Town of Dover"`: drop a ", <state>" that ends the name.

    Only a tail that is exactly a USPS code or exactly a state's full name goes. "Laramie
    County, Wyoming Government" keeps every word, because the state is not where it ends.
    """
    if not isinstance(name, str):
        return ""
    head, comma, tail = name.rpartition(",")
    tail = tail.strip()
    if comma and (
        tail in STATE_CODES
        or (_LETTERS_AND_SPACES_RE.fullmatch(tail) and " ".join(tail.casefold().split()) in STATE_NAMES)
    ):
        return head.strip()
    return name.strip()
