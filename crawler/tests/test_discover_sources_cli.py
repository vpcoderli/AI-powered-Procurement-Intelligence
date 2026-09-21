"""`python -m apsi_crawler.cli discover-sources` contract (C3) + candidate assembly.

Task A's `harvest_bidnet` and Task B's `classify_agency` / `match_jurisdiction` / `name_key`
are injected as fakes here, so this suite pins the orchestration and the wire format on its
own. The fakes deliberately mirror the real contracts (C1, C2) rather than simplifying them.
"""

import io
import json
import re

import pytest

from apsi_crawler import cli
from apsi_crawler.discovery_service import (
    InvalidSourceDiscoveryRequestError,
    discover_sources,
)


# The ten fields `frontend/scripts/register-sources.ts` declares on `SourceCandidate`.
# `frontend/scripts/register-sources.test.ts` asserts the Node side of the same contract.
SOURCE_CANDIDATE_FIELDS = {
    "id",
    "label",
    "issuerType",
    "stateCode",
    "baseUrl",
    "jurisdictionLevel",
    "jurisdictionName",
    "fipsCode",
    "providerFamily",
    "cadence",
    "fetchConfig",
}

_NAME_KEY_PREFIXES = ("city and county of ", "city of ", "town of ", "village of ", "county of ")
_NAME_KEY_SUFFIXES = (" county", " parish", " borough", " city", " town", " village")


def fake_name_key(value):
    """Stand-in for Task B's `name_key` — spec §4.5 normalization, written independently."""
    key = " ".join(re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).split())
    for prefix in _NAME_KEY_PREFIXES:
        if key.startswith(prefix):
            key = key[len(prefix):]
            break
    for suffix in _NAME_KEY_SUFFIXES:
        if key.endswith(suffix):
            key = key[: -len(suffix)]
            break
    return " ".join(key.split())


def agency(name, path, group="ohio", state_code="OH"):
    """One `HarvestedAgency` (contract C1)."""
    return {
        "name": name,
        "tenant_path": path,
        "tenant_url": "https://www.bidnetdirect.com{0}/solicitations/open-bids".format(path),
        "group": group,
        "state_code": state_code,
    }


def fake_harvest(agencies, stats=None, recorder=None):
    def harvest(request, session=None, sleep=None, fetch_html=None):
        if recorder is not None:
            recorder.append(request)
        merged = {
            "pages": 1,
            "agencies": len(agencies),
            "stopped_reason": "exhausted",
            "duplicates": 0,
            # Always 0 unless the request carries `states`: with a filter the harvester drops
            # state-less agencies itself rather than handing them over.
            "unresolved_state_skipped": 0,
        }
        merged.update(stats or {})
        return {"agencies": list(agencies), "stats": merged}

    return harvest


def fake_classify(levels, recorder=None):
    """C2: `classify_agency(name, state_code=None)` — the state decides what a borough is."""

    def classify(name, state_code=None):
        if recorder is not None:
            recorder.append((name, state_code))
        if isinstance(levels.get(name), dict):
            return levels[name].get(state_code, "unknown")
        return levels.get(name, "unknown")

    return classify


def fake_match(rows):
    """`rows` maps (level, state_code, name_key) -> a C2 match result."""

    def match(level, state_code, name, table=None):
        return dict(rows.get((level, state_code, fake_name_key(name)), {"status": "not_found"}))

    return match


def run(request, agencies=(), levels=None, rows=None, stats=None, recorder=None, classify_calls=None):
    return discover_sources(
        request,
        harvest=fake_harvest(list(agencies), stats=stats, recorder=recorder),
        classify=fake_classify(levels or {}, recorder=classify_calls),
        match=fake_match(rows or {}),
        name_key=fake_name_key,
    )


# --- a small but realistic Ohio/Colorado directory -------------------------------------

FRANKLIN_CS = agency("Franklin County Children Services", "/ohio/franklincountychildrensservices")
CUYAHOGA = agency("Cuyahoga County", "/ohio/cuyahogacounty")
COLUMBUS = agency("City of Columbus", "/ohio/city-of-columbus")
COLUMBUS_SCHOOLS = agency("Columbus City School District", "/ohio/columbuscityschools")
MORPC = agency("Mid-Ohio Regional Planning Commission", "/ohio/morpc")
MAHONING = agency("Mahoning County", "/ohio/mahoningcounty")
BOULDER = agency("Boulder County", "/colorado/boulder-county", group="colorado", state_code="CO")
MITN = agency("Oakland Schools", "/mitn/oaklandschools", group="mitn", state_code=None)

DIRECTORY = [FRANKLIN_CS, CUYAHOGA, COLUMBUS, COLUMBUS_SCHOOLS, MORPC, MAHONING, BOULDER, MITN]

LEVELS = {
    "Franklin County Children Services": "county",
    "Cuyahoga County": "county",
    "City of Columbus": "city",
    "Columbus City School District": "special_district",
    "Mid-Ohio Regional Planning Commission": "unknown",
    "Mahoning County": "county",
    "Boulder County": "county",
    "Oakland Schools": "special_district",
}

ROWS = {
    ("county", "OH", "cuyahoga"): {"status": "exact", "geoid": "39035", "name": "Cuyahoga County"},
    ("county", "CO", "boulder"): {"status": "exact", "geoid": "08013", "name": "Boulder County"},
    ("city", "OH", "columbus"): {"status": "exact", "geoid": "3918000", "name": "Columbus city"},
    # A department *within* Franklin County, not Franklin County itself (spec §4.2's headline
    # example, corrected): a candidate, but one the reviewer is told to look at.
    ("county", "OH", "franklin county children services"): {
        "status": "prefix",
        "geoid": "39049",
        "name": "Franklin County",
        "matched_prefix": "Franklin County",
    },
    # Mahoning is deliberately absent -> `not_found`.
}


# --- subcommand wiring -----------------------------------------------------------------


def test_discover_sources_is_a_registered_subcommand():
    args = cli.build_parser().parse_args(["discover-sources"])
    assert args.command == "discover-sources"


# --- candidate assembly ----------------------------------------------------------------


def test_candidate_carries_exactly_the_source_candidate_fields_plus_discovery():
    response = run({}, agencies=[CUYAHOGA], levels=LEVELS, rows=ROWS)

    assert len(response["candidates"]) == 1
    candidate = response["candidates"][0]
    assert set(candidate) == SOURCE_CANDIDATE_FIELDS | {"discovery"}
    assert candidate == {
        "id": "bidnet_oh_cuyahoga",
        "label": "Cuyahoga County (BidNet)",
        "issuerType": "county",
        "stateCode": "OH",
        "baseUrl": "https://www.bidnetdirect.com/ohio/cuyahogacounty/solicitations/open-bids",
        "jurisdictionLevel": "county",
        "jurisdictionName": "Cuyahoga County",
        "fipsCode": "39035",
        "providerFamily": "bidnet",
        "cadence": "daily",
        "fetchConfig": {
            "base_url": "https://www.bidnetdirect.com/ohio/cuyahogacounty/solicitations/open-bids"
        },
        "discovery": {
            "agencyName": "Cuyahoga County",
            "group": "ohio",
            "matchedOn": "county",
            "confidence": "exact",
            "matchedPrefix": None,
        },
    }


def test_city_candidates_use_the_place_table_match():
    response = run({}, agencies=[COLUMBUS], levels=LEVELS, rows=ROWS)

    candidate = response["candidates"][0]
    assert candidate["id"] == "bidnet_oh_columbus"
    assert candidate["issuerType"] == "city"
    assert candidate["jurisdictionLevel"] == "city"
    assert candidate["jurisdictionName"] == "Columbus city"
    assert candidate["fipsCode"] == "3918000"
    assert candidate["discovery"]["matchedOn"] == "city"


def test_special_district_and_unknown_never_reach_candidates():
    response = run({}, agencies=[COLUMBUS_SCHOOLS, MORPC], levels=LEVELS, rows=ROWS)

    assert response["candidates"] == []
    assert [entry["reason"] for entry in response["review"]] == [
        "classified_special_district",
        "classified_unknown",
    ]
    assert response["review"][0]["agencyName"] == "Columbus City School District"
    assert response["review"][0]["group"] == "ohio"
    assert response["review"][0]["tenantUrl"].endswith("/columbuscityschools/solicitations/open-bids")


def test_ambiguous_and_missing_fips_matches_go_to_review():
    rows = {
        ("county", "OH", "cuyahoga"): {
            "status": "ambiguous",
            "candidates": [
                {"geoid": "39035", "name": "Cuyahoga County"},
                {"geoid": "39999", "name": "Cuyahoga County (historic)"},
            ],
        }
    }
    response = run({}, agencies=[CUYAHOGA, FRANKLIN_CS], levels=LEVELS, rows=rows)

    assert response["candidates"] == []
    assert [entry["reason"] for entry in response["review"]] == ["ambiguous_match", "no_fips_match"]
    assert "39035" in response["review"][0]["detail"]
    assert response["stats"]["unmatched"] == 2


def test_a_county_prefix_match_is_a_candidate_the_reviewer_is_warned_about():
    response = run({}, agencies=[FRANKLIN_CS], levels=LEVELS, rows=ROWS)

    candidate = response["candidates"][0]
    assert candidate["id"] == "bidnet_oh_franklin_county_children_services"
    assert candidate["fipsCode"] == "39049"
    assert candidate["jurisdictionName"] == "Franklin County"
    assert candidate["discovery"] == {
        "agencyName": "Franklin County Children Services",
        "group": "ohio",
        "matchedOn": "county",
        "confidence": "jurisdiction_prefix",
        "matchedPrefix": "Franklin County",
    }
    assert response["review"] == []
    assert response["stats"]["prefix_matched"] == 1
    # A prefix hit is a match, not a miss.
    assert response["stats"]["unmatched"] == 0


def test_prefix_matched_counts_only_prefix_candidates():
    response = run({}, agencies=DIRECTORY, levels=LEVELS, rows=ROWS)

    assert response["stats"]["prefix_matched"] == 1
    assert len(response["candidates"]) == 4
    assert [
        candidate["discovery"]["confidence"] for candidate in response["candidates"]
    ] == ["jurisdiction_prefix", "exact", "exact", "exact"]


def test_agencies_without_a_resolved_state_go_to_review():
    response = run({}, agencies=[MITN], levels={"Oakland Schools": "county"}, rows=ROWS)

    assert response["candidates"] == []
    assert response["review"][0]["reason"] == "unresolved_state"
    assert "mitn" in response["review"][0]["detail"]


def test_the_classifier_receives_the_agency_state_code():
    """C2: `classify_agency(name, state_code)` — a borough is a county only in Alaska."""
    calls = []
    nj_borough = agency("Borough of Freehold", "/new-jersey/freehold", group="new-jersey", state_code="NJ")
    ak_borough = agency("Matanuska-Susitna Borough", "/alaska/matsu", group="alaska", state_code="AK")
    levels = {
        "Borough of Freehold": {"NJ": "city", "AK": "county"},
        "Matanuska-Susitna Borough": {"NJ": "city", "AK": "county"},
    }
    rows = {
        ("city", "NJ", "borough of freehold"): {"status": "exact", "geoid": "3424840", "name": "Freehold borough"},
        ("county", "AK", "matanuska susitna"): {"status": "exact", "geoid": "02170", "name": "Matanuska-Susitna Borough"},
    }

    response = run({}, agencies=[nj_borough, ak_borough], levels=levels, rows=rows, classify_calls=calls)

    # The ids come from `fake_name_key`, not Task B's (which also strips a "Borough of"
    # prefix) -- what is under test here is that the state reaches the classifier at all.
    assert calls == [("Borough of Freehold", "NJ"), ("Matanuska-Susitna Borough", "AK")]
    assert [(c["id"], c["jurisdictionLevel"]) for c in response["candidates"]] == [
        ("bidnet_nj_borough_of_freehold", "city"),
        ("bidnet_ak_matanuska_susitna", "county"),
    ]


def test_levels_filter_sends_unrequested_levels_to_review():
    response = run({"levels": ["county"]}, agencies=[COLUMBUS, CUYAHOGA], levels=LEVELS, rows=ROWS)

    assert [candidate["id"] for candidate in response["candidates"]] == ["bidnet_oh_cuyahoga"]
    assert response["review"][0] == {
        "agencyName": "City of Columbus",
        "tenantUrl": "https://www.bidnetdirect.com/ohio/city-of-columbus/solicitations/open-bids",
        "group": "ohio",
        "reason": "level_not_requested",
        "detail": None,
    }
    # The level bucket still counts it, so the stats invariant survives the filter.
    assert response["stats"]["city"] == 1


# --- ids -------------------------------------------------------------------------------


def test_ids_are_platform_state_and_name_key():
    response = run({}, agencies=[CUYAHOGA, BOULDER, COLUMBUS], levels=LEVELS, rows=ROWS)

    assert [candidate["id"] for candidate in response["candidates"]] == [
        "bidnet_oh_cuyahoga",
        "bidnet_co_boulder",
        "bidnet_oh_columbus",
    ]


def test_colliding_ids_get_a_numeric_suffix():
    twin = agency("Cuyahoga County Purchasing", "/ohio/cuyahogacountypurchasing")
    rows = dict(ROWS)
    rows[("county", "OH", "cuyahoga purchasing")] = {
        "status": "exact",
        "geoid": "39035",
        "name": "Cuyahoga County",
    }
    levels = dict(LEVELS, **{"Cuyahoga County Purchasing": "county"})

    # Both agencies normalize to the same name_key only when the second one does; force the
    # collision by classifying a second row whose name_key really is "cuyahoga".
    third = agency("Cuyahoga County", "/ohio/cuyahogacounty-purchasing")
    response = run({}, agencies=[CUYAHOGA, third, twin], levels=levels, rows=rows)

    ids = [candidate["id"] for candidate in response["candidates"]]
    assert ids[0] == "bidnet_oh_cuyahoga"
    assert ids[1] == "bidnet_oh_cuyahoga_2"
    assert len(set(ids)) == len(ids)


def test_a_suffixed_id_never_collides_with_an_existing_id():
    third = agency("Cuyahoga County", "/ohio/cuyahogacounty-purchasing")
    response = run(
        {"existing_ids": ["bidnet_oh_cuyahoga_2"]},
        agencies=[CUYAHOGA, third],
        levels=LEVELS,
        rows=ROWS,
    )

    ids = [candidate["id"] for candidate in response["candidates"]]
    assert ids == ["bidnet_oh_cuyahoga", "bidnet_oh_cuyahoga_3"]


# --- deduplication ---------------------------------------------------------------------


def test_existing_ids_deduplicate_and_count():
    response = run(
        {"existing_ids": ["bidnet_oh_cuyahoga"]},
        agencies=[CUYAHOGA, COLUMBUS],
        levels=LEVELS,
        rows=ROWS,
    )

    assert [candidate["id"] for candidate in response["candidates"]] == ["bidnet_oh_columbus"]
    assert response["stats"]["duplicates"] == 1
    assert response["review"][0]["reason"] == "already_registered"
    assert response["review"][0]["detail"] == "bidnet_oh_cuyahoga"


def test_existing_base_urls_deduplicate_ignoring_trailing_slash_and_case():
    response = run(
        {
            "existing_base_urls": [
                "https://WWW.BidNetDirect.com/ohio/cuyahogacounty/solicitations/open-bids/"
            ]
        },
        agencies=[CUYAHOGA, COLUMBUS],
        levels=LEVELS,
        rows=ROWS,
    )

    assert [candidate["id"] for candidate in response["candidates"]] == ["bidnet_oh_columbus"]
    assert response["stats"]["duplicates"] == 1


def test_a_duplicate_is_never_also_reported_as_unmatched():
    response = run(
        {"existing_ids": ["bidnet_oh_cuyahoga"]},
        agencies=[CUYAHOGA],
        levels=LEVELS,
        rows={},
    )

    assert response["stats"]["duplicates"] == 1
    assert response["stats"]["unmatched"] == 0
    assert response["candidates"] == []


# --- existing sources (spec §4.6) ------------------------------------------------------


def test_existing_sources_produce_exact_partial_and_missing_matches():
    response = run(
        {
            "existing_sources": [
                {"id": "bidnet_oh_cuyahoga", "label": "Cuyahoga County, OH (BidNet)", "state_code": "OH"},
                {"id": "bidnet_oh_franklin", "label": "Franklin County, OH (BidNet)", "state_code": "OH"},
                {"id": "bidnet_wy_laramie", "label": "Laramie County, WY (BidNet)", "state_code": "WY"},
            ]
        },
        agencies=DIRECTORY,
        levels=LEVELS,
        rows=ROWS,
    )

    assert response["existingMatches"] == [
        {
            "sourceId": "bidnet_oh_cuyahoga",
            "agencyName": "Cuyahoga County",
            "suggestedBaseUrl": "https://www.bidnetdirect.com/ohio/cuyahogacounty/solicitations/open-bids",
            "confidence": "exact",
        },
        {
            "sourceId": "bidnet_oh_franklin",
            "agencyName": "Franklin County Children Services",
            "suggestedBaseUrl": (
                "https://www.bidnetdirect.com/ohio/franklincountychildrensservices/solicitations/open-bids"
            ),
            "confidence": "partial",
        },
        {
            "sourceId": "bidnet_wy_laramie",
            "agencyName": None,
            "suggestedBaseUrl": None,
            "confidence": "none",
        },
    ]


def test_existing_sources_do_not_match_across_states():
    response = run(
        {"existing_sources": [{"id": "x", "label": "Boulder County, MT (BidNet)", "state_code": "MT"}]},
        agencies=[BOULDER],
        levels=LEVELS,
        rows=ROWS,
    )

    assert response["existingMatches"][0]["confidence"] == "none"


def test_existing_sources_reverse_lookup_ignores_classification():
    """A 404'd county source may well correspond to a directory row we call a special district."""
    response = run(
        {"existing_sources": [{"id": "bidnet_oh_columbus_schools", "label": "Columbus City School District"}]},
        agencies=DIRECTORY,
        levels=LEVELS,
        rows=ROWS,
    )

    assert response["existingMatches"][0]["agencyName"] == "Columbus City School District"
    assert response["existingMatches"][0]["confidence"] == "exact"


# --- stats -----------------------------------------------------------------------------


def test_level_buckets_sum_to_the_agency_count():
    response = run({}, agencies=DIRECTORY, levels=LEVELS, rows=ROWS)
    stats = response["stats"]

    assert stats["agencies"] == len(DIRECTORY)
    assert stats["county"] + stats["city"] + stats["special_district"] + stats["unknown"] == stats["agencies"]
    assert stats["county"] == 4
    assert stats["city"] == 1
    assert stats["special_district"] == 2
    assert stats["unknown"] == 1
    # Mahoning has no row in the table; Franklin's department matched by prefix.
    assert stats["unmatched"] == 1
    assert stats["prefix_matched"] == 1


def test_stats_carry_the_harvest_paging_result():
    response = run(
        {},
        agencies=[CUYAHOGA],
        levels=LEVELS,
        rows=ROWS,
        stats={"pages": 312, "stopped_reason": "max_pages", "duplicates": 6},
    )

    assert response["stats"]["pages"] == 312
    assert response["stats"]["stopped_reason"] == "max_pages"
    assert response["stats"]["harvest_duplicates"] == 6
    assert response["stats"]["duplicates"] == 0
    assert isinstance(response["stats"]["duration_ms"], int)


def test_stats_carry_the_harvester_state_filter_drop_count():
    """With `states` the harvester drops state-less agencies itself; the count is reported."""
    response = run(
        {"states": ["OH"]},
        agencies=[CUYAHOGA],
        levels=LEVELS,
        rows=ROWS,
        stats={"unresolved_state_skipped": 37},
    )

    assert response["stats"]["unresolved_state_skipped"] == 37
    # Those agencies never reached us, so they are outside the level buckets by construction.
    stats = response["stats"]
    assert stats["county"] + stats["city"] + stats["special_district"] + stats["unknown"] == stats["agencies"] == 1


def test_unresolved_state_skipped_defaults_to_zero_on_an_unfiltered_run():
    response = run({}, agencies=[MITN], levels=LEVELS, rows=ROWS)

    assert response["stats"]["unresolved_state_skipped"] == 0


def test_a_waf_challenge_is_a_partial_run_that_still_returns_what_was_collected():
    response = run(
        {},
        agencies=[CUYAHOGA],
        levels=LEVELS,
        rows=ROWS,
        stats={"pages": 4, "stopped_reason": "waf_challenge"},
    )

    assert response["stats"]["stopped_reason"] == "waf_challenge"
    assert len(response["candidates"]) == 1


# --- the request handed to the harvester ------------------------------------------------


def test_the_harvester_receives_the_clamped_paging_budget():
    recorder = []
    run(
        {
            "max_pages": 12,
            "min_interval_seconds": 5,
            "timeout_seconds": 45,
            "states": ["oh", "CO"],
            "existing_ids": ["bidnet_oh_cuyahoga"],
        },
        agencies=[],
        recorder=recorder,
    )

    assert recorder == [
        {
            "platform": "bidnet",
            "max_pages": 12,
            "min_interval_seconds": 5.0,
            "timeout_seconds": 45,
            "states": ["OH", "CO"],
        }
    ]


def test_paging_defaults_and_clamps_match_the_spec():
    recorder = []
    run({"max_pages": 0, "min_interval_seconds": -4, "timeout_seconds": 9999}, agencies=[], recorder=recorder)
    assert recorder[0] == {
        "platform": "bidnet",
        "max_pages": 1,
        "min_interval_seconds": 0.0,
        "timeout_seconds": 300,
        "states": None,
    }

    recorder = []
    run({}, agencies=[], recorder=recorder)
    assert recorder[0] == {
        "platform": "bidnet",
        "max_pages": 400,
        "min_interval_seconds": 3.0,
        "timeout_seconds": 30,
        "states": None,
    }


# --- invalid requests -------------------------------------------------------------------


@pytest.mark.parametrize(
    "request_payload",
    [
        [],
        "nope",
        {"platform": "bonfire"},
        {"levels": ["special_district"]},
        {"levels": []},
        {"states": ["Ohio"]},
        {"states": []},
        {"existing_ids": "bidnet_oh_cuyahoga"},
        {"existing_base_urls": [7]},
        {"existing_sources": [{"label": "no id"}]},
        {"existing_sources": "nope"},
    ],
)
def test_unusable_requests_raise_invalid_source_discovery_request_error(request_payload):
    with pytest.raises(InvalidSourceDiscoveryRequestError):
        run(request_payload, agencies=[])


# --- the CLI itself ---------------------------------------------------------------------


def _run_cli(stdin_text, monkeypatch, capsys, responder=None):
    if responder is not None:
        monkeypatch.setattr(cli, "discover_sources", responder)
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin_text))
    exit_code = cli.main(["discover-sources"])
    return exit_code, capsys.readouterr()


def _assembling_responder(agencies, levels, rows):
    def responder(request):
        return run(request, agencies=agencies, levels=levels, rows=rows)

    return responder


def test_cli_prints_exactly_one_json_document_and_exits_zero(monkeypatch, capsys):
    exit_code, captured = _run_cli(
        json.dumps({"platform": "bidnet", "states": ["OH"]}),
        monkeypatch,
        capsys,
        _assembling_responder(DIRECTORY, LEVELS, ROWS),
    )

    assert exit_code == 0
    assert captured.out.strip().count("\n") == 0
    payload = json.loads(captured.out)
    assert set(payload) == {"candidates", "review", "existingMatches", "stats"}
    assert [candidate["id"] for candidate in payload["candidates"]] == [
        "bidnet_oh_franklin_county_children_services",
        "bidnet_oh_cuyahoga",
        "bidnet_oh_columbus",
        "bidnet_co_boulder",
    ]
    assert [entry["reason"] for entry in payload["review"]] == [
        "classified_special_district",
        "classified_unknown",
        "no_fips_match",
        "classified_special_district",
    ]


def test_cli_sends_diagnostics_to_stderr_only(monkeypatch, capsys):
    exit_code, captured = _run_cli(
        json.dumps({}), monkeypatch, capsys, _assembling_responder(DIRECTORY, LEVELS, ROWS)
    )

    assert exit_code == 0
    json.loads(captured.out)
    assert "discover-sources" in captured.err


def test_cli_exits_two_on_unparseable_stdin(monkeypatch, capsys):
    exit_code, captured = _run_cli("not json at all", monkeypatch, capsys)

    assert exit_code == 2
    payload = json.loads(captured.out)
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"]
    assert "candidates" not in payload


@pytest.mark.parametrize("body", ['{"platform": "bonfire"}', '{"levels": ["planet"]}', "[]"])
def test_cli_exits_two_on_an_unusable_request(body, monkeypatch, capsys):
    exit_code, captured = _run_cli(body, monkeypatch, capsys)

    assert exit_code == 2
    assert json.loads(captured.out)["error"]["code"] == "INVALID_REQUEST"


# --- the seam with the real Task A / Task B modules --------------------------------------


def test_the_real_collaborators_resolve_with_their_contract_signatures():
    """Fakes cannot catch a signature change in C1/C2 — this does.

    Only `harvest` is injected (so no request leaves the machine); `classify`, `match`,
    `name_key` and the bundled Census table all resolve for real through `_resolve_helpers`.
    """
    pytest.importorskip("apsi_crawler.discovery.bidnet")
    pytest.importorskip("apsi_crawler.jurisdictions")

    agencies = [
        agency("Cuyahoga County", "/ohio/cuyahogacounty"),
        agency("City of Aurora", "/city-of-aurora", group="colorado", state_code="CO"),
        # Matches by the county-prefix rule, not by its own name.
        FRANKLIN_CS,
        # Classified with its state: a NJ borough is a municipality, not a county.
        agency("Borough of Freehold", "/new-jersey/freehold", group="new-jersey", state_code="NJ"),
        agency("Columbus City School District", "/ohio/columbuscityschools"),
    ]
    response = discover_sources({"platform": "bidnet"}, harvest=fake_harvest(agencies))

    assert [
        (c["id"], c["jurisdictionLevel"], c["fipsCode"], c["discovery"]["confidence"])
        for c in response["candidates"]
    ] == [
        ("bidnet_oh_cuyahoga", "county", "39035", "exact"),
        ("bidnet_co_aurora", "city", "0804000", "exact"),
        ("bidnet_oh_franklin_county_children_services", "county", "39049", "jurisdiction_prefix"),
        ("bidnet_nj_freehold", "city", "3425200", "exact"),
    ]
    assert response["candidates"][2]["discovery"]["matchedPrefix"] == "Franklin County"
    assert [entry["reason"] for entry in response["review"]] == ["classified_special_district"]
    stats = response["stats"]
    assert stats["prefix_matched"] == 1
    assert stats["county"] + stats["city"] + stats["special_district"] + stats["unknown"] == stats["agencies"]


def test_cli_reports_an_unexpected_failure_as_one_json_document(monkeypatch, capsys):
    def boom(request):
        raise RuntimeError("directory walk exploded")

    exit_code, captured = _run_cli(json.dumps({}), monkeypatch, capsys, boom)

    assert exit_code == 2
    payload = json.loads(captured.out)
    assert payload["error"] == {"code": "RuntimeError", "message": "directory walk exploded"}
    assert "Traceback" in captured.err
