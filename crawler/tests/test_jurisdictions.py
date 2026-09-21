"""Census jurisdiction table, name normalization, agency classification (contract C2).

The whole point of this module is that a GEOID is either provably right or absent. There is no
fuzzy matching anywhere: a key matches exactly inside one state or it does not match at all, and
two places sharing a key in one state come back `ambiguous` instead of one of them being picked.
A wrong FIPS code would be copied into a registered source and never questioned again.

Classification cases below are real agency names taken from the saved BidNet directory pages
(`tests/fixtures/discovery/bidnet_participating_buyers_page{1,2}.html`), because the rules only
have to work on the names the directory actually prints.
"""

import importlib.util
import re
import zipfile
from pathlib import Path

import pytest

from apsi_crawler.jurisdictions import (
    BUNDLED_TABLE_PATH,
    JurisdictionTableError,
    classify_agency,
    load_jurisdictions,
    match_jurisdiction,
    name_key,
)


CRAWLER_DIR = Path(__file__).resolve().parents[1]
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "jurisdictions"
SAMPLE_TABLE = FIXTURES_DIR / "sample_us_jurisdictions.tsv"
REFRESH_SCRIPT = CRAWLER_DIR / "scripts" / "refresh_jurisdictions.py"


@pytest.fixture(scope="module")
def sample_table():
    return load_jurisdictions(SAMPLE_TABLE)


@pytest.fixture(scope="module")
def bundled_table():
    return load_jurisdictions()


# --- name_key -----------------------------------------------------------------------------


def test_name_key_lowercases_folds_whitespace_and_drops_punctuation():
    assert name_key("  FRANKLIN   County ") == "franklin"
    assert name_key("Alamance-Burlington") == "alamance burlington"
    assert name_key("Bay County Department of Water & Sewer") == "bay county department of water sewer"
    # Apostrophes close up instead of splitting a word in two ("sheriffs", not "sheriff s").
    assert name_key("Archuleta County Sheriff's Office") == "archuleta county sheriffs office"


def test_name_key_strips_the_five_leading_forms():
    assert name_key("City of Aurora") == "aurora"
    assert name_key("Town of Cary") == "cary"
    assert name_key("Village of Oak Park") == "oak park"
    assert name_key("County of Los Angeles") == "los angeles"
    assert name_key("City and County of Denver") == "denver"


@pytest.mark.parametrize(
    "value,expected",
    [
        ("Adams County", "adams"),
        ("Orleans Parish", "orleans"),
        ("Matanuska-Susitna Borough", "matanuska susitna"),
        ("Aurora city", "aurora"),
        ("Athens town", "athens"),
        ("Bal Harbour Village", "bal harbour"),
    ],
)
def test_name_key_strips_one_trailing_designator(value, expected):
    assert name_key(value) == expected


@pytest.mark.parametrize(
    "census_name,portal_name,expected",
    [
        # Census appends the type word to a name that already ends in one; a directory does not.
        ("Oklahoma City city", "City of Oklahoma City", "oklahoma"),
        ("Atlantic City city", "Atlantic City", "atlantic"),
        ("Salt Lake City city", "Salt Lake City", "salt lake"),
        ("Bay City city", "City of Bay City", "bay"),
    ],
)
def test_name_key_strips_every_trailing_designator(census_name, portal_name, expected):
    """Stripping only once would leave every US city ending in "City" permanently unmatched."""
    assert name_key(census_name) == expected
    assert name_key(portal_name) == expected


def test_name_key_strips_a_leading_borough_of():
    """The NJ group writes "Borough of Alpha"; the gazetteer writes "Alpha borough"."""
    assert name_key("Borough of Alpha") == "alpha"
    assert name_key("Alpha borough") == "alpha"
    assert name_key("Borough of Englewood Cliffs") == name_key("Englewood Cliffs borough")


def test_name_key_keeps_a_designator_that_is_not_trailing():
    """Only a trailing designator goes (spec 4.5), so a department name keeps its county word."""
    assert name_key("Franklin County Children Services") == "franklin county children services"
    assert name_key("Alameda County Public Works Agency") == "alameda county public works agency"


def test_name_key_does_not_expand_abbreviations():
    """`St.` loses its period; it is never rewritten to `Saint` (that would be a guess)."""
    assert name_key("St. Louis County") == "st louis"
    assert name_key("Saint Louis County") == "saint louis"
    assert name_key("St. Louis County") != name_key("Saint Louis County")


def test_name_key_handles_empty_and_non_string_input():
    assert name_key("") == ""
    assert name_key(None) == ""
    assert name_key("County") == ""


# --- classify_agency ----------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        # Every one of these is printed verbatim by the saved BidNet directory pages.
        "Adams 12 Five Star Schools",
        "Adams County School District 14",
        "Adams State University",
        "Aiken County Public Schools",
        "Alachua County Housing Authority",
        "Alameda County Water District",
        "Albany County Airport Authority",
        "Albany Port District Commission",
        "Altadena Library District",
        "AIMS Community College",
        "Alfred University",
        "Ann Arbor Area Transportation Authority",
        "Arapahoe County Water & Wastewater Authority",
        "Arvada Fire Protection District",
        "Aurora Housing Authority",
        "Avondale Water and Sanitation District",
        "Barrington Area Library",
        "Berkeley Township Sewerage Authority",
        "Bexar Metropolitan Water District",
        "Big Horn County School District #1",
        "Big Sky Fire Department",
        "Bloomfield Township Public Library",
        "Blue Water Area Transportation Commission",
        "Board of Water Works of Pueblo",
        "Bob Hope School",
        "35th District Court",
    ],
)
def test_classifies_real_directory_special_districts(name):
    assert classify_agency(name) == "special_district"


@pytest.mark.parametrize(
    "name",
    [
        "Adams County",
        "Alamosa County",
        "Albany County",
        "Anderson County",
        "Arapahoe County",
        "Barton County",
        "Bay County",
        "Bexar County",
        "Boulder County",
        # A county department: no special-district word, so it stays county-level.
        "Alameda County Public Works Agency",
        "Archuleta County Sheriff's Office",
        # Both rules fire; spec 4.4 says county wins (matches the existing bidnet_co_denver row).
        "City and County of Denver General Services Purchasing",
        "Orleans Parish",
    ],
)
def test_classifies_real_directory_counties(name):
    assert classify_agency(name) == "county"


@pytest.mark.parametrize(
    "name",
    [
        "City of Aurora",
        "Atlantic City",
        "Bal Harbour Village",
        "Town of Cary",
        "Village of Oak Park",
    ],
)
def test_classifies_cities_towns_and_villages(name):
    assert classify_agency(name) == "city"


@pytest.mark.parametrize(
    "name",
    [
        "Athens",
        "Andover Township",
        "Bloomfield Township",
        "Augusta, GA",
        "BGIS Global Integrated Solutions US LLC",
        "Alliance of Rouge Communities",
        "Beacon Volunteer Ambulance Corps",
        "Auraria Higher Education Center - AHEC",
        "Boiling Spring Lakes",
        "",
        None,
    ],
)
def test_leaves_everything_else_unknown(name):
    assert classify_agency(name) == "unknown"


@pytest.mark.parametrize(
    "name",
    [
        # All nine are printed by the saved directory pages, all in the `new-jersey` group.
        "Borough of Alpha",
        "Borough of Bradley Beach",
        "Borough of Butler",
        "Borough of Caldwell",
        "Borough of Englewood Cliffs",
        "Borough of Fair Haven",
        "Borough of Franklin",
        "Borough of Jamesburg",
        "Borough of Leonia",
    ],
)
def test_a_borough_outside_alaska_is_a_municipality(name):
    assert classify_agency(name, "NJ") == "city"
    # With the state unknown, prefer city: review costs less than a blocked lookup.
    assert classify_agency(name) == "city"


@pytest.mark.parametrize(
    "name",
    ["Aleutians East Borough", "Kenai Peninsula Borough", "Juneau City and Borough"],
)
def test_a_borough_in_alaska_is_a_county_equivalent(name):
    assert classify_agency(name, "AK") == "county"
    assert classify_agency(name, "PA") == "city"


def test_parish_stays_a_county_signal_in_every_state():
    assert classify_agency("Orleans Parish", "LA") == "county"
    assert classify_agency("Orleans Parish") == "county"


def test_special_district_words_match_whole_words_only():
    """`Airport` must not read as `port`, `Transportation` must not read as `transit`."""
    assert classify_agency("Albany County Airport") == "county"
    assert classify_agency("Adams County Transportation Department") == "county"
    assert classify_agency("City of Freeport") == "city"


def test_special_district_beats_county_and_city():
    assert classify_agency("Aiken County Public Schools") == "special_district"
    assert classify_agency("City of Aurora Water Department") == "special_district"


# --- load_jurisdictions -------------------------------------------------------------------


def test_loader_skips_the_header_comment_and_ignores_unknown_columns(sample_table):
    assert set(sample_table) == {"county", "place"}
    entries = sample_table["county"][("OH", "franklin")]
    assert entries == [
        {"level": "county", "geoid": "39049", "state": "OH", "name": "Franklin County", "name_key": "franklin"}
    ]


def test_loader_keeps_leading_zeros_in_geoids(sample_table):
    assert sample_table["county"][("CO", "boulder")][0]["geoid"] == "08013"
    assert sample_table["place"][("CO", "aurora")][0]["geoid"] == "0804000"


def test_loader_groups_colliding_keys_instead_of_dropping_one(sample_table):
    assert [entry["name"] for entry in sample_table["place"][("TN", "athens")]] == [
        "Athens city",
        "Athens town",
    ]


def test_loader_reports_a_missing_table():
    with pytest.raises(JurisdictionTableError):
        load_jurisdictions(FIXTURES_DIR / "does_not_exist.tsv")


def test_loader_rejects_a_table_without_the_required_columns(tmp_path):
    broken = tmp_path / "broken.tsv"
    broken.write_text("# comment\nlevel\tgeoid\n county\t39049\n", encoding="utf-8")

    with pytest.raises(JurisdictionTableError):
        load_jurisdictions(broken)


# --- match_jurisdiction -------------------------------------------------------------------


def test_matches_a_county_exactly(sample_table):
    assert match_jurisdiction("county", "OH", "Franklin County", sample_table) == {
        "status": "exact",
        "geoid": "39049",
        "name": "Franklin County",
    }


def test_matches_a_city_against_the_place_table(sample_table):
    assert match_jurisdiction("city", "CO", "City of Aurora", sample_table) == {
        "status": "exact",
        "geoid": "0804000",
        "name": "Aurora city",
    }


def test_matching_is_scoped_to_one_state(sample_table):
    """`Aurora` exists in CO and IL; each state answers with its own place, never the other."""
    assert match_jurisdiction("city", "IL", "City of Aurora", sample_table)["geoid"] == "1702154"
    assert match_jurisdiction("city", "GA", "City of Aurora", sample_table) == {"status": "not_found"}


def test_state_code_case_and_padding_do_not_matter(sample_table):
    assert match_jurisdiction("county", " oh ", "Franklin County", sample_table)["geoid"] == "39049"


def test_two_places_sharing_a_key_are_ambiguous_not_a_coin_flip(sample_table):
    assert match_jurisdiction("city", "TN", "Athens", sample_table) == {
        "status": "ambiguous",
        "candidates": [
            {"geoid": "4701520", "name": "Athens city"},
            {"geoid": "4701521", "name": "Athens town"},
        ],
    }


def test_unmatched_names_are_not_found_rather_than_approximated(sample_table):
    assert match_jurisdiction("county", "GA", "Cobb County", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("county", "MO", "Saint Louis County", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("county", "MO", "St. Louis County", sample_table)["geoid"] == "29189"


def test_a_county_name_is_never_answered_from_the_place_table(sample_table):
    """Denver is both a county row and a place row; the level decides which one answers."""
    assert match_jurisdiction("county", "CO", "City and County of Denver", sample_table)["geoid"] == "08031"
    assert match_jurisdiction("city", "CO", "City and County of Denver", sample_table)["geoid"] == "0820000"


def test_missing_state_or_name_is_not_found(sample_table):
    assert match_jurisdiction("county", None, "Franklin County", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("county", "OH", "", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("county", "OH", "County", sample_table) == {"status": "not_found"}


def test_a_county_department_resolves_through_its_jurisdiction_prefix(sample_table):
    """"Franklin County Children Services" is not Franklin County, but it is certainly IN it."""
    assert match_jurisdiction("county", "OH", "Franklin County Children Services", sample_table) == {
        "status": "prefix",
        "geoid": "39049",
        "name": "Franklin County",
        "matched_prefix": "Franklin County",
    }


def test_the_prefix_rule_can_be_turned_off(sample_table):
    assert match_jurisdiction(
        "county", "OH", "Franklin County Children Services", sample_table, allow_prefix=False
    ) == {"status": "not_found"}


def test_the_prefix_rule_refuses_an_ambiguous_jurisdiction(bundled_table):
    """MD "Baltimore County ..." opens with a name held by both the county and the city."""
    assert match_jurisdiction("county", "MD", "Baltimore County Public Works", bundled_table) == {
        "status": "not_found"
    }


@pytest.mark.parametrize(
    "state,name",
    [
        ("OH", "Franklin Children Services"),          # no designator at all
        ("GA", "Franklin County Children Services"),   # right shape, wrong state
        ("OH", "Services of Franklin County"),         # the jurisdiction does not open the name
    ],
)
def test_the_prefix_rule_needs_a_leading_jurisdiction_in_the_right_state(state, name, sample_table):
    assert match_jurisdiction("county", state, name, sample_table) == {"status": "not_found"}


def test_cities_never_get_a_prefix_rule(sample_table):
    """"Aurora Public Schools" opening with "Aurora" would say nothing about the buyer."""
    assert match_jurisdiction("city", "CO", "Aurora Public Schools", sample_table) == {"status": "not_found"}
    assert match_jurisdiction("city", "CA", "Alameda County Public Works Agency", sample_table) == {
        "status": "not_found"
    }


def test_an_unsupported_level_is_a_programming_error(sample_table):
    with pytest.raises(ValueError):
        match_jurisdiction("special_district", "OH", "Franklin County", sample_table)


# --- the committed table ------------------------------------------------------------------


def test_bundled_table_header_records_its_provenance():
    header = "".join(
        line for line in BUNDLED_TABLE_PATH.read_text(encoding="utf-8").splitlines(True) if line.startswith("#")
    )
    assert "2024_Gaz_counties_national.zip" in header
    assert "2024_Gaz_place_national.zip" in header
    assert "generated:" in header


def test_bundled_table_covers_every_county_and_only_incorporated_places(bundled_table):
    counties = bundled_table["county"]
    places = bundled_table["place"]
    # 3,144 county-equivalents nationally; the place file keeps ~19k incorporated places once the
    # ~10k CDPs are dropped.
    assert 3000 <= sum(len(rows) for rows in counties.values()) <= 3300
    assert 15000 <= sum(len(rows) for rows in places.values()) <= 25000
    assert not [
        entry["name"]
        for rows in places.values()
        for entry in rows
        if entry["name"].endswith(" CDP")
    ]


def test_bundled_table_keys_agree_with_name_key(bundled_table):
    for level in ("county", "place"):
        for (state, key), rows in bundled_table[level].items():
            assert len(state) == 2 and state.isupper()
            for entry in rows:
                assert entry["name_key"] == key == name_key(entry["name"])


def test_bundled_table_resolves_cities_whose_name_ends_in_city(bundled_table):
    """The reason `name_key` strips designators repeatedly — checked against the real table."""
    assert match_jurisdiction("city", "OK", "City of Oklahoma City", bundled_table)["geoid"] == "4055000"
    assert match_jurisdiction("city", "NJ", "Atlantic City", bundled_table)["geoid"] == "3402080"
    assert match_jurisdiction("city", "MO", "Kansas City", bundled_table)["geoid"] == "2938000"


def test_bundled_table_reports_independent_cities_as_ambiguous(bundled_table):
    """Baltimore/St. Louis are a county AND a coextensive independent city; a person must pick."""
    result = match_jurisdiction("county", "MD", "Baltimore County", bundled_table)
    assert result["status"] == "ambiguous"
    assert sorted(candidate["name"] for candidate in result["candidates"]) == [
        "Baltimore County",
        "Baltimore city",
    ]
    assert match_jurisdiction("county", "MO", "St. Louis County", bundled_table)["status"] == "ambiguous"


def test_bundled_table_resolves_every_new_jersey_borough_from_the_fixtures(bundled_table):
    expected = {
        "Borough of Alpha": "3401030",
        "Borough of Bradley Beach": "3406970",
        "Borough of Butler": "3409040",
        "Borough of Caldwell": "3409250",
        "Borough of Englewood Cliffs": "3421510",
        "Borough of Fair Haven": "3422440",
        "Borough of Franklin": "3424930",
        "Borough of Jamesburg": "3434890",
        "Borough of Leonia": "3440020",
    }
    resolved = {}
    for name in expected:
        assert classify_agency(name, "NJ") == "city"
        result = match_jurisdiction("city", "NJ", name, bundled_table)
        resolved[name] = result["geoid"] if result["status"] == "exact" else result["status"]
    assert resolved == expected


def test_bundled_table_resolves_real_county_departments_by_prefix(bundled_table):
    assert match_jurisdiction("county", "CA", "Alameda County Public Works Agency", bundled_table) == {
        "status": "prefix",
        "geoid": "06001",
        "name": "Alameda County",
        "matched_prefix": "Alameda County",
    }
    assert match_jurisdiction("county", "CO", "Archuleta County Sheriff's Office", bundled_table) == {
        "status": "prefix",
        "geoid": "08007",
        "name": "Archuleta County",
        "matched_prefix": "Archuleta County",
    }


def test_bundled_table_answers_the_two_worked_examples(bundled_table):
    assert match_jurisdiction("county", "OH", "Franklin County", bundled_table) == {
        "status": "exact",
        "geoid": "39049",
        "name": "Franklin County",
    }
    assert match_jurisdiction("city", "CO", "City of Aurora", bundled_table) == {
        "status": "exact",
        "geoid": "0804000",
        "name": "Aurora city",
    }


def test_bundled_table_is_the_default_when_no_table_is_passed():
    assert match_jurisdiction("county", "CO", "Boulder County")["geoid"] == "08013"
    assert match_jurisdiction("county", "TX", "Bexar County")["geoid"] == "48029"


# --- refresh script (offline, against local zips) -------------------------------------------


def _refresh_module():
    """Loaded by path on purpose: `scripts/` is not a package, and runtime must not import it."""
    spec = importlib.util.spec_from_file_location("refresh_jurisdictions", REFRESH_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _gazetteer_zip(path, columns, rows):
    """A gazetteer zip, headers and values padded the way the real Census files pad them."""
    lines = ["\t".join(column.ljust(12) for column in columns)]
    lines.extend("\t".join(str(value).ljust(12) for value in row) for row in rows)
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(path.stem + ".txt", "\n".join(lines) + "\n")
    return str(path)


COUNTY_COLUMNS = ("USPS", "GEOID", "ANSICODE", "NAME", "ALAND", "AWATER", "INTPTLAT", "INTPTLONG")
PLACE_COLUMNS = ("USPS", "GEOID", "ANSICODE", "NAME", "LSAD", "FUNCSTAT", "ALAND", "INTPTLAT")


@pytest.fixture
def gazetteers(tmp_path):
    counties = _gazetteer_zip(
        tmp_path / "counties.zip",
        COUNTY_COLUMNS,
        [
            ("OH", "39049", "1074044", "Franklin County", "1", "0", "39.9", "-83.0"),
            ("AK", "02110", "1419989", "Juneau City and Borough", "1", "0", "58.4", "-134.2"),
        ],
    )
    places = _gazetteer_zip(
        tmp_path / "places.zip",
        PLACE_COLUMNS,
        [
            ("CO", "0804000", "2409691", "Aurora city", "25", "A", "1", "39.7"),
            ("OK", "4055000", "2412194", "Oklahoma City city", "25", "A", "1", "35.4"),
            ("AK", "0203000", "1414951", "Anchorage municipality", "37", "A", "1", "61.1"),
            ("AL", "0100100", "2582661", "Abanda CDP", "57", "S", "1", "33.0"),
            ("PR", "7200180", "2632349", "Aceitunas comunidad", "55", "S", "1", "18.3"),
            ("PR", "7200334", "2632475", "Adjuntas zona urbana", "62", "S", "1", "18.1"),
            ("NY", "3656341", "0979529", "Parish village", "47", "A", "1", "43.4"),
        ],
    )
    return counties, places


def test_refresh_keeps_governmental_places_and_drops_statistical_ones(tmp_path, gazetteers, capsys):
    counties, places = gazetteers
    output = tmp_path / "us_jurisdictions.tsv"

    assert _refresh_module().main(["--counties-zip", counties, "--places-zip", places, "--output", str(output)]) == 0

    written = output.read_text(encoding="utf-8")
    assert "Aurora city" in written and "Anchorage municipality" in written
    # LSAD 57/55/62 are statistical geographies, not governments.
    for dropped in ("Abanda CDP", "Aceitunas comunidad", "Adjuntas zona urbana"):
        assert dropped not in written
    # A village literally named "Parish" normalizes to an empty key and cannot be indexed.
    assert "Parish village" not in written
    assert "skipped (no usable key): NY Parish village" in capsys.readouterr().out

    table = load_jurisdictions(output)
    assert match_jurisdiction("county", "OH", "Franklin County", table)["geoid"] == "39049"
    assert match_jurisdiction("city", "OK", "City of Oklahoma City", table)["geoid"] == "4055000"


def test_refresh_writes_the_provenance_header_and_trims_padded_columns(tmp_path, gazetteers):
    counties, places = gazetteers
    output = tmp_path / "us_jurisdictions.tsv"
    _refresh_module().main(["--counties-zip", counties, "--places-zip", places, "--output", str(output)])

    lines = output.read_text(encoding="utf-8").splitlines()
    header = [line for line in lines if line.startswith("#")]
    assert any("2024_Gaz_counties_national.zip" in line for line in header)
    assert any("2024_Gaz_place_national.zip" in line for line in header)
    assert any(line.startswith("# generated: ") for line in header)
    assert lines[len(header)] == "level\tgeoid\tstate\tname\tname_key"
    # No padding survives into the table.
    assert lines[len(header) + 1] == "county\t02110\tAK\tJuneau City and Borough\tjuneau city and"


def test_refresh_is_rerunnable_and_reports_what_changed(tmp_path, gazetteers, capsys):
    counties, places = gazetteers
    module = _refresh_module()
    output = tmp_path / "us_jurisdictions.tsv"
    module.main(["--counties-zip", counties, "--places-zip", places, "--output", str(output)])
    capsys.readouterr()

    next_places = _gazetteer_zip(
        tmp_path / "places2.zip",
        PLACE_COLUMNS,
        [
            ("CO", "0804000", "2409691", "Aurora town", "43", "A", "1", "39.7"),   # renamed
            ("AK", "0203000", "1414951", "Anchorage municipality", "37", "A", "1", "61.1"),
            ("TN", "4701520", "1226000", "Athens city", "25", "A", "1", "35.4"),   # added
        ],                                                                          # Oklahoma City removed
    )
    module.main(["--counties-zip", counties, "--places-zip", next_places, "--output", str(output)])

    printed = capsys.readouterr().out
    assert "added: 1" in printed and "place 4701520" in printed
    assert "removed: 1" in printed and "place 4055000" in printed
    assert "renamed: 1" in printed and "Aurora city -> Aurora town" in printed
    assert load_jurisdictions(output)["place"][("CO", "aurora")][0]["name"] == "Aurora town"


def test_refresh_dry_run_leaves_the_table_alone(tmp_path, gazetteers):
    counties, places = gazetteers
    module = _refresh_module()
    output = tmp_path / "us_jurisdictions.tsv"
    module.main(["--counties-zip", counties, "--places-zip", places, "--output", str(output)])
    before = output.read_text(encoding="utf-8")

    module.main(["--counties-zip", counties, "--places-zip", places, "--output", str(output), "--dry-run"])

    assert output.read_text(encoding="utf-8") == before


def test_runtime_code_never_imports_the_refresh_script():
    """The script imports the package, never the other way round; runtime only reads the TSV."""
    import_line = re.compile(r"^\s*(?:from|import)\b.*\brefresh_jurisdictions\b", re.M)
    offenders = [
        str(path.relative_to(CRAWLER_DIR))
        for path in (CRAWLER_DIR / "apsi_crawler").rglob("*.py")
        if import_line.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []
