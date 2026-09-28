"""The one place an agency name may say which state it is in (spec 2026-09-24 §6.4).

BidNet files `Laramie County, Wyoming Government` under its colorado group. Only a state written
AFTER A COMMA outranks the group; a state named anywhere else is just part of a name.
"""

import pytest

from apsi_crawler.us_states import STATE_CODES, STATE_NAMES, name_state, strip_state_suffix


def test_the_table_covers_fifty_states_and_the_district():
    assert len(STATE_NAMES) == 51
    assert len(STATE_CODES) == 51
    assert STATE_NAMES["district of columbia"] == "DC"
    assert STATE_NAMES["west virginia"] == "WV"


@pytest.mark.parametrize(
    "name, expected",
    [
        ("Laramie County, Wyoming Government", "WY"),
        ("Town of Dover, NY", "NY"),
        ("Madison County, AL", "AL"),
        ("City of Muskegon, MI", "MI"),
        ("Township of Waterford, NJ", "NJ"),
        ("Charleston, West Virginia", "WV"),
        ("Water Authority, Virginia", "VA"),
        ("Some Agency, District of Columbia", "DC"),
        ("Public Works, Inc., NY", "NY"),
    ],
)
def test_a_state_written_after_a_comma_is_read(name, expected):
    assert name_state(name) == expected


@pytest.mark.parametrize(
    "name",
    [
        # Spec §6.4's counterexamples: a state named without a comma never counts.
        "City of Idaho Springs",
        "City of Iowa Park",
        "Colorado River Indian Tribes",
        # A comma followed by something that is not a state.
        "Denver Zoological Foundation, Inc.",
        "RMD Associates, LLC",
        "Fayetteville, City of",
        "Detroit Employment Solutions Corporation, A Michigan Works! Agency",
        "Wisconsin Department of Health Services, Lead-Safe Homes Program",
        # A county or city that shares a state's name is not the state.
        "Town of Fort Ann, Washington County",
        "Housing Office, New York City",
        # Two lowercase letters are a word, not a USPS code.
        "Water Works, in partnership",
        "Fire Board, or successor",
        # Two different states: the name proves nothing.
        "Tri-State Authority, NY, NJ",
        "",
        None,
    ],
)
def test_nothing_else_is_a_state(name):
    assert name_state(name) is None


@pytest.mark.parametrize(
    "name, expected",
    [
        ("Town of Dover, NY", "Town of Dover"),
        ("Madison County, AL", "Madison County"),
        ("Augusta, GA", "Augusta"),
        ("Charleston, West Virginia", "Charleston"),
        # The state is not where the name ends, so nothing is removed.
        ("Laramie County, Wyoming Government", "Laramie County, Wyoming Government"),
        ("Denver Zoological Foundation, Inc.", "Denver Zoological Foundation, Inc."),
        ("Fayetteville, City of", "Fayetteville, City of"),
        ("City of Idaho Springs", "City of Idaho Springs"),
        ("  Town of Rye  ", "Town of Rye"),
        ("", ""),
        (None, ""),
    ],
)
def test_only_a_trailing_state_is_stripped(name, expected):
    assert strip_state_suffix(name) == expected


def test_importing_the_module_does_not_import_the_jurisdiction_table_package():
    import subprocess
    import sys

    probe = (
        "import sys, apsi_crawler.us_states; "
        "print('apsi_crawler.jurisdictions' in sys.modules)"
    )
    completed = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True)
    assert completed.stdout.strip() == "False"
