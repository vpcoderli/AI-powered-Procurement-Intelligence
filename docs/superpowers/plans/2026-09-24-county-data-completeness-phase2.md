# County Data Completeness — Phase 2 (Discovery: Townships, Towns, Cross-State) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `discover-sources` find Township/Town governments (a new `township` candidate level backed by Census county subdivisions), stop mismatching New York towns to same-name villages/cities, and honour a state an agency writes after a comma (Laramie County, WY listed under BidNet's colorado group) — then re-run discovery and record the result.

**Architecture:** Pure-function changes in the crawler's discovery stack: a new `apsi_crawler/us_states.py` reads a "comma + state" marker; `apsi_crawler/jurisdictions` gains a `township` level (classification, `name_key` forms, a `cousub` table level with a charter-township filter); the Census refresh script learns the county-subdivision gazetteer; the BidNet harvester takes the name's state over the group's; `discovery_service` emits township candidates with `bidnet_<st>_<key>_<town|township>` ids and a `discovery.stateSource`. `register-sources` holds back a candidate whose tenant the reverse lookup already suggests for an existing source. Discovery stays read-only and manual.

**Status (2026-09-28): complete.** Tasks 1–8 implemented and reviewed (61d7ec4..2ff243b); the whole-branch review's docs-only fixes landed in e1f32a9. Task 9's live run first stopped on `waf_challenge` three times — a detector false positive (BidNet now embeds the AWS WAF SDK `<script src=…/challenge.js>` on ordinary 200 pages), fixed as an added Task 9a (7fe5d73, comment follow-up 1c90060) before the run succeeded (43 pages, 2,037 agencies, `exhausted`). Acceptance (spec §12.2, phase 2) is recorded in `docs/operations/source-discovery.md` "第二轮实测（阶段 2，2026-09-28）": 144 township candidates, the eleven NY towns resolved (10 town GEOIDs + Clinton ambiguous by design), `bidnet_wy_laramie` → `partial`. Two plan-level rule questions raised by the review for a spec amendment, not changed here: the charter-only matching rule (drops MI charter townships whose Census name is plain) and the cousub-only township lookup (drops MA "Town city" places).

**Tech Stack:** Python 3.9-compatible crawler (stdlib + `requests`, pytest), Census 2024 gazetteer files, TypeScript/tsx script + Vitest for `register-sources`.

Spec: `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` §6 (this phase), §11 (error handling row "发现里州码冲突"), §12.1/§12.2 (tests, acceptance), §14 (items to verify at phase start). Upstream discovery design: `docs/superpowers/specs/2026-09-21-source-discovery-design.md`. Runbook: `docs/operations/source-discovery.md`.

## Global Constraints

- Discovery stays **read-only and manual**: no database write, no governance column, no worker. Public boundary only — never log in, never create accounts, never bypass WAF/CAPTCHA; a challenge stops the run.
- **No fuzzy GEOID matching.** Exact, same-state `name_key` only; several rows → `ambiguous_match` in review; the county-prefix rule stays county-only — townships never get a prefix rule.
- Special districts are never registered (2026-09-21 decision 3 still holds).
- Classification priority, top-down: `special_district` > `county` > `township` > `city` > `unknown`. `township` = the name contains `township` / `twp` (any state), or — only in `NY, CT, ME, MA, NH, RI, VT, WI` — the name starts with `town of` or ends with `town`. Other states' "Town of X" stays `city`.
- Census county subdivisions: only `FUNCSTAT = A` rows whose Census name ends in `town`, `township` or `charter township`; TSV `level = cousub`; 10-digit GEOID.
- `name_key` adds leading `charter township of` / `township of`, trailing `township` / `twp`; after stripping `township`/`twp`, a last word `charter` is stripped too (`Delta Charter Township` → `delta`).
- Township match: `cousub` rows only, same state, exact key; a name containing `Charter` matches only `… charter township` rows, otherwise both kinds.
- Township id: `bidnet_<state>_<name_key>_<town|township>` — the type word from the matched Census name (`… town` → `town`; `… township` / `… charter township` → `township`). `jurisdictionLevel = issuerType = "township"`; `jurisdictionName` = the Census name (e.g. `Rye town`).
- Cross-state: only a state written **after a comma** counts (`", Wyoming"`, `", WY"`); it overrides the purchasing group's state; `discovery.stateSource` is `"name"` when it did, else `"group"`. A state named without a comma never counts (`City of Idaho Springs`, `City of Iowa Park`, `Colorado River Indian Tribes`).
- `levels` accepts `township`; default `["county", "city", "township"]`. `stats` gains `township`; `county + city + township + special_district + unknown == agencies`.
- Python code must run on Python 3.9 (local) and 3.12 (CI); stdlib + `requests` only.
- Tests run offline: fixtures only. No test downloads a Census file or touches BidNet; refresh-script tests always pass all three local zips.
- Runtime code never imports `crawler/scripts/refresh_jurisdictions.py`.
- Vitest: `globals: false` — import `describe/it/expect` explicitly.
- Commit per task with explicit pathspecs; never stage `.DS_Store`, `services/.DS_Store`, `ops-evidence/` or `frontend/data/`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions this plan adds (beyond the spec text — confirm at plan review)

1. **A trailing ", <state>" is not part of the name.** `Town of Dover, NY`, `Madison County, AL`, `City of Conway, SC` are classified, keyed and matched without the suffix (`discovery.agencyName` and the label keep it as printed). Without this, `Town of Dover, NY` keys to `dover ny` and never matches.
2. **`source:register` holds back a candidate whose tenant `existingMatches` suggests for an existing source** (`exact`/`partial`), printing the PATCH to make instead; `--allow-suggested` registers it anyway. This is how "按运行手册改指旧行，不另注册新 id" (spec §6.4) is enforced for Laramie: the file stays registerable "as written".
3. **The five Utah "metro township" places** (`Kearns metro township`, …) change `name_key` (`kearns metro township` → `kearns metro`) because `township` becomes a trailing designator. Spec §6.2 said no table name ends in these words; that is corrected in the docs task. No directory agency matched those rows before.
4. Known limitation, not fixed here: `Charter Township of Port Huron` stays `special_district` (the whole word `port`), and Utah metro townships (places, not county subdivisions) land in review.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `crawler/apsi_crawler/us_states.py` (new) | 1 | State names/codes; `name_state` (comma + state marker); `strip_state_suffix` |
| `crawler/tests/test_us_states.py` (new) | 1 | Marker rules incl. the spec's three counterexamples |
| `crawler/apsi_crawler/jurisdictions/__init__.py` | 2 | `township` classification, `name_key` township forms, `cousub` table level, charter filter |
| `crawler/tests/fixtures/jurisdictions/sample_us_jurisdictions.tsv` | 2 | Sample `cousub` rows |
| `crawler/tests/test_jurisdictions.py` | 2, 3, 7 | Classification/matching (2), refresh script (3), committed table (7) |
| `crawler/data/us_jurisdictions.tsv` | 2 (re-key), 7 (regenerate) | Bundled Census table |
| `crawler/scripts/refresh_jurisdictions.py` | 3 | Third gazetteer: county subdivisions |
| `crawler/apsi_crawler/discovery/bidnet.py` | 4 | Name-stated state outranks the group; `state_source` |
| `crawler/tests/test_discovery_bidnet.py` | 4 | Cross-state harvest tests |
| `crawler/apsi_crawler/discovery_service.py` | 5 | Township level, ids, `stateSource`, suffix-free names |
| `crawler/tests/test_discover_sources_cli.py` | 5, 7 | Orchestration tests (5), real-collaborator township case (7) |
| `frontend/scripts/register-sources.ts` + `.test.ts` | 6 | Hold back suggested tenants; `--allow-suggested` |
| `docs/operations/source-discovery.md`, `CLAUDE.md`, spec §6 | 8 | Runbook + architecture notes |

Waves (parallel inside a wave, disjoint files): **A** = 1, 2, 6 · **B** = 3, 4, 5 · **C** = 7 · **D** = 8 · **E** = 9 (controller).

---

### Task 1: State markers in agency names

**Files:**
- Create: `crawler/apsi_crawler/us_states.py`
- Create: `crawler/tests/test_us_states.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `STATE_NAMES: dict[str, str]` (lowercase full name → USPS code, 50 states + DC), `STATE_CODES: frozenset[str]`, `name_state(name) -> str | None`, `strip_state_suffix(name) -> str`. Tasks 4 and 5 import them as `from apsi_crawler.us_states import name_state, strip_state_suffix`. The module is standalone on purpose: importing it must not import `apsi_crawler.jurisdictions` (the discovery CLI keeps that lazy).

- [x] **Step 1: Write the failing tests**

Create `crawler/tests/test_us_states.py`:

```python
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_us_states.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'apsi_crawler.us_states'`.

- [x] **Step 3: Implement**

Create `crawler/apsi_crawler/us_states.py`:

```python
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_us_states.py`
Expected: PASS (all cases).

- [x] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/us_states.py crawler/tests/test_us_states.py
git commit -m "feat(discovery): read a state an agency writes after a comma

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `township` level in classification and matching

**Files:**
- Modify: `crawler/apsi_crawler/jurisdictions/__init__.py`
- Modify: `crawler/tests/fixtures/jurisdictions/sample_us_jurisdictions.tsv`
- Modify: `crawler/tests/test_jurisdictions.py` (name_key, classification, loader and match sections only)
- Modify: `crawler/data/us_jurisdictions.tsv` (re-key only — names untouched)

**Interfaces:**
- Consumes: nothing.
- Produces: `classify_agency(name, state_code=None)` may now return `"township"`; `match_jurisdiction("township", state_code, name, table=None, allow_prefix=True)` looks up the `"cousub"` table level; `load_jurisdictions()` returns `{"county", "place", "cousub"}`; `TOWN_TOWNSHIP_STATES: frozenset[str]` exported. Task 3's refresh script writes `level = cousub` rows keyed by this `name_key`.

- [x] **Step 1: Write the failing tests**

In `crawler/tests/fixtures/jurisdictions/sample_us_jurisdictions.tsv`, append these rows (tab-separated, same six columns as the existing rows; GEOIDs are sample values):

```
place	3664309	NY	Rye city	rye	ignore-me
cousub	3611964320	NY	Rye town	rye	ignore-me
cousub	2612509180	MI	Bloomfield charter township	bloomfield	ignore-me
cousub	2606509200	MI	Bloomfield township	bloomfield	ignore-me
cousub	2604522980	MI	Delta charter township	delta	ignore-me
cousub	2609968700	MI	Richmond township	richmond	ignore-me
cousub	2610368720	MI	Richmond township	richmond	ignore-me
cousub	3400776340	NJ	Waterford township	waterford	ignore-me
cousub	5513302775	WI	Brookfield town	brookfield	ignore-me
```

In `crawler/tests/test_jurisdictions.py`:

1. Change the import block to also import `TOWN_TOWNSHIP_STATES`:

```python
from apsi_crawler.jurisdictions import (
    BUNDLED_TABLE_PATH,
    TOWN_TOWNSHIP_STATES,
    JurisdictionTableError,
    classify_agency,
    load_jurisdictions,
    match_jurisdiction,
    name_key,
)
```

2. In `test_leaves_everything_else_unknown`, delete the two entries `"Andover Township",` and `"Bloomfield Township",` from the parametrize list (they are townships now).

3. In `test_loader_skips_the_header_comment_and_ignores_unknown_columns`, change the first assertion to:

```python
    assert set(sample_table) == {"county", "place", "cousub"}
```

4. Append after `test_name_key_handles_empty_and_non_string_input`:

```python
@pytest.mark.parametrize(
    "value,expected",
    [
        ("Charter Township of Clinton", "clinton"),
        ("Township of Lower Merion", "lower merion"),
        ("Bloomfield Township", "bloomfield"),
        ("Delta Charter Township", "delta"),
        ("Bloomfield charter township", "bloomfield"),
        ("Clinton Twp", "clinton"),
        ("Clinton Twp.", "clinton"),
        ("Rye town", "rye"),
    ],
)
def test_name_key_strips_township_forms(value, expected):
    """Spec 2026-09-24 §6.2: the directory's and Census's township spellings meet in the middle."""
    assert name_key(value) == expected


def test_name_key_strips_charter_only_right_before_township():
    assert name_key("Charter Oak") == "charter oak"
    assert name_key("Charter Township") == "charter"


def test_utah_metro_townships_lose_only_the_township_word():
    """Five Census places end in "metro township"; their key changes, nothing else does."""
    assert name_key("Kearns metro township") == "kearns metro"
```

5. Append after `test_special_district_beats_county_and_city`:

```python
@pytest.mark.parametrize(
    "name,state",
    [
        ("Andover Township", "NJ"),
        ("Bloomfield Township", "MI"),
        ("Charter Township of Clinton", "MI"),
        ("Township of Waterford", "NJ"),
        ("Clinton Twp", "NJ"),
        ("Bloomfield Township", None),
    ],
)
def test_township_wording_is_a_township_in_every_state(name, state):
    assert classify_agency(name, state) == "township"


@pytest.mark.parametrize("state", sorted(TOWN_TOWNSHIP_STATES))
def test_a_town_is_a_township_where_towns_are_civil_townships(state):
    assert classify_agency("Town of Rye", state) == "township"
    assert classify_agency("Southampton Town", state) == "township"


@pytest.mark.parametrize("state", ["CO", "NC", "NJ", "SC", "CA", None])
def test_elsewhere_a_town_stays_a_city(state):
    assert classify_agency("Town of Castle Rock", state) == "city"


def test_the_town_states_are_exactly_new_york_new_england_and_wisconsin():
    assert TOWN_TOWNSHIP_STATES == frozenset(("NY", "CT", "ME", "MA", "NH", "RI", "VT", "WI"))


def test_special_districts_and_counties_still_outrank_townships():
    assert classify_agency("Bloomfield Township Public Library", "MI") == "special_district"
    assert classify_agency("Berkeley Township Sewerage Authority", "NJ") == "special_district"
    assert classify_agency("Town of Rye Water District", "NY") == "special_district"
    assert classify_agency("Township of Franklin (Somerset County)", "NJ") == "county"
```

6. Append after `test_an_unsupported_level_is_a_programming_error`:

```python
def test_a_town_matches_the_county_subdivision_never_the_same_name_city(sample_table):
    """Spec 2026-09-24 §1: "Town of Rye" was matched to Rye city; they are two governments."""
    assert match_jurisdiction("township", "NY", "Town of Rye", sample_table) == {
        "status": "exact",
        "geoid": "3611964320",
        "name": "Rye town",
    }
    assert match_jurisdiction("city", "NY", "City of Rye", sample_table)["geoid"] == "3664309"


def test_charter_in_the_name_matches_only_a_charter_township(sample_table):
    for name in ("Charter Township of Bloomfield", "Bloomfield Charter Township"):
        assert match_jurisdiction("township", "MI", name, sample_table) == {
            "status": "exact",
            "geoid": "2612509180",
            "name": "Bloomfield charter township",
        }


def test_without_charter_both_kinds_stay_in_play(sample_table):
    result = match_jurisdiction("township", "MI", "Bloomfield Township", sample_table)
    assert result["status"] == "ambiguous"
    assert sorted(candidate["name"] for candidate in result["candidates"]) == [
        "Bloomfield charter township",
        "Bloomfield township",
    ]


def test_same_name_townships_in_one_state_are_ambiguous_never_guessed(sample_table):
    result = match_jurisdiction("township", "MI", "Richmond Township", sample_table)
    assert result["status"] == "ambiguous"
    assert [candidate["geoid"] for candidate in result["candidates"]] == ["2609968700", "2610368720"]


def test_charter_with_no_charter_row_is_not_found(sample_table):
    assert match_jurisdiction("township", "MI", "Richmond Charter Township", sample_table) == {
        "status": "not_found"
    }


def test_townships_never_get_a_prefix_rule(sample_table):
    assert match_jurisdiction("township", "NY", "Town of Rye Police Department", sample_table) == {
        "status": "not_found"
    }


def test_the_township_level_reads_only_county_subdivisions(sample_table):
    # A Wisconsin town is in the cousub table; the city table never answers for it.
    assert match_jurisdiction("township", "WI", "Town of Brookfield", sample_table)["geoid"] == "5513302775"
    assert match_jurisdiction("city", "WI", "Town of Brookfield", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("township", "NJ", "Township of Waterford", sample_table)["geoid"] == "3400776340"
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_jurisdictions.py`
Expected: FAIL — `ImportError: cannot import name 'TOWN_TOWNSHIP_STATES'`.

- [x] **Step 3: Implement**

In `crawler/apsi_crawler/jurisdictions/__init__.py`:

1. Replace the first docstring line `"""Census county/place lookup for discovered agencies (contract C2, spec sections 4.4 and 4.5).` with:

```python
"""Census county/place/county-subdivision lookup for discovered agencies (contract C2).

Spec sections 4.4 and 4.5 of the 2026-09-21 discovery design; townships and towns (the `cousub`
table level) are spec 2026-09-24 §6.
```

2. Replace `__all__` with:

```python
__all__ = [
    "BUNDLED_TABLE_PATH",
    "JurisdictionTableError",
    "TOWN_TOWNSHIP_STATES",
    "classify_agency",
    "load_jurisdictions",
    "match_jurisdiction",
    "name_key",
]
```

3. Replace `_TABLE_LEVELS = ("county", "place")` with:

```python
_TABLE_LEVELS = ("county", "place", "cousub")
```

4. Replace the `_LEADING_FORMS` tuple (keep the comment above it, add two lines to it) with:

```python
# `charter township of` / `township of` are how Michigan and New Jersey buyers spell a civil
# township ("Charter Township of Clinton", "Township of Waterford"); Census writes the same
# government "Clinton charter township" / "Waterford township" (spec 2026-09-24 §6.2).
_LEADING_FORMS = (
    "city and county of", "charter township of", "township of", "county of", "city of",
    "town of", "village of", "borough of",
)
```

5. Replace `_TRAILING_DESIGNATORS = ("county", "parish", "borough", "city", "town", "village")` with:

```python
# `township` / `twp` joined these in 2026-09 (spec §6.2). Five Census places end in "metro
# township" (Kearns, Magna, ... in Utah); their keys lose the last word and keep "metro".
_TRAILING_DESIGNATORS = ("county", "parish", "borough", "city", "town", "village", "township", "twp")
_TOWNSHIP_DESIGNATORS = ("township", "twp")
```

6. In `name_key`, replace the loop

```python
    while words and words[-1] in _TRAILING_DESIGNATORS:
        words.pop()
```

with:

```python
    while words and words[-1] in _TRAILING_DESIGNATORS:
        removed = words.pop()
        # "Delta Charter Township" / Census "Bloomfield charter township": `charter` qualifies
        # the designator, it is not part of the name.
        if removed in _TOWNSHIP_DESIGNATORS and len(words) > 1 and words[-1] == "charter":
            words.pop()
```

and in its docstring replace ``one leading `city of`/`town of`/`village of`/`county of`/`city and county of` removed`` with ``one leading form (`city of`, `town of`, `township of`, `charter township of`, ...) removed``.

7. After the `_CITY_TRAILING_RE = ...` line add:

```python
_TOWNSHIP_RE = re.compile(r"\b(?:township|twp)\b")
_TOWN_FORM_RE = re.compile(r"^town of\b|\btown$")

#: Where a "town" is a civil township -- a Census county subdivision with its own government --
#: rather than an incorporated municipality (spec 2026-09-24 §6.1). Elsewhere (CO, NC, NJ, ...)
#: a town is an incorporated place and stays a city.
TOWN_TOWNSHIP_STATES = frozenset(("NY", "CT", "ME", "MA", "NH", "RI", "VT", "WI"))
```

8. Replace the whole `classify_agency` function with:

```python
def classify_agency(name, state_code=None):
    """`"county"` | `"city"` | `"township"` | `"special_district"` | `"unknown"` for a name.

    Priority is top-down (spec 2026-09-21 §4.4, 2026-09-24 §6.1): a special-district word beats
    everything ("Bloomfield Township Public Library" is a library), `county` beats the rest
    ("City and County of Denver ..." is a county), then `township`, then `city`.

    `township` means the name says township/twp in any state, or -- only where towns are civil
    townships (`TOWN_TOWNSHIP_STATES`) -- it opens with "town of" or ends in "town". With the
    state unknown, a town stays a city and a borough is a city: an unmatched city merely goes
    to review, while a wrong classification also blocks the lookup that would have worked.
    """
    text = _normalized(name)
    if not text:
        return "unknown"
    if _SPECIAL_DISTRICT_RE.search(text):
        return "special_district"
    state = state_code.strip().upper() if isinstance(state_code, str) else ""
    alaska = state == "AK"
    if _COUNTY_RE.search(text) or (alaska and _BOROUGH_RE.search(text)):
        return "county"
    if _TOWNSHIP_RE.search(text):
        return "township"
    if state in TOWN_TOWNSHIP_STATES and _TOWN_FORM_RE.search(text):
        return "township"
    if _CITY_LEADING_RE.search(text) or _CITY_TRAILING_RE.search(text):
        return "city"
    if not alaska and _BOROUGH_RE.search(text):
        return "city"
    return "unknown"
```

9. Replace `_LEVEL_TABLES = {"county": "county", "city": "place"}` with:

```python
_LEVEL_TABLES = {"county": "county", "city": "place", "township": "cousub"}
_CHARTER_RE = re.compile(r"\bcharter\b")
_CHARTER_TOWNSHIP_SUFFIX = " charter township"
```

10. In `match_jurisdiction`, replace the `except` branch message and the lookup so the function reads:

```python
    try:
        level_table = _LEVEL_TABLES[level]
    except (KeyError, TypeError):
        raise ValueError("level must be 'county', 'city' or 'township', got {0!r}".format(level))

    state = state_code.strip().upper() if isinstance(state_code, str) else ""
    key = name_key(name)
    if not state or not key:
        return {"status": "not_found"}

    resolved = table if table is not None else _default_table()
    entries = resolved.get(level_table, {}).get((state, key))
    if entries and level_table == "cousub" and _CHARTER_RE.search(_normalized(name)):
        # "Charter Township of Clinton" can only be a charter township. Without the word the
        # directory may just be abbreviating, so both kinds stay in play (spec §6.3).
        entries = [entry for entry in entries if entry["name"].casefold().endswith(_CHARTER_TOWNSHIP_SUFFIX)]
    if not entries:
        if allow_prefix and level_table == "county":
            return _prefix_match(state, name, resolved) or {"status": "not_found"}
        return {"status": "not_found"}
```

(The rest of the function — the `ambiguous` and `exact` returns — is unchanged.) In its docstring add after the `prefix` paragraph: ``Townships (`"township"`) read only the `cousub` rows; a name containing "Charter" keeps only "... charter township" rows; they never get a prefix rule.``

- [x] **Step 4: Re-key the committed table (names unchanged)**

The bundled TSV stores `name_key` per row and `test_bundled_table_keys_agree_with_name_key` checks it against `name_key(name)`. Recompute the column in place — no download:

```bash
cd crawler && python3 - <<'EOF'
from apsi_crawler.jurisdictions import BUNDLED_TABLE_PATH, name_key
lines = BUNDLED_TABLE_PATH.read_text(encoding="utf-8").splitlines()
out = []
for line in lines:
    if line.startswith("#") or line.startswith("level\t"):
        out.append(line)
        continue
    level, geoid, state, name, _old = line.split("\t")
    out.append("\t".join((level, geoid, state, name, name_key(name))))
BUNDLED_TABLE_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
EOF
git diff --stat -- data/us_jurisdictions.tsv
```

Expected: `1 file changed, 5 insertions(+), 5 deletions(-)` — exactly the five Utah `… metro township` rows. Any other count means `name_key` changed more than planned: stop and report.

- [x] **Step 5: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_jurisdictions.py tests/test_discover_sources_cli.py`
Expected: PASS. (`test_discover_sources_cli.py` uses the real classifier in one test; none of its agencies are townships.)

- [x] **Step 6: Commit**

```bash
git add crawler/apsi_crawler/jurisdictions/__init__.py crawler/tests/test_jurisdictions.py crawler/tests/fixtures/jurisdictions/sample_us_jurisdictions.tsv crawler/data/us_jurisdictions.tsv
git commit -m "feat(discovery): classify and match towns and townships

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Census county subdivisions in the refresh script

**Files:**
- Modify: `crawler/scripts/refresh_jurisdictions.py`
- Modify: `crawler/tests/test_jurisdictions.py` (the `# --- refresh script` section only)

**Interfaces:**
- Consumes: Task 2 (`name_key`, the `cousub` table level in `load_jurisdictions`/`match_jurisdiction`).
- Produces: `refresh_jurisdictions.py --cousubs-zip PATH`; `COUSUBS_URL`; `select_cousubs(rows)`; `render_table(entries, generated_on, counties, places, cousubs)`; the TSV header gains `# source_cousubs:` and `# cousub_filter:` lines and `# rows: <c> counties + <p> places + <s> cousubs`. Task 7 runs it for real.

- [x] **Step 1: Write the failing tests**

In `crawler/tests/test_jurisdictions.py`, refresh section:

1. After `PLACE_COLUMNS = (...)` add:

```python
COUSUB_COLUMNS = ("USPS", "GEOID", "GEOIDFQ", "ANSICODE", "NAME", "FUNCSTAT", "ALAND", "INTPTLAT")
```

2. Replace the end of the `gazetteers` fixture (`return counties, places`) with:

```python
    cousubs = _gazetteer_zip(
        tmp_path / "cousubs.zip",
        COUSUB_COLUMNS,
        [
            ("NY", "3611964320", "0600000US3611964320", "00979446", "Rye town", "A", "1", "40.9"),
            ("MI", "2612509180", "0600000US2612509180", "01626016", "Bloomfield charter township", "A", "1", "42.6"),
            ("MI", "2609968700", "0600000US2609968700", "01626945", "Richmond township", "A", "1", "42.8"),
            # A city is also a county subdivision in NY; the place table already has it.
            ("NY", "3611964309", "0600000US3611964309", "00979445", "Rye city", "A", "1", "40.9"),
            # Not a functioning general-purpose government (inactive / statistical).
            ("PA", "4200100010", "0600000US4200100010", "01216001", "Hamiltonban township", "I", "1", "39.8"),
            ("VA", "5100191480", "0600000US5100191480", "01928456", "District 1", "S", "1", "37.0"),
            # Active, but not a town or township.
            ("ME", "2302991385", "0600000US2302991385", "00582664", "Macwahoc plantation", "A", "1", "45.6"),
        ],
    )
    return counties, places, cousubs
```

3. In every existing refresh test, unpack three zips and pass the third: change `counties, places = gazetteers` to `counties, places, cousubs = gazetteers`, and in every `main([...])` call insert `"--cousubs-zip", cousubs,` right after `"--places-zip", <places-variable>,` (four tests: keeps-governmental-places, provenance-header, rerunnable — both calls, dry-run — both calls).

4. In `test_refresh_writes_the_provenance_header_and_trims_padded_columns` add after the places assertion:

```python
    assert any("2024_Gaz_cousubs_national.zip" in line for line in header)
    assert any(line.startswith("# cousub_filter: ") for line in header)
```

5. Append after `test_refresh_dry_run_leaves_the_table_alone`:

```python
def test_refresh_keeps_only_active_towns_and_townships(tmp_path, gazetteers, capsys):
    counties, places, cousubs = gazetteers
    output = tmp_path / "us_jurisdictions.tsv"

    assert _refresh_module().main(
        ["--counties-zip", counties, "--places-zip", places, "--cousubs-zip", cousubs, "--output", str(output)]
    ) == 0

    table = load_jurisdictions(output)
    assert sorted(entry["name"] for rows in table["cousub"].values() for entry in rows) == [
        "Bloomfield charter township",
        "Richmond township",
        "Rye town",
    ]
    assert all(len(entry["geoid"]) == 10 for rows in table["cousub"].values() for entry in rows)
    assert match_jurisdiction("township", "NY", "Town of Rye", table)["geoid"] == "3611964320"
    assert match_jurisdiction("township", "MI", "Charter Township of Bloomfield", table)["geoid"] == "2612509180"
    assert "cousubs:" in capsys.readouterr().out
    assert "# rows: 2 counties + 3 places + 3 cousubs" in output.read_text(encoding="utf-8")


def test_refresh_never_downloads_when_every_zip_is_local(tmp_path, gazetteers, monkeypatch):
    module = _refresh_module()

    def no_network(url, timeout=120):
        raise AssertionError("refresh must not download {0} when a local zip was given".format(url))

    monkeypatch.setattr(module, "download", no_network)
    counties, places, cousubs = gazetteers
    assert module.main(
        ["--counties-zip", counties, "--places-zip", places, "--cousubs-zip", cousubs,
         "--output", str(tmp_path / "t.tsv")]
    ) == 0
```

(`# rows: 2 counties + 3 places + 3 cousubs`: the places fixture keeps Aurora, Oklahoma City and Anchorage; the Parish village has no usable key.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_jurisdictions.py -k refresh`
Expected: FAIL — `error: unrecognized arguments: --cousubs-zip`.

- [x] **Step 3: Implement**

In `crawler/scripts/refresh_jurisdictions.py`:

1. In the module docstring, replace the offline usage example with:

```
    # offline / re-runnable against zips already on disk
    python3 scripts/refresh_jurisdictions.py --counties-zip 2024_Gaz_counties_national.zip \\
        --places-zip 2024_Gaz_place_national.zip --cousubs-zip 2024_Gaz_cousubs_national.zip
```

and append before the closing `"""`:

```
County subdivision filter (spec 2026-09-24 §6.2): the cousub file lists every minor civil
division and census county division. Only FUNCSTAT `A` (an active government providing
general-purpose functions) whose name ends in "town", "township" or "charter township" is kept:
New York / New England / Wisconsin towns and the civil townships of MI, NJ, PA, OH, ... A city
or borough that is also a county subdivision is left to the place table; statistical CCDs,
unorganized territories, plantations, gores and grants are dropped.
```

2. After `PLACES_URL = ...` add:

```python
COUSUBS_URL = GAZETTEER_BASE + "2024_Gaz_cousubs_national.zip"

# See the module docstring. " charter township" already ends in " township".
KEPT_COUSUB_FUNCSTAT = "A"
KEPT_COUSUB_SUFFIXES = (" town", " township")
```

3. After `select_places` add:

```python
def select_cousubs(rows):
    """Active town/township governments only — see KEPT_COUSUB_FUNCSTAT / KEPT_COUSUB_SUFFIXES."""
    return [
        _entry("cousub", row)
        for row in rows
        if row.get("FUNCSTAT", "") == KEPT_COUSUB_FUNCSTAT
        and row.get("NAME", "").casefold().endswith(KEPT_COUSUB_SUFFIXES)
    ]
```

4. Replace `render_table` with:

```python
def render_table(entries, generated_on, counties, places, cousubs):
    header = [
        "# US counties, incorporated places and town/township county subdivisions, keyed for apsi_crawler.jurisdictions.",
        "# Generated by crawler/scripts/refresh_jurisdictions.py - do not hand-edit rows.",
        "# generated: {0}".format(generated_on),
        "# source_counties: {0}".format(COUNTIES_URL),
        "# source_places: {0}".format(PLACES_URL),
        "# source_cousubs: {0}".format(COUSUBS_URL),
        "# place_filter: dropped LSAD {0} (statistical, not governments); every other LSAD kept.".format(
            ", ".join("{0}={1}".format(code, label) for code, label in sorted(DROPPED_PLACE_LSAD.items()))
        ),
        "# cousub_filter: kept FUNCSTAT = {0} and NAME ending in town / township / charter township; everything else dropped.".format(
            KEPT_COUSUB_FUNCSTAT
        ),
        "# rows: {0} counties + {1} places + {2} cousubs".format(counties, places, cousubs),
    ]
    lines = header + ["\t".join(TABLE_COLUMNS)]
    lines.extend("\t".join(entry[column] for column in TABLE_COLUMNS) for entry in entries)
    return "\n".join(lines) + "\n"
```

5. In `main`, after the `--places-zip` argument add:

```python
    parser.add_argument("--cousubs-zip", default=None, help="local county-subdivisions zip instead of downloading")
```

then replace the block from `county_rows = ...` through the `for entry in skipped_counties + skipped_places:` loop with:

```python
    county_rows = read_gazetteer(payload(args.counties_zip, COUNTIES_URL))
    place_rows = read_gazetteer(payload(args.places_zip, PLACES_URL))
    cousub_rows = read_gazetteer(payload(args.cousubs_zip, COUSUBS_URL))

    counties, skipped_counties = usable(select_counties(county_rows))
    places, skipped_places = usable(select_places(place_rows))
    cousubs, skipped_cousubs = usable(select_cousubs(cousub_rows))
    entries = counties + places + cousubs

    print("counties: {0} rows in, {1} kept".format(len(county_rows), len(counties)))
    print(
        "places:   {0} rows in, {1} kept ({2} dropped as {3})".format(
            len(place_rows),
            len(places),
            len(place_rows) - len(places) - len(skipped_places),
            "/".join(sorted(DROPPED_PLACE_LSAD.values())),
        )
    )
    print(
        "cousubs:  {0} rows in, {1} kept ({2} dropped: not an active town/township government)".format(
            len(cousub_rows),
            len(cousubs),
            len(cousub_rows) - len(cousubs) - len(skipped_cousubs),
        )
    )
    for entry in skipped_counties + skipped_places + skipped_cousubs:
        print("  skipped (no usable key): {0} {1} {2}".format(entry["state"], entry["name"], entry["geoid"]))
```

and change the `render_table(...)` call to:

```python
    table = render_table(entries, datetime.date.today().isoformat(), len(counties), len(places), len(cousubs))
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_jurisdictions.py`
Expected: PASS (the committed-table tests are unaffected until Task 7).

- [x] **Step 5: Commit**

```bash
git add crawler/scripts/refresh_jurisdictions.py crawler/tests/test_jurisdictions.py
git commit -m "feat(discovery): add Census town/township subdivisions to the jurisdiction refresh

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The harvester honours a state written after a comma

**Files:**
- Modify: `crawler/apsi_crawler/discovery/bidnet.py` (`parse_agency_links`)
- Modify: `crawler/tests/test_discovery_bidnet.py`

**Interfaces:**
- Consumes: Task 1 (`name_state`).
- Produces: every `HarvestedAgency` dict gains `"state_source": "name" | "group" | None`; `state_code` is the name's state when the name states one after a comma, else the group's. The `states` filter in `_result` therefore uses the name's state (a `["WY"]` run reaches Laramie inside the colorado group). Task 5 reads `state_source`.

- [x] **Step 1: Write the failing tests**

In `crawler/tests/test_discovery_bidnet.py`:

1. In `test_page_one_yields_every_agency_card_with_a_clean_name_and_tenant_path`, add `"state_source": "group",` as the last key of both expected dicts (`35th District Court`, `Adams County`).
2. In `test_one_segment_tenants_and_logo_only_cards_are_still_harvested`, add `"state_source": None,` as the last key of the `City of Aurora` dict.
3. Append at the end of the file:

```python
# --- a state written after a comma (spec 2026-09-24 §6.4) ------------------------------------


def _card(path, name):
    """One directory card, shaped like the archived pages' markup."""
    return (
        '<a id="1" href="{0}" class="mets-command-link"><span class="participatingAgencyGridName">'
        '<span id="g_1" class="mets-ellipsis mets-ellipsis-wrapper">{1}</span></span></a>'
    ).format(path, name)


LARAMIE_CARD = _card("/colorado/laramiecountywyominggovernment", "Laramie County, Wyoming Government")


def test_a_state_written_after_a_comma_outranks_the_purchasing_group():
    agencies = parse_agency_links(
        LARAMIE_CARD
        + _card("/new-york/townofdover", "Town of Dover, NY")
        + _card("/colorado/cityofidahosprings", "City of Idaho Springs")
    )

    assert [(agency["state_code"], agency["state_source"]) for agency in agencies] == [
        ("WY", "name"),
        ("NY", "group"),
        ("CO", "group"),
    ]
    # The name is kept exactly as printed; only the state is read from it.
    assert agencies[0]["name"] == "Laramie County, Wyoming Government"
    assert agencies[0]["group"] == "colorado"


def test_a_group_without_a_state_takes_the_state_the_name_gives():
    (agency,) = parse_agency_links(_card("/bgis/somecity", "Some City, OH"))
    assert (agency["state_code"], agency["state_source"]) == ("OH", "name")


def test_no_state_anywhere_leaves_the_source_empty():
    (agency,) = parse_agency_links(_card("/bgis/bgis", "BGIS Global Integrated Solutions US LLC"))
    assert (agency["state_code"], agency["state_source"]) == (None, None)


def test_a_states_filter_uses_the_state_the_name_gives():
    page = "<html><body>" + LARAMIE_CARD + _card("/colorado/adams-county", "Adams County") + "</body></html>"

    wyoming, _, _ = _run(page, request={"states": ["WY"]})
    colorado, _, _ = _run(page, request={"states": ["CO"]})

    assert [agency["name"] for agency in wyoming["agencies"]] == ["Laramie County, Wyoming Government"]
    assert [agency["name"] for agency in colorado["agencies"]] == ["Adams County"]
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_discovery_bidnet.py`
Expected: FAIL — `KeyError: 'state_source'` / dict mismatch.

- [x] **Step 3: Implement**

In `crawler/apsi_crawler/discovery/bidnet.py`:

1. After `from apsi_crawler.html.public_page import fetch_html as _fetch_html_default` add:

```python
from apsi_crawler.us_states import name_state
```

2. In `parse_agency_links`, replace the `group = ...` line and the `agencies.append({...})` call with:

```python
        group = path.strip("/").split("/")[0] if path.count("/") == 2 else None
        group_state = state_code_for_group(group)
        # Spec 2026-09-24 §6.4: a state the agency writes after a comma outranks the group it
        # is filed under -- "Laramie County, Wyoming Government" sits in the colorado group.
        # Only that form counts (`apsi_crawler.us_states.name_state`); the name stays as printed.
        named_state = name_state(name)
        agencies.append(
            {
                "name": name,
                "tenant_path": path,
                "tenant_url": tenant_url(path),
                "group": group,
                "state_code": named_state or group_state,
                "state_source": (
                    "name" if named_state and named_state != group_state
                    else ("group" if group_state else None)
                ),
            }
        )
```

3. In the module docstring's contract description (the "What this module does" bullets), add:

```
* An agency's state is its purchasing group's, unless the name itself states one after a comma
  ("Laramie County, Wyoming Government" under `colorado` is WY); `state_source` says which.
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_discovery_bidnet.py tests/test_discover_sources_cli.py`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/discovery/bidnet.py crawler/tests/test_discovery_bidnet.py
git commit -m "feat(discovery): let a state written after a comma outrank the purchasing group

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Township candidates in `discover-sources`

**Files:**
- Modify: `crawler/apsi_crawler/discovery_service.py`
- Modify: `crawler/tests/test_discover_sources_cli.py`

**Interfaces:**
- Consumes: Task 1 (`strip_state_suffix`), Task 2 (`classify_agency` may return `"township"`; `match_jurisdiction("township", ...)` returns the Census name, e.g. `"Rye town"`), Task 4 (`agency["state_source"]`, optional — absent means `"group"`).
- Produces: `CANDIDATE_LEVELS = ("county", "city", "township")`; `ALL_LEVELS` gains `"township"`; township candidate ids `<platform>_<st>_<segment>_<town|township>`; `candidate["discovery"]["stateSource"]`; `stats["township"]`. The `discover-sources` wire format change is documented in Task 8.

- [x] **Step 1: Write the failing tests**

In `crawler/tests/test_discover_sources_cli.py`:

1. Replace `_NAME_KEY_PREFIXES` / `_NAME_KEY_SUFFIXES` with (township forms mirror spec 2026-09-24 §6.2):

```python
_NAME_KEY_PREFIXES = (
    "city and county of ", "charter township of ", "township of ", "city of ", "town of ",
    "village of ", "county of ",
)
_NAME_KEY_SUFFIXES = (
    " county", " parish", " borough", " city", " town", " village", " charter township",
    " township", " twp",
)
```

2. Replace the final assertion of `test_level_buckets_sum_to_the_agency_count` — whichever line sums the buckets — with the five-bucket identity:

```python
    assert (
        stats["county"] + stats["city"] + stats["township"] + stats["special_district"] + stats["unknown"]
        == stats["agencies"]
    )
```

and the same replacement for the last assertion of `test_the_real_collaborators_resolve_with_their_contract_signatures`.

3. Append before `# --- CLI` (or at the end of the orchestration tests, before `def _run_cli`):

```python
# --- townships, towns and the name's own state (spec 2026-09-24 §6) ---------------------------

RYE_TOWN = agency("Town of Rye", "/new-york/townofrye", group="new-york", state_code="NY")
RYE_CITY = agency("City of Rye", "/new-york/cityofrye", group="new-york", state_code="NY")
BLOOMFIELD = agency("Charter Township of Bloomfield", "/mitn/bloomfieldtownship", group="mitn", state_code="MI")

TOWNSHIP_LEVELS = {
    "Town of Rye": "township",
    "City of Rye": "city",
    "Charter Township of Bloomfield": "township",
}
TOWNSHIP_ROWS = {
    ("township", "NY", "rye"): {"status": "exact", "geoid": "3611964320", "name": "Rye town"},
    ("city", "NY", "rye"): {"status": "exact", "geoid": "3664309", "name": "Rye city"},
    ("township", "MI", "bloomfield"): {
        "status": "exact",
        "geoid": "2612509180",
        "name": "Bloomfield charter township",
    },
}


def test_township_candidates_carry_the_census_type_word_in_their_id():
    response = run({}, [RYE_TOWN, BLOOMFIELD], levels=TOWNSHIP_LEVELS, rows=TOWNSHIP_ROWS)

    assert [
        (c["id"], c["issuerType"], c["jurisdictionLevel"], c["jurisdictionName"], c["fipsCode"])
        for c in response["candidates"]
    ] == [
        ("bidnet_ny_rye_town", "township", "township", "Rye town", "3611964320"),
        ("bidnet_mi_bloomfield_township", "township", "township", "Bloomfield charter township", "2612509180"),
    ]
    assert response["stats"]["township"] == 2


def test_a_town_and_a_city_of_the_same_name_get_distinct_ids():
    response = run({}, [RYE_CITY, RYE_TOWN], levels=TOWNSHIP_LEVELS, rows=TOWNSHIP_ROWS)

    assert [c["id"] for c in response["candidates"]] == ["bidnet_ny_rye", "bidnet_ny_rye_town"]


def test_township_is_a_default_level_and_can_be_left_out():
    default = run({}, [RYE_TOWN], levels=TOWNSHIP_LEVELS, rows=TOWNSHIP_ROWS)
    narrowed = run({"levels": ["county", "city"]}, [RYE_TOWN], levels=TOWNSHIP_LEVELS, rows=TOWNSHIP_ROWS)

    assert [c["id"] for c in default["candidates"]] == ["bidnet_ny_rye_town"]
    assert narrowed["candidates"] == []
    assert [entry["reason"] for entry in narrowed["review"]] == ["level_not_requested"]


def test_same_name_townships_go_to_review_never_guessed():
    richmond = agency("Richmond Township", "/mitn/richmondtownship", group="mitn", state_code="MI")
    rows = {
        ("township", "MI", "richmond"): {
            "status": "ambiguous",
            "candidates": [
                {"geoid": "2609968700", "name": "Richmond township"},
                {"geoid": "2610368720", "name": "Richmond township"},
            ],
        }
    }

    response = run({}, [richmond], levels={"Richmond Township": "township"}, rows=rows)

    assert response["candidates"] == []
    assert [(entry["reason"], entry["detail"]) for entry in response["review"]] == [
        ("ambiguous_match", "Richmond township (2609968700); Richmond township (2610368720)")
    ]
    assert (response["stats"]["township"], response["stats"]["unmatched"]) == (1, 1)


def test_a_trailing_state_is_matched_without_it_but_shown_with_it():
    dover = agency("Town of Dover, NY", "/new-york/townofdover", group="new-york", state_code="NY")
    rows = {("township", "NY", "dover"): {"status": "exact", "geoid": "3602720900", "name": "Dover town"}}
    calls = []

    response = run({}, [dover], levels={"Town of Dover": "township"}, rows=rows, classify_calls=calls)

    assert calls == [("Town of Dover", "NY")]
    (candidate,) = response["candidates"]
    assert candidate["id"] == "bidnet_ny_dover_town"
    assert candidate["label"] == "Town of Dover, NY (BidNet)"
    assert candidate["discovery"]["agencyName"] == "Town of Dover, NY"


LARAMIE = dict(
    agency(
        "Laramie County, Wyoming Government",
        "/colorado/laramiecountywyominggovernment",
        group="colorado",
        state_code="WY",
    ),
    state_source="name",
)


def test_the_candidate_says_where_its_state_came_from():
    rows = {
        **ROWS,
        ("county", "WY", "laramie county wyoming government"): {
            "status": "prefix",
            "geoid": "56021",
            "name": "Laramie County",
            "matched_prefix": "Laramie County",
        },
    }
    levels = {"Laramie County, Wyoming Government": "county", "Boulder County": "county"}

    response = run({}, [LARAMIE, BOULDER], levels=levels, rows=rows)

    assert [(c["stateCode"], c["discovery"]["stateSource"]) for c in response["candidates"]] == [
        ("WY", "name"),
        ("CO", "group"),
    ]


def test_laramie_gets_a_partial_suggestion_once_its_name_says_wyoming():
    existing = [
        {
            "id": "bidnet_wy_laramie",
            "label": "Laramie County, WY (BidNet)",
            "state_code": "WY",
            "base_url": "https://www.bidnetdirect.com/wyoming/laramiecounty/solicitations/open-bids",
            "jurisdiction_level": "county",
        }
    ]

    response = run(
        {"existing_sources": existing}, [LARAMIE], levels={"Laramie County, Wyoming Government": "county"}
    )

    assert response["existingMatches"] == [
        {
            "sourceId": "bidnet_wy_laramie",
            "agencyName": "Laramie County, Wyoming Government",
            "suggestedBaseUrl": LARAMIE["tenant_url"],
            "confidence": "partial",
        }
    ]


def test_a_township_source_is_confirmed_only_against_a_township_row():
    existing = [
        {
            "id": "bidnet_mi_bloomfield_township",
            "label": "Bloomfield Township (BidNet)",
            "state_code": "MI",
            "jurisdiction_level": "township",
        }
    ]
    township_row = agency("Bloomfield Township", "/mitn/bloomfieldtwp", group="mitn", state_code="MI")
    city_row = agency("City of Bloomfield", "/mitn/cityofbloomfield", group="mitn", state_code="MI")
    levels = {"Bloomfield Township": "township", "City of Bloomfield": "city"}

    confirmed = run({"existing_sources": existing}, [township_row], levels=levels)
    mismatched = run({"existing_sources": existing}, [city_row], levels=levels)

    assert confirmed["existingMatches"] == [
        {
            "sourceId": "bidnet_mi_bloomfield_township",
            "agencyName": "Bloomfield Township",
            "suggestedBaseUrl": township_row["tenant_url"],
            "confidence": "exact",
        }
    ]
    assert mismatched["existingMatches"] == [
        {
            "sourceId": "bidnet_mi_bloomfield_township",
            "agencyName": "City of Bloomfield",
            "suggestedBaseUrl": None,
            "confidence": "level_mismatch",
        }
    ]
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd crawler && python3 -m pytest -q tests/test_discover_sources_cli.py`
Expected: FAIL — `KeyError: 'township'` in stats, level `township` sent to review as `classified_township`, and missing `stateSource`.

- [x] **Step 3: Implement**

In `crawler/apsi_crawler/discovery_service.py`:

1. After `from urllib.parse import urlsplit` add:

```python
from apsi_crawler.us_states import strip_state_suffix
```

2. Replace the level constants with:

```python
#: Decision 3: only governments are registered -- counties, cities and (spec 2026-09-24 §6)
#: towns/townships. Everything else is reported.
CANDIDATE_LEVELS = ("county", "city", "township")
ALL_LEVELS = ("county", "city", "township", "special_district", "unknown")
```

3. After `_tokens` add:

```python
def _township_designation(census_name):
    """`town` for a Census "<X> town", `township` for "<X> township" / "<X> charter township".

    Spec 2026-09-24 §6.3: the type word goes into the id, so the Town of Rye never collides with
    the City of Rye as `bidnet_ny_rye_2`.
    """
    words = (census_name or "").casefold().split()
    return "town" if words and words[-1] == "town" else "township"
```

4. In `_existing_matches`, replace `tokens = _tokens(name_key(name)) if name else []` with:

```python
        tokens = _tokens(name_key(strip_state_suffix(name))) if name else []
```

5. In `discover_sources`, inside `for agency in agencies:` replace everything from `name = (agency.get("name") or "").strip()` down to (and including) `source_id = _unique_id(base_id, taken_ids)` with:

```python
        name = (agency.get("name") or "").strip()
        tenant_url = (agency.get("tenant_url") or "").strip()
        state_code = (agency.get("state_code") or "").strip().upper() or None
        # A trailing ", NY" says where the agency is (the harvester already took the state from
        # it, spec §6.4); it is not part of the jurisdiction's name, so everything that compares
        # names uses the name without it. `discovery.agencyName` and the label keep it.
        base_name = strip_state_suffix(name)

        # The state is not decoration: "borough" is a county equivalent in Alaska but an
        # ordinary municipality in NJ/PA/CT, and "Town of X" is a township only where towns are
        # civil townships, so the classifier needs it to get those right.
        level = classify(base_name, state_code) if base_name else "unknown"
        if level not in counts:
            level = "unknown"
        counts[level] += 1
        classified.append((agency, level))

        # Decision 3 lives here: special districts and unclassifiable rows are reported so a
        # person can fish one back out by hand, but they never become a registerable source.
        if level not in CANDIDATE_LEVELS:
            review.append(_review_entry(agency, "classified_{0}".format(level)))
            continue
        if level not in requested_levels:
            review.append(_review_entry(agency, "level_not_requested"))
            continue
        if not state_code:
            # Only reachable on an unfiltered run: a request carrying `states` makes the
            # harvester drop state-less agencies itself (`stats.unresolved_state_skipped`).
            review.append(
                _review_entry(
                    agency,
                    "unresolved_state",
                    "purchasing group {0!r} is not a state".format(agency.get("group")),
                )
            )
            continue

        segment = _id_segment(name_key(base_name))
        if not segment:
            review.append(_review_entry(agency, "unusable_name"))
            continue

        owner = registered.get(tenant_key(tenant_url))
        if owner is not None:
            duplicates += 1
            review.append(_review_entry(agency, "already_registered", owner))
            continue

        matched = match(level, state_code, base_name, table=jurisdictions) or {"status": "not_found"}
        confidence = MATCH_CONFIDENCE.get(matched.get("status"))
        if confidence is None:
            # Still no fuzzy fallback (spec §4.5): a wrong GEOID is worse than a missing one.
            # `prefix` is not fuzzy — it is an exact county name the agency name starts with.
            unmatched += 1
            review.append(
                _review_entry(
                    agency,
                    "ambiguous_match" if matched.get("status") == "ambiguous" else "no_fips_match",
                    _ambiguity_detail(matched),
                )
            )
            continue
        if matched.get("status") == "prefix":
            prefix_matched += 1

        if level == "township":
            segment = "{0}_{1}".format(segment, _township_designation(matched.get("name")))
        source_id = _unique_id(
            "{0}_{1}_{2}".format(platform, state_code.lower(), segment), taken_ids
        )
```

6. In the candidate's `"discovery"` dict add, after `"matchedPrefix": matched.get("matched_prefix"),`:

```python
                    # "name" when the agency wrote its state after a comma and that outranked
                    # the purchasing group (Laramie County, Wyoming under `colorado`).
                    "stateSource": agency.get("state_source") or "group",
```

7. In the returned `stats`, add after `"city": counts["city"],`:

```python
            "township": counts["township"],
```

8. In the module docstring, change `* `classify` — agency name -> county | city | special_district | unknown (contract C2)` to `* `classify` — agency name -> county | city | township | special_district | unknown (contract C2)`.

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd crawler && python3 -m pytest -q tests/test_discover_sources_cli.py tests/test_discovery_bidnet.py tests/test_jurisdictions.py`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add crawler/apsi_crawler/discovery_service.py crawler/tests/test_discover_sources_cli.py
git commit -m "feat(discovery): emit town and township candidates with type-word ids

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `source:register` holds back a tenant the reverse lookup suggests

**Files:**
- Modify: `frontend/scripts/register-sources.ts`
- Modify: `frontend/scripts/register-sources.test.ts`

**Interfaces:**
- Consumes: the `discover-sources` document's `existingMatches[]` (`{sourceId, agencyName, suggestedBaseUrl, confidence}`), unchanged.
- Produces: `CandidateFile.suggested: Map<string, string>` (tenant URL → existing source id, from `exact`/`partial` entries with a URL); `splitSuggestedCandidates(file, allowSuggested): { register: SourceCandidate[]; heldBack: HeldBackCandidate[] }`; CLI flag `--allow-suggested`.

- [x] **Step 1: Write the failing tests**

In `frontend/scripts/register-sources.test.ts`:

1. Add `splitSuggestedCandidates` to the import list from `./register-sources`.
2. Append:

```ts
const LARAMIE_TENANT = "https://www.bidnetdirect.com/colorado/laramiecountywyominggovernment/solicitations/open-bids";

function laramieDocument() {
  return {
    candidates: [
      candidate({
        id: "bidnet_wy_laramie_county_wyoming_government",
        label: "Laramie County, Wyoming Government (BidNet)",
        stateCode: "WY",
        baseUrl: LARAMIE_TENANT,
        jurisdictionName: "Laramie County",
        fipsCode: "56021",
        fetchConfig: { base_url: LARAMIE_TENANT },
      }),
      candidate(),
    ],
    review: [],
    existingMatches: [
      { sourceId: "bidnet_wy_laramie", agencyName: "Laramie County, Wyoming Government", suggestedBaseUrl: LARAMIE_TENANT, confidence: "partial" },
      { sourceId: "bidnet_oh_cuyahoga", agencyName: null, suggestedBaseUrl: null, confidence: "none" },
      { sourceId: "bidnet_co_boulder", agencyName: "City of Boulder", suggestedBaseUrl: null, confidence: "level_mismatch" },
    ],
    stats: { pages: 43, agencies: 2, stopped_reason: "exhausted" },
  };
}

describe("suggested tenants (spec 2026-09-24 §6.4)", () => {
  it("reads exact and partial suggestions from existingMatches, nothing else", () => {
    const file = parseCandidateFile(laramieDocument());

    expect([...file.suggested.entries()]).toEqual([[LARAMIE_TENANT, "bidnet_wy_laramie"]]);
    expect(parseCandidateFile([candidate()]).suggested.size).toBe(0);
  });

  it("holds back a candidate whose tenant should repoint an existing source", () => {
    const split = splitSuggestedCandidates(parseCandidateFile(laramieDocument()), false);

    expect(split.register.map((c) => c.id)).toEqual(["bidnet_co_denver"]);
    expect(split.heldBack).toEqual([
      { id: "bidnet_wy_laramie_county_wyoming_government", baseUrl: LARAMIE_TENANT, sourceId: "bidnet_wy_laramie" },
    ]);
  });

  it("registers it anyway when the operator says the suggestion is wrong", () => {
    const split = splitSuggestedCandidates(parseCandidateFile(laramieDocument()), true);

    expect(split.register).toHaveLength(2);
    expect(split.heldBack).toEqual([]);
  });
});
```

3. Inside `describe("register-sources CLI", ...)` append:

```ts
  it("names the source to repoint instead of registering a suggested tenant", () => {
    const held = dryRun(laramieDocument());
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("Dry run: 1 candidates");
    expect(held.stdout).toContain(
      "Held back bidnet_wy_laramie_county_wyoming_government: existingMatches suggests repointing bidnet_wy_laramie",
    );
    expect(held.stdout).toContain("PATCH /api/admin/data-sources/bidnet_wy_laramie");

    const allowed = dryRun(laramieDocument(), "--allow-suggested");
    expect(allowed.stdout).toContain("Dry run: 2 candidates");
    expect(allowed.stdout).not.toContain("Held back");
  });
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts`
Expected: FAIL — `splitSuggestedCandidates` is not exported / `suggested` undefined.

- [x] **Step 3: Implement**

In `frontend/scripts/register-sources.ts`:

1. Add to `CandidateFile` (after `discovery`):

```ts
  /**
   * Tenant URL -> existing source id, from `existingMatches` entries whose confidence is
   * `exact` or `partial` (the reverse lookup confirmed state and level). Empty for a bare array.
   */
  suggested: Map<string, string>;
```

2. Add before `parseCandidateFile`:

```ts
const CONFIRMED_SUGGESTIONS = new Set(["exact", "partial"]);

function suggestedTenants(existingMatches: unknown): Map<string, string> {
  const suggested = new Map<string, string>();
  if (!Array.isArray(existingMatches)) return suggested;
  for (const entry of existingMatches) {
    if (entry === null || typeof entry !== "object") continue;
    const { sourceId, suggestedBaseUrl, confidence } = entry as Record<string, unknown>;
    if (
      typeof sourceId === "string" && typeof suggestedBaseUrl === "string" && suggestedBaseUrl &&
      typeof confidence === "string" && CONFIRMED_SUGGESTIONS.has(confidence) && !suggested.has(suggestedBaseUrl)
    ) {
      suggested.set(suggestedBaseUrl, sourceId);
    }
  }
  return suggested;
}
```

3. In `parseCandidateFile`: declare `let suggested = new Map<string, string>();` next to `let discovery …`; in the document branch widen the cast to `{ candidates: unknown[]; review?: unknown; stats?: unknown; existingMatches?: unknown }` and add `suggested = suggestedTenants(document.existingMatches);`; return `{ candidates: list as SourceCandidate[], discovery, suggested }`.

4. Add after `partialDiscoveryRefusal`:

```ts
export interface HeldBackCandidate {
  id: string;
  baseUrl: string;
  sourceId: string;
}

/**
 * Spec 2026-09-24 §6.4: when the reverse lookup suggests repointing an existing source at a
 * tenant (Laramie County, WY: `bidnet_wy_laramie` onto the tenant BidNet files under
 * `colorado`), that tenant must not ALSO be registered under a new id. Held-back candidates are
 * reported, never written; `--allow-suggested` registers them when the suggestion is wrong.
 */
export function splitSuggestedCandidates(
  file: CandidateFile,
  allowSuggested: boolean,
): { register: SourceCandidate[]; heldBack: HeldBackCandidate[] } {
  if (allowSuggested || file.suggested.size === 0) return { register: file.candidates, heldBack: [] };
  const register: SourceCandidate[] = [];
  const heldBack: HeldBackCandidate[] = [];
  for (const c of file.candidates) {
    const sourceId = file.suggested.get(c.baseUrl);
    if (sourceId) heldBack.push({ id: c.id, baseUrl: c.baseUrl, sourceId });
    else register.push(c);
  }
  return { register, heldBack };
}

function heldBackLine(held: HeldBackCandidate): string {
  return (
    `Held back ${held.id}: existingMatches suggests repointing ${held.sourceId} to ${held.baseUrl} -- ` +
    `PATCH /api/admin/data-sources/${held.sourceId} instead, or pass --allow-suggested to register it as a new source.`
  );
}
```

5. In `main`:
   - Change the usage string to `"Usage: npx tsx scripts/register-sources.ts --file candidates.json [--dry-run] [--allow-partial] [--allow-suggested]"`.
   - After `const allowPartial = …` add `const allowSuggested = args.includes("--allow-suggested");`.
   - Replace `const { candidates } = file;` with:

```ts
  const { register: candidates, heldBack } = splitSuggestedCandidates(file, allowSuggested);
```

   - Right after `console.log(describeCandidateFile(file));` add:

```ts
  for (const held of heldBack) console.log(heldBackLine(held));
```

(The dry-run and real-run branches already iterate `candidates`, which is now the registerable subset.)

- [x] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run scripts/register-sources.test.ts && npm run lint`
Expected: PASS; lint clean.

- [x] **Step 5: Commit**

```bash
git add frontend/scripts/register-sources.ts frontend/scripts/register-sources.test.ts
git commit -m "feat(sources): hold back a discovered tenant that should repoint an existing source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Regenerate the bundled Census table with county subdivisions

**Files:**
- Modify: `crawler/data/us_jurisdictions.tsv` (regenerated by the script — never hand-edited)
- Modify: `crawler/tests/test_jurisdictions.py` (the `# --- the committed table` section only)
- Modify: `crawler/tests/test_discover_sources_cli.py` (`test_the_real_collaborators_resolve_with_their_contract_signatures` only)

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- Produces: the committed table with `cousub` rows; real-data tests for the eleven New York towns (spec §12.2 phase 2).

**Precondition (controller):** this task downloads three public files from `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/` — `2024_Gaz_counties_national.zip` (≈142 KB), `2024_Gaz_place_national.zip` (≈1.2 MB), `2024_Gaz_cousubs_national.zip` (≈1.5 MB). The controller obtains the user's approval before dispatching it.

- [x] **Step 1: Regenerate**

Run: `cd crawler && python3 scripts/refresh_jurisdictions.py`
Expected output includes `counties: 3222 rows in, 3222 kept` (or the 2024 file's count), the `places:` line with the same kept count as before (19512), a `cousubs:` line, and `changes against the committed table`: `added` = the new cousub rows only, `removed: 0`, `renamed: 0`. If any county/place row is removed or renamed, stop and report — that means the counties/places files changed upstream.

Verify the Census columns the filter relies on:

```bash
cd crawler && python3 - <<'EOF'
import io, zipfile, urllib.request
from pathlib import Path
EOF
grep -c '^cousub' data/us_jurisdictions.tsv
grep -E '^cousub\s+36[0-9]{8}\s+NY\s+Rye town' data/us_jurisdictions.tsv
```

Expected: a cousub count between 12000 and 20000, and one `Rye town` row. Record the exact count in the report.

- [x] **Step 2: Update the committed-table tests**

In `crawler/tests/test_jurisdictions.py`:

1. In `test_bundled_table_header_records_its_provenance` add:

```python
    assert "2024_Gaz_cousubs_national.zip" in header
    assert "cousub_filter:" in header
```

2. In `test_bundled_table_keys_agree_with_name_key` change `for level in ("county", "place"):` to `for level in ("county", "place", "cousub"):`.

3. Append after `test_bundled_table_is_the_default_when_no_table_is_passed`:

```python
def test_bundled_table_covers_active_towns_and_townships(bundled_table):
    cousubs = [entry for rows in bundled_table["cousub"].values() for entry in rows]
    assert 12000 <= len(cousubs) <= 20000
    assert all(len(entry["geoid"]) == 10 for entry in cousubs)
    assert all(entry["name"].endswith((" town", " township")) for entry in cousubs)


@pytest.mark.parametrize(
    "town",
    ["Clinton", "Colonie", "DeRuyter", "Ithaca", "Mamaroneck", "New Paltz", "Newburgh",
     "Ossining", "Pawling", "Rye", "Tupper Lake"],
)
def test_bundled_table_resolves_the_eleven_new_york_towns_to_towns(town, bundled_table):
    """Spec 2026-09-24 §1: all eleven used to match a same-name village or city (7-digit GEOID).

    A town either resolves to its 10-digit county-subdivision GEOID or, when New York has
    several towns of that name (Clinton), comes back ambiguous with only towns to choose from.
    """
    result = match_jurisdiction("township", "NY", "Town of {0}".format(town), bundled_table)
    rows = [result] if result["status"] == "exact" else result.get("candidates", [])

    assert rows, result
    for row in rows:
        assert row["name"] == "{0} town".format(town)
        assert len(row["geoid"]) == 10 and row["geoid"].startswith("36")


def test_bundled_table_answers_the_spec_examples(bundled_table):
    # Westchester County is 36119.
    rye = match_jurisdiction("township", "NY", "Town of Rye", bundled_table)
    assert rye["status"] == "exact" and rye["geoid"].startswith("36119")
    # Only a charter township answers a name that says "Charter".
    for name in ("Charter Township of Clinton", "Delta Charter Township"):
        result = match_jurisdiction("township", "MI", name, bundled_table)
        assert result["status"] == "exact", (name, result)
        assert result["name"].endswith(" charter township")
    # Michigan has several Richmond townships and the directory gives no county: never guessed.
    assert match_jurisdiction("township", "MI", "Richmond Township", bundled_table)["status"] == "ambiguous"
```

If an assertion here disagrees with the generated table (for example Census spells a town differently), do not weaken it: stop and report the actual TSV row(s) (`grep -i '<name>' data/us_jurisdictions.tsv`).

- [x] **Step 3: Add a township to the real-collaborator discovery test**

In `crawler/tests/test_discover_sources_cli.py`, `test_the_real_collaborators_resolve_with_their_contract_signatures`:
- append `agency("Town of Rye", "/new-york/townofrye", group="new-york", state_code="NY"),` to `agencies` (just before the Columbus school district);
- replace the candidate-list assertion with:

```python
    rows = [
        (c["id"], c["jurisdictionLevel"], c["fipsCode"], c["discovery"]["confidence"])
        for c in response["candidates"]
    ]
    assert rows[:4] == [
        ("bidnet_oh_cuyahoga", "county", "39035", "exact"),
        ("bidnet_co_aurora", "city", "0804000", "exact"),
        ("bidnet_oh_franklin_county_children_services", "county", "39049", "jurisdiction_prefix"),
        ("bidnet_nj_freehold", "city", "3425200", "exact"),
    ]
    rye_id, rye_level, rye_fips, rye_confidence = rows[4]
    assert (rye_id, rye_level, rye_confidence) == ("bidnet_ny_rye_town", "township", "exact")
    assert rye_fips.startswith("36119") and len(rye_fips) == 10
    assert response["candidates"][4]["jurisdictionName"] == "Rye town"
```

and change `stats["prefix_matched"] == 1` context: keep it; add `assert stats["township"] == 1`.

- [x] **Step 4: Run the tests**

Run: `cd crawler && python3 -m pytest -q`
Expected: PASS (whole crawler suite).

- [x] **Step 5: Commit**

```bash
git add crawler/data/us_jurisdictions.tsv crawler/tests/test_jurisdictions.py crawler/tests/test_discover_sources_cli.py
git commit -m "feat(discovery): bundle Census town and township subdivisions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/operations/source-discovery.md` (Chinese, like the rest of the runbook)
- Modify: `CLAUDE.md` (the "Source discovery (upstream of all that)" paragraph)
- Modify: `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` (§6 implementation notes)

**Interfaces:**
- Consumes: Tasks 1–7 as built. Verify every fact against the code before writing it.

- [x] **Step 1: Runbook**

In `docs/operations/source-discovery.md`:
1. §3 request table: `levels` default `["county","city","township"]`, allowed values county / city / township.
2. §3 `stats`: add the `township` bucket and restate the identity as `county + city + township + special_district + unknown == agencies`; add `discovery.stateSource` (`"name"` / `"group"`) to the candidate description.
3. §6 classification: the priority table with the `township` row (township/twp in any state; `town of …` / `… town` only in NY, CT, ME, MA, NH, RI, VT, WI; elsewhere a town stays `city`); the cross-state rule (only "comma + state name/USPS code", `, Washington County` is not a state, two different states → group wins) and the trailing-state rule (`Town of Dover, NY` is matched as `Town of Dover`).
4. §6 FIPS matching: township → `cousub` rows only, same state, exact; `Charter` → only charter townships; no prefix rule; same-name townships in one state → `ambiguous_match` (MI Richmond Township; NY Town of Clinton).
5. §6 id rule: `bidnet_<州>_<name_key>_<town|township>`, with the Rye town/city example.
6. §7 (the four 2026-09-16 sources): Laramie County, WY is `Laramie County, Wyoming Government` under the colorado group; the reverse lookup now gives `bidnet_wy_laramie` a `partial` suggestion; repoint that row (PATCH `base_url`, re-run the precheck); `source:register` holds back the discovered Laramie candidate and prints the PATCH to make; `--allow-suggested` overrides a wrong suggestion (e.g. a department that is a separate buyer).
7. §9 refresh: three gazetteers, the `--cousubs-zip` flag, the cousub filter (FUNCSTAT A + name suffix), the header lines.
8. §10 boundaries / known limitations: `Charter Township of Port Huron` → `special_district` (whole word `port`); Utah metro townships are places, not county subdivisions → review; the five Utah metro-township place keys changed (`kearns metro`).

- [x] **Step 2: CLAUDE.md**

In the "Source discovery (upstream of all that)" paragraph: classification now `county | city | township | special_district | unknown`; township/town rules; the Census table carries `cousub` rows (active towns/townships) next to counties and places; township ids carry `_town`/`_township`; a state written after a comma outranks the purchasing group (`discovery.stateSource`) and a trailing ", XX" is not part of the matched name; stats identity with five buckets; `source:register` holds back tenants suggested for an existing source unless `--allow-suggested`. One paragraph, concise.

- [x] **Step 3: Spec notes**

In `docs/superpowers/specs/2026-09-24-county-data-completeness-design.md` §6, add a short "实施补充（阶段 2）" list: the trailing-state rule; the register guard; §6.2's "no names end in these words" corrected (five Utah metro-township places change key); the two known limitations.

- [x] **Step 4: Commit**

```bash
git add docs/operations/source-discovery.md CLAUDE.md docs/superpowers/specs/2026-09-24-county-data-completeness-design.md
git commit -m "docs: record township discovery, cross-state names and the suggested-tenant guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Verification and the phase-2 discovery run (controller only)

- [x] **Step 1: Gates**

```bash
cd crawler && python3 -m pytest -q
cd ../frontend && npm run test && npm run lint
```
Expected: all pass.

- [x] **Step 2: Build `existing_sources` from the local MySQL (read-only)**

```bash
docker exec winbids-mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" winbids -N -e "SELECT JSON_ARRAYAGG(JSON_OBJECT(\"id\", id, \"label\", label, \"state_code\", state_code, \"base_url\", base_url, \"jurisdiction_level\", jurisdiction_level)) FROM data_sources WHERE provider_family = \"bidnet\""' 2>/dev/null > /tmp/existing.json
```
Write the request `{"platform": "bidnet", "existing_sources": <that array>}` to `ops-evidence/bidnet-discovery-<date>.request.json`.

- [x] **Step 3: Run discovery (read-only, ~45 requests at 3 s)**

No crawl or precheck may run against BidNet at the same time.

```bash
cd crawler && python3 -m apsi_crawler.cli discover-sources < ../ops-evidence/bidnet-discovery-<date>.request.json > ../ops-evidence/bidnet-discovery-<date>.json
```
Expected: exit 0, `stats.stopped_reason == "exhausted"`. On `waf_challenge`: stop, wait, do not retry immediately.

- [x] **Step 4: Acceptance (spec §12.2, phase 2)**

From the output JSON, record:
- `stats` (all buckets; the five-bucket identity holds);
- township candidates: total, how many are `…_town` vs `…_township`, per state;
- township review rows by reason (`ambiguous_match`, `no_fips_match`);
- the eleven New York towns: each either a `township` candidate with a 10-digit `36…` GEOID or an `ambiguous_match` among towns — none matched to a village/city;
- `existingMatches` for `bidnet_wy_laramie`: a `partial` entry with a `suggestedBaseUrl`;
- candidates with `discovery.stateSource == "name"`.

Compare with the 2026-09-21 archive (80 townships and ~70 towns were `classified_unknown` / `no_fips_match`).

- [x] **Step 5: Record and commit**

Add a "第二轮实测（阶段 2，<date>）" section to `docs/operations/source-discovery.md` with the numbers above, then:

```bash
git add docs/operations/source-discovery.md
git commit -m "docs: record the phase-2 discovery run

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Registering the candidates is phase 3; this phase does not write `data_sources`.

### Task 9a: Detector false positive (added 2026-09-28 by the controller)

- [x] BidNet's ordinary HTTP 200 pages now embed the AWS WAF SDK `<script src="https://….sdk.awswaf.com/…/challenge.js" defer>`, and `looks_like_waf_challenge` matched that URL, stopping every run at its first request. Fixed in 7fe5d73 — external script elements are stripped before marker matching, the real page is the fixture `bidnet_purchasing_groups_with_waf_sdk.html`, three tests (855 total) — with a comment follow-up in 1c90060. HTTP 202 and an inline integration script still stop the run.
