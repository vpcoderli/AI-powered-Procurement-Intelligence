"""Census county/place lookup for discovered agencies (contract C2, spec sections 4.4 and 4.5).

Pure functions over a table committed at `crawler/data/us_jurisdictions.tsv`; nothing here does
I/O beyond reading that file, and nothing imports `scripts/refresh_jurisdictions.py` (the refresh
script writes the table, runtime only reads it).

Two rules make this module boring on purpose:

* **No fuzzy matching.** A name normalizes to a key and that key either exists exactly, inside
  the one state we were given, or the answer is `not_found`. Two rows sharing a key in the same
  state come back `ambiguous` with both candidates rather than one of them being picked. A
  guessed GEOID would be copied into a registered source and never questioned again; a missing
  one just sends the agency to human review. The one non-exact answer, `prefix`, is structural
  rather than approximate: "Alameda County Public Works Agency" literally begins with "Alameda
  County", so the county is certain even though the buyer is a department of it — and it is
  reported under its own status so a reviewer never mistakes it for the county entity.
* **One normalizer for both sides.** The bundled table's `name_key` column and a directory name
  go through the same `name_key`, so "Oklahoma City city" (how Census spells it) and
  "City of Oklahoma City" (how a portal spells it) meet in the middle.
"""

import csv
import re
from pathlib import Path


__all__ = [
    "BUNDLED_TABLE_PATH",
    "JurisdictionTableError",
    "classify_agency",
    "load_jurisdictions",
    "match_jurisdiction",
    "name_key",
]


# apsi_crawler/jurisdictions/__init__.py -> apsi_crawler -> crawler
BUNDLED_TABLE_PATH = Path(__file__).resolve().parents[2] / "data" / "us_jurisdictions.tsv"

TABLE_COLUMNS = ("level", "geoid", "state", "name", "name_key")
_REQUIRED_COLUMNS = ("level", "geoid", "state", "name")
_TABLE_LEVELS = ("county", "place")


class JurisdictionTableError(Exception):
    """The bundled/supplied TSV is missing or is not the table this module expects."""


# --- normalization (spec 4.5) ---------------------------------------------------------------

# Apostrophes close up ("Sheriff's" -> "sheriffs"); every other non-alphanumeric character
# becomes a space, so "St. Louis" -> "st louis" and "Water & Sewer" -> "water sewer".
_APOSTROPHES = "'‘’ʼ´`"

# Longest first: "city and county of" must win over a bare "city of" test. `borough of` is here
# because the New Jersey group spells its municipalities that way ("Borough of Alpha"), and the
# gazetteer spells the same place "Alpha borough" -> both reduce to `alpha`. No Census name in
# the bundled table starts with "Borough of", so nothing on the table side changes.
_LEADING_FORMS = (
    "city and county of", "county of", "city of", "town of", "village of", "borough of",
)

# Exactly the six designators from spec 4.5, and only where they TRAIL: "Franklin County
# Children Services" keeps its "county" and therefore never matches Franklin County, which is
# the intended outcome (a children-services board is not the county government).
#
# They are stripped repeatedly, not once, because the gazetteer appends the type word to a name
# that may already end in one: "Atlantic City city", "Oklahoma City city", "Salt Lake City city".
# Stripping once leaves `atlantic city` on the Census side against `atlantic` from a directory
# that just says "Atlantic City", so every US city whose name ends in "City" would silently
# never match (9 of 12 spot-checked lookups). Repeating costs 22 extra colliding keys out of
# 19,512 places (`Lake City` vs `Lake Village` in AR, `Mason City` vs `Mason` in IL, ...) — and a
# collision is reported as `ambiguous`, never resolved by guessing, so nothing is mismatched.
_TRAILING_DESIGNATORS = ("county", "parish", "borough", "city", "town", "village")


def _normalized(value):
    """Lowercase, apostrophes removed, every other punctuation mark folded to a single space."""
    if not isinstance(value, str):
        return ""
    stripped = "".join("" if character in _APOSTROPHES else character for character in value)
    return " ".join(
        "".join(character if character.isalnum() else " " for character in stripped).casefold().split()
    )


def name_key(value):
    """The comparison key for a jurisdiction or agency name.

    Lowercase, punctuation folded, whitespace collapsed, one leading `city of`/`town of`/
    `village of`/`county of`/`city and county of` removed, then every trailing designator
    removed, so "Oklahoma City city" (Census), "Oklahoma City" and "City of Oklahoma City" all
    reduce to `oklahoma`.

    Abbreviations are never expanded: `St. Louis County` -> `st louis`, `Saint Louis County` ->
    `saint louis`. Census spells it "St.", so a portal that spells it out lands in review rather
    than on a guessed GEOID. Accents are kept for the same reason (`Doña Ana County` ->
    `doña ana`).
    """
    text = _normalized(value)
    for leading in _LEADING_FORMS:
        if text.startswith(leading + " "):
            text = text[len(leading) + 1:]
            break
    words = text.split()
    while words and words[-1] in _TRAILING_DESIGNATORS:
        words.pop()
    return " ".join(words)


# --- classification (spec 4.4) --------------------------------------------------------------

# Whole words only: "Airport" is not a `port`, "Transportation" is not `transit`, "Freeport" is
# not a port authority. Plurals are spelled out because the directory prints both ("Adrian
# Public Schools", "Bob Hope School").
_SPECIAL_DISTRICT_RE = re.compile(
    r"\b(?:"
    r"schools?|districts?|authority|authorities|library|libraries|fire|water|sanitation|"
    r"transit|colleges?|university|universities|ports?|housing|conservancy|conservancies|"
    r"metropolitan|board of"
    r")\b"
)

# `parish` is a county equivalent in Louisiana unconditionally. `borough` is one ONLY in Alaska:
# New Jersey, Pennsylvania and Connecticut use "borough" for ordinary municipalities, and 9 of
# the 20 county-classified names on the two saved directory pages are NJ boroughs. Calling those
# counties is wrong twice over — the county lookup fails AND the place lookup that would have
# succeeded never runs — so outside Alaska a borough is a city signal.
_COUNTY_RE = re.compile(r"\b(?:county|parish)\b")
_BOROUGH_RE = re.compile(r"\bborough\b")

_CITY_LEADING_RE = re.compile(r"^(?:city|town|village|borough) of\b")
_CITY_TRAILING_RE = re.compile(r"\b(?:city|town|village)$")


def classify_agency(name, state_code=None):
    """`"county"` | `"city"` | `"special_district"` | `"unknown"` for a directory agency name.

    Priority is top-down per spec 4.4, so a special-district word beats everything ("Aiken County
    Public Schools" is a school district, not a county) and `county` beats `city` ("City and
    County of Denver ..." is a county, matching the existing `bidnet_co_denver` row).

    `state_code` is optional and only decides how `borough` reads. With the state unknown a
    borough is treated as a city, because an unmatched city merely goes to review while a wrong
    county classification also blocks the lookup that would have worked.
    """
    text = _normalized(name)
    if not text:
        return "unknown"
    if _SPECIAL_DISTRICT_RE.search(text):
        return "special_district"
    alaska = isinstance(state_code, str) and state_code.strip().upper() == "AK"
    if _COUNTY_RE.search(text) or (alaska and _BOROUGH_RE.search(text)):
        return "county"
    if _CITY_LEADING_RE.search(text) or _CITY_TRAILING_RE.search(text):
        return "city"
    if not alaska and _BOROUGH_RE.search(text):
        return "city"
    return "unknown"


# --- the table ------------------------------------------------------------------------------


def load_jurisdictions(path=None):
    """Read the TSV into `{"county": {(state, key): [row, ...]}, "place": {...}}`.

    Rows are grouped in a list per key, never overwritten, so a key shared by two places in one
    state stays visible to `match_jurisdiction` as an ambiguity instead of silently resolving to
    whichever row was read last. `#` header comments and unknown extra columns are ignored, so
    the refresh script can keep recording its provenance at the top of the file.
    """
    resolved = Path(path) if path is not None else BUNDLED_TABLE_PATH
    try:
        text = resolved.read_text(encoding="utf-8")
    except OSError as error:
        raise JurisdictionTableError("cannot read jurisdiction table {0}: {1}".format(resolved, error))

    reader = csv.DictReader(
        [line for line in text.splitlines() if line.strip() and not line.startswith("#")],
        delimiter="\t",
    )
    fieldnames = reader.fieldnames or []
    missing = [column for column in _REQUIRED_COLUMNS if column not in fieldnames]
    if missing:
        raise JurisdictionTableError(
            "jurisdiction table {0} is missing column(s): {1}".format(resolved, ", ".join(missing))
        )

    table = dict((level, {}) for level in _TABLE_LEVELS)
    for row in reader:
        level = (row.get("level") or "").strip().lower()
        if level not in table:
            continue
        state = (row.get("state") or "").strip().upper()
        geoid = (row.get("geoid") or "").strip()
        name = (row.get("name") or "").strip()
        key = (row.get("name_key") or "").strip() or name_key(name)
        if not state or not geoid or not key:
            continue
        table[level].setdefault((state, key), []).append(
            {"level": level, "geoid": geoid, "state": state, "name": name, "name_key": key}
        )

    for level_rows in table.values():
        for entries in level_rows.values():
            entries.sort(key=lambda entry: (entry["geoid"], entry["name"]))
    return table


_DEFAULT_TABLE = None


def _default_table():
    global _DEFAULT_TABLE
    if _DEFAULT_TABLE is None:
        _DEFAULT_TABLE = load_jurisdictions()
    return _DEFAULT_TABLE


_LEVEL_TABLES = {"county": "county", "city": "place"}

# "<X> County ..." / "<X> Parish ...", capturing through the designator. Anchored at the start,
# so only a name that OPENS with the jurisdiction qualifies; "Board of Water Works of Pueblo
# County" would not, and never reaches here anyway (special district).
_COUNTY_PREFIX_RE = re.compile(r"^(.+?\b(?:county|parish))\b", re.I)


def _prefix_match(state, name, table):
    """A county department: the name begins with a county that resolves uniquely in this state.

    Structural, not fuzzy — "Alameda County Public Works Agency" literally opens with "Alameda
    County". It answers under its own `prefix` status so a reviewer can see that the buyer is a
    department of the county rather than the county entity, and it refuses to guess: if the
    prefix hits zero or several county rows (MD "Baltimore County ..." hits both the county and
    the independent city) the answer stays `not_found`.
    """
    if not isinstance(name, str):
        return None
    match = _COUNTY_PREFIX_RE.match(" ".join(name.split()))
    if not match:
        return None
    prefix = match.group(1)
    key = name_key(prefix)
    if not key:
        return None
    entries = table.get("county", {}).get((state, key))
    if not entries or len(entries) != 1:
        return None
    return {
        "status": "prefix",
        "geoid": entries[0]["geoid"],
        "name": entries[0]["name"],
        "matched_prefix": prefix,
    }


def match_jurisdiction(level, state_code, name, table=None, allow_prefix=True):
    """Exact, state-scoped lookup of an agency name.

    `{"status": "exact", "geoid", "name"}` when exactly one row in that state carries the key,
    `{"status": "ambiguous", "candidates": [{"geoid", "name"}, ...]}` when several do, and
    `{"status": "not_found"}` otherwise — including when the state code or the name is empty.

    When nothing matches exactly and `level` is `"county"`, a county department is still
    resolvable from the jurisdiction its name opens with: `{"status": "prefix", "geoid", "name",
    "matched_prefix"}`. Pass `allow_prefix=False` for exact-only behaviour. Cities never get a
    prefix rule — "Aurora Public Schools" opening with "Aurora" proves nothing about the buyer.
    """
    try:
        level_table = _LEVEL_TABLES[level]
    except (KeyError, TypeError):
        raise ValueError("level must be 'county' or 'city', got {0!r}".format(level))

    state = state_code.strip().upper() if isinstance(state_code, str) else ""
    key = name_key(name)
    if not state or not key:
        return {"status": "not_found"}

    resolved = table if table is not None else _default_table()
    entries = resolved.get(level_table, {}).get((state, key))
    if not entries:
        if allow_prefix and level_table == "county":
            return _prefix_match(state, name, resolved) or {"status": "not_found"}
        return {"status": "not_found"}
    if len(entries) > 1:
        return {
            "status": "ambiguous",
            "candidates": [{"geoid": entry["geoid"], "name": entry["name"]} for entry in entries],
        }
    return {"status": "exact", "geoid": entries[0]["geoid"], "name": entries[0]["name"]}
