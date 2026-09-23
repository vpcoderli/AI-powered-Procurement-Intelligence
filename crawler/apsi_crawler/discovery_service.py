"""`discover-sources` orchestration — contract C3.

One read-only walk of a platform's public agency directory turns into a candidate JSON a
person reviews before `npm run source:register` puts it in `data_sources` as an *unapproved*
row. Nothing here writes a database, and nothing here touches a governance column: the
county/city approval gate built on 2026-09-16 stays exactly where it is.

Three pieces do the work and all three are injectable, so this module can be tested — and
a second platform added — without reaching into either of them:

* `harvest`  — the directory harvester (contract C1, `apsi_crawler.discovery.bidnet`)
* `classify` — agency name -> county | city | special_district | unknown (contract C2)
* `match`    — (level, state, name) -> a Census GEOID (contract C2)

Design and decisions: `docs/superpowers/specs/2026-09-21-source-discovery-design.md` (§4.2 is
this module's wire format, §4.4/§4.5 the classification and matching rules, §4.6 the reverse
lookup for sources we already have). Operations: `docs/operations/source-discovery.md`.

stdlib only.
"""

import re
from time import perf_counter
from urllib.parse import urlsplit


#: Platform id -> how its candidates are labelled and which `provider_family` they carry.
#: Adding a second platform means adding a harvester, one row here and one in `TENANT_KEYS`
#: (spec §6).
PLATFORMS = {
    "bidnet": {"label": "BidNet", "provider_family": "bidnet", "harvester": "harvest_bidnet"},
}
DEFAULT_PLATFORM = "bidnet"

#: Decision 3: only counties and cities are ever registered. Everything else is reported.
CANDIDATE_LEVELS = ("county", "city")
ALL_LEVELS = ("county", "city", "special_district", "unknown")

#: Match statuses that produce a candidate, and the `discovery.confidence` each one carries.
#: `prefix` means the agency is a *department within* the jurisdiction ("Alameda County Public
#: Works Agency" -> Alameda County): a real, registerable source, but the reviewer is told so.
MATCH_CONFIDENCE = {"exact": "exact", "prefix": "jurisdiction_prefix"}

DEFAULT_CADENCE = "daily"
DEFAULTS = {"max_pages": 400, "min_interval_seconds": 3.0, "timeout_seconds": 30}
LIMITS = {"max_pages": (1, 2000), "min_interval_seconds": (0.0, 60.0), "timeout_seconds": (1, 300)}

_STATE_CODE_RE = re.compile(r"^[A-Za-z]{2}$")
_PARENTHETICAL_RE = re.compile(r"\([^)]*\)")
_TRAILING_STATE_RE = re.compile(r",\s*[A-Za-z]{2}\s*$")


class InvalidSourceDiscoveryRequestError(Exception):
    """The request cannot be executed at all (CLI exit 2)."""


def _bidnet_tenant_key(url):
    """BidNet's tenant identity: the slug, i.e. the last path segment before `/solicitations`.

    One tenant answers on two paths -- group-scoped `/colorado/city-of-aurora/...` and a root
    alias `/city-of-aurora/...` -- so neither the whole URL nor our id is its identity. The
    slug is: across the full 2026-09-21 directory (2,036 tenants) every slug is distinct and
    none appears under two groups. Whole-URL comparison missed Aurora and Washtenaw, which are
    registered under their root alias (Aurora came back as a second candidate for the same
    tenant); id comparison merged City of Boulder into Boulder County, because both names key
    to `boulder` (docs/qa/crawler-discovery-test-report-2026-09-23.md, C06).
    """
    text = (url or "").strip()
    if not text:
        return ""
    parts = urlsplit(text)
    host = (parts.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    segments = [segment for segment in (parts.path or "").split("/") if segment]
    lowered = [segment.lower() for segment in segments]
    if "solicitations" in lowered:
        segments = segments[: lowered.index("solicitations")]
    if not segments:
        return host
    return "{0}/{1}".format(host, segments[-1].lower())


#: Platform id -> how a tenant URL reduces to the tenant's identity (see `_bidnet_tenant_key`).
#: A second platform needs its own rule: a Bonfire tenant is its subdomain, not a path segment.
TENANT_KEYS = {"bidnet": _bidnet_tenant_key}


def _clamp(value, field, cast):
    low, high = LIMITS[field]
    try:
        number = cast(value)
    except (TypeError, ValueError):
        return DEFAULTS[field]
    return max(low, min(high, number))


def _string_list(value, field):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise InvalidSourceDiscoveryRequestError("{0} must be a list of strings".format(field))
    return [item.strip() for item in value if item.strip()]


def _validate_request(request):
    """Return the normalized settings, or raise (CLI exit 2). Numbers clamp; shapes raise."""
    if not isinstance(request, dict):
        raise InvalidSourceDiscoveryRequestError("request must be a JSON object")

    platform = request.get("platform") or DEFAULT_PLATFORM
    if platform not in PLATFORMS:
        raise InvalidSourceDiscoveryRequestError(
            "platform must be one of: {0}".format(", ".join(sorted(PLATFORMS)))
        )

    levels = request.get("levels")
    if levels is None:
        levels = list(CANDIDATE_LEVELS)
    elif (
        not isinstance(levels, list)
        or not levels
        or any(level not in CANDIDATE_LEVELS for level in levels)
    ):
        raise InvalidSourceDiscoveryRequestError(
            "levels must be a non-empty list drawn from: {0}".format(", ".join(CANDIDATE_LEVELS))
        )

    states = request.get("states")
    if states is not None:
        if not isinstance(states, list) or not states:
            raise InvalidSourceDiscoveryRequestError(
                "states must be omitted (every state) or a non-empty list of two-letter codes"
            )
        if any(not isinstance(code, str) or not _STATE_CODE_RE.match(code.strip()) for code in states):
            raise InvalidSourceDiscoveryRequestError("every states entry must be a two-letter code")
        states = [code.strip().upper() for code in states]

    existing_sources = request.get("existing_sources")
    if existing_sources is None:
        existing_sources = []
    elif not isinstance(existing_sources, list):
        raise InvalidSourceDiscoveryRequestError("existing_sources must be a list")
    else:
        for source in existing_sources:
            if not isinstance(source, dict):
                raise InvalidSourceDiscoveryRequestError("every existing_sources entry must be a JSON object")
            if not isinstance(source.get("id"), str) or not source["id"].strip():
                raise InvalidSourceDiscoveryRequestError(
                    "every existing_sources entry must carry a non-empty string id"
                )
            # Optional, and exactly what `data_sources` holds: `base_url` lets the entry
            # deduplicate by tenant, `jurisdiction_level` pins the level the reverse lookup
            # must confirm instead of inferring it from the label.
            for optional in ("label", "state_code", "base_url", "jurisdiction_level"):
                if source.get(optional) is not None and not isinstance(source[optional], str):
                    raise InvalidSourceDiscoveryRequestError(
                        "existing_sources entry {0!r}: {1} must be a string".format(source["id"], optional)
                    )

    existing_ids = _string_list(request.get("existing_ids"), "existing_ids")
    existing_base_urls = _string_list(request.get("existing_base_urls"), "existing_base_urls")
    if existing_ids and not existing_base_urls and not any(
        (source.get("base_url") or "").strip() for source in existing_sources
    ):
        # An id only reserves a name. Whether an agency is already registered is decided by
        # its tenant, so ids without the registered URLs cannot deduplicate anything, and
        # every registered tenant would come back as a suffixed duplicate.
        raise InvalidSourceDiscoveryRequestError(
            "existing_ids needs the registered base URLs too (existing_base_urls, or base_url on "
            "existing_sources): an id reserves a name, only the tenant URL proves a source is "
            "already registered"
        )

    return {
        "platform": platform,
        "levels": list(levels),
        "existing_ids": existing_ids,
        "existing_base_urls": existing_base_urls,
        "existing_sources": list(existing_sources),
        # Only the crawl budget reaches the harvester — `existing_*` is ours to apply.
        "harvest_request": {
            "platform": platform,
            "max_pages": _clamp(request.get("max_pages", DEFAULTS["max_pages"]), "max_pages", int),
            "min_interval_seconds": _clamp(
                request.get("min_interval_seconds", DEFAULTS["min_interval_seconds"]),
                "min_interval_seconds",
                float,
            ),
            "timeout_seconds": _clamp(
                request.get("timeout_seconds", DEFAULTS["timeout_seconds"]), "timeout_seconds", int
            ),
            "states": states,
        },
    }


def _resolve_helpers(platform, harvest, classify, match, jurisdictions, name_key):
    """Import the harvester and the jurisdiction table lazily.

    Injected fakes must not require the real modules, and the real modules must not be
    imported (nor the bundled TSV read) by any other subcommand.
    """
    if harvest is None:
        from apsi_crawler.discovery import bidnet as harvester_module

        harvest = getattr(harvester_module, PLATFORMS[platform]["harvester"])
    if classify is None or match is None or name_key is None:
        from apsi_crawler import jurisdictions as jurisdictions_module

        classify = classify or jurisdictions_module.classify_agency
        name_key = name_key or jurisdictions_module.name_key
        if match is None:
            match = jurisdictions_module.match_jurisdiction
            if jurisdictions is None:
                # Load the bundled table once per run, not once per agency.
                jurisdictions = jurisdictions_module.load_jurisdictions()
    return harvest, classify, match, jurisdictions, name_key


def _registered_tenants(existing_base_urls, existing_sources, tenant_key):
    """Tenant key -> what an `already_registered` review row names as the owner.

    The owning source id when the request says which source holds the URL
    (`existing_sources[].base_url`); otherwise the registered URL itself, because
    `existing_ids` and `existing_base_urls` are two unrelated lists.
    """
    owners = {}
    for source in existing_sources:
        key = tenant_key(source.get("base_url"))
        if key:
            owners.setdefault(key, source["id"].strip())
    for url in existing_base_urls:
        key = tenant_key(url)
        if key:
            owners.setdefault(key, url)
    return owners


def _id_segment(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", (value or "").lower())).strip("_")


def _unique_id(base_id, taken):
    if base_id not in taken:
        return base_id
    suffix = 2
    while "{0}_{1}".format(base_id, suffix) in taken:
        suffix += 1
    return "{0}_{1}".format(base_id, suffix)


def _display_name(label):
    """`"Franklin County, OH (BidNet)"` -> `"Franklin County"`."""
    name = _PARENTHETICAL_RE.sub(" ", label or "")
    name = _TRAILING_STATE_RE.sub("", " ".join(name.split()))
    return " ".join(name.split())


def _tokens(key):
    return [token for token in (key or "").split() if token]


def _review_entry(agency, reason, detail=None):
    return {
        "agencyName": (agency.get("name") or "").strip() or None,
        "tenantUrl": (agency.get("tenant_url") or "").strip() or None,
        "group": agency.get("group"),
        "reason": reason,
        "detail": detail,
    }


def _ambiguity_detail(matched):
    candidates = matched.get("candidates") or []
    labels = [
        "{0} ({1})".format(item.get("name") or "?", item.get("geoid") or "?")
        if isinstance(item, dict)
        else str(item)
        for item in candidates
    ]
    return "; ".join(labels) or None


def _level(value):
    return (value or "").strip().lower() or "unknown"


def _doubt(state, agency_state, level, agency_level):
    """Why a reverse-lookup name hit is not a suggestion; None once state and level agree.

    `level_mismatch` -- both levels known and different; `state_unconfirmed` -- either side
    has no state; `level_unconfirmed` -- either side's level is `unknown`. A contradiction
    outranks a gap: "Franklin County" (OH) against a state-less "Village of Franklin" is a
    different kind of jurisdiction before it is an unconfirmed state.
    """
    if level != "unknown" and agency_level != "unknown" and level != agency_level:
        return "level_mismatch"
    if not state or not agency_state:
        return "state_unconfirmed"
    if level == "unknown" or agency_level == "unknown":
        return "level_unconfirmed"
    return None


def _existing_matches(existing_sources, classified, name_key, classify):
    """Spec §4.6 — reverse-look every source we already have up in the directory.

    A name hit is a suggestion only when the directory row is confirmed to be the same kind
    of jurisdiction in the same state: "Boulder County" and "City of Boulder" share the name
    key `boulder`, and copying the city's URL into the county row would quietly swap one
    jurisdiction's bids for the other's (docs/qa/crawler-discovery-test-report-2026-09-23.md,
    C07). The source's level is its `jurisdiction_level` when the request carries one, else
    its label classified the same way directory rows are.

    Tiers, first non-empty wins: confirmed `exact`, confirmed `partial`, then the name hits
    that failed a check -- still listed, since "the directory has a same-named row of another
    level" is evidence too, but with `suggestedBaseUrl: None` and the failed check as the
    confidence (see `_doubt`). A source with no hit at all still gets a row
    (`confidence: "none"`): "the directory does not list them" is the evidence needed to mark
    it `blocked`. Suggestions only — nothing is written.
    """
    index = []
    for agency, agency_level in classified if existing_sources else []:
        name = (agency.get("name") or "").strip()
        tokens = _tokens(name_key(name)) if name else []
        if not tokens:
            continue
        index.append(
            (
                name,
                tokens,
                (agency.get("state_code") or "").strip().upper() or None,
                agency_level,
                (agency.get("tenant_url") or "").strip() or None,
            )
        )

    matches = []
    for source in existing_sources:
        source_id = source["id"].strip()
        display = _display_name(source.get("label") or source_id)
        wanted = _tokens(name_key(display))
        state = (source.get("state_code") or "").strip().upper() or None
        level = _level(source.get("jurisdiction_level"))
        if level == "unknown" and display:
            level = _level(classify(display, state))

        exact, partial, unconfirmed = [], [], []
        for name, tokens, agency_state, agency_level, tenant_url in (index if wanted else []):
            if state and agency_state and state != agency_state:
                continue
            if tokens == wanted:
                bucket = exact
            elif tokens[: len(wanted)] == wanted or wanted[: len(tokens)] == tokens:
                bucket = partial
            else:
                continue
            doubt = _doubt(state, agency_state, level, agency_level)
            if doubt is None:
                bucket.append((name, tenant_url))
            else:
                # Same-name rows sort ahead of prefix ones.
                unconfirmed.append((bucket is partial, name, doubt))

        hits = [(name, url, "exact") for name, url in sorted(exact)]
        if not hits:
            hits = [(name, url, "partial") for name, url in sorted(partial)]
        if not hits:
            hits = [(name, None, doubt) for _, name, doubt in sorted(unconfirmed)]
        if not hits:
            matches.append(
                {"sourceId": source_id, "agencyName": None, "suggestedBaseUrl": None, "confidence": "none"}
            )
            continue
        matches.extend(
            {
                "sourceId": source_id,
                "agencyName": name,
                "suggestedBaseUrl": url,
                "confidence": confidence,
            }
            for name, url, confidence in hits
        )
    return matches


def discover_sources(
    request,
    harvest=None,
    classify=None,
    match=None,
    jurisdictions=None,
    name_key=None,
):
    """Contract C3 / spec §4.2. Returns `{candidates, review, existingMatches, stats}`.

    `name_key` is injectable for the same reason `classify` and `match` are — it comes from
    the same contract (C2) and this module needs it to build ids and to run the §4.6 reverse
    lookup. Every parameter defaults to the real implementation.
    """
    started = perf_counter()
    settings = _validate_request(request)
    platform = settings["platform"]
    harvest, classify, match, jurisdictions, name_key = _resolve_helpers(
        platform, harvest, classify, match, jurisdictions, name_key
    )

    harvested = harvest(settings["harvest_request"]) or {}
    agencies = [agency for agency in (harvested.get("agencies") or []) if isinstance(agency, dict)]
    harvest_stats = dict(harvested.get("stats") or {})

    platform_meta = PLATFORMS[platform]
    tenant_key = TENANT_KEYS[platform]
    requested_levels = set(settings["levels"])
    # "Already registered" is a statement about the tenant, never about our id: two
    # jurisdictions can share a name key (Boulder County / City of Boulder -> `boulder`), and
    # one tenant can be registered under an id this run would not have picked.
    registered = _registered_tenants(
        settings["existing_base_urls"], settings["existing_sources"], tenant_key
    )
    # An existing id is only a name this run must not hand out again.
    taken_ids = set(settings["existing_ids"])
    taken_ids.update(source["id"].strip() for source in settings["existing_sources"])

    counts = dict((level, 0) for level in ALL_LEVELS)
    classified = []
    candidates = []
    review = []
    duplicates = 0
    unmatched = 0
    prefix_matched = 0

    for agency in agencies:
        name = (agency.get("name") or "").strip()
        tenant_url = (agency.get("tenant_url") or "").strip()
        state_code = (agency.get("state_code") or "").strip().upper() or None

        # The state is not decoration: "borough" is a county equivalent in Alaska but an
        # ordinary municipality in NJ/PA/CT, so the classifier needs it to get those right.
        level = classify(name, state_code) if name else "unknown"
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

        segment = _id_segment(name_key(name))
        if not segment:
            review.append(_review_entry(agency, "unusable_name"))
            continue
        base_id = "{0}_{1}_{2}".format(platform, state_code.lower(), segment)

        owner = registered.get(tenant_key(tenant_url))
        if owner is not None:
            duplicates += 1
            review.append(_review_entry(agency, "already_registered", owner))
            continue

        matched = match(level, state_code, name, table=jurisdictions) or {"status": "not_found"}
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

        source_id = _unique_id(base_id, taken_ids)
        taken_ids.add(source_id)
        candidates.append(
            {
                # The ten fields below are `SourceCandidate` in
                # `frontend/scripts/register-sources.ts`, field for field. Changing one means
                # changing both, and `register-sources.test.ts` fails when they drift.
                "id": source_id,
                "label": "{0} ({1})".format(name, platform_meta["label"]),
                "issuerType": level,
                "stateCode": state_code,
                "baseUrl": tenant_url,
                "jurisdictionLevel": level,
                "jurisdictionName": matched.get("name") or name,
                "fipsCode": matched.get("geoid") or "",
                "providerFamily": platform_meta["provider_family"],
                "cadence": DEFAULT_CADENCE,
                "fetchConfig": {"base_url": tenant_url},
                # Ignored by the registrar; it is here for the person doing the review.
                # `matchedPrefix` is null on an exact match and names the jurisdiction on a
                # prefix match, so a reviewer can tell a county apart from one of its
                # departments -- several departments legitimately share one GEOID.
                "discovery": {
                    "agencyName": name,
                    "group": agency.get("group"),
                    "matchedOn": level,
                    "confidence": confidence,
                    "matchedPrefix": matched.get("matched_prefix"),
                },
            }
        )

    return {
        "candidates": candidates,
        "review": review,
        "existingMatches": _existing_matches(settings["existing_sources"], classified, name_key, classify),
        "stats": {
            "pages": int(harvest_stats.get("pages") or 0),
            "agencies": len(agencies),
            "county": counts["county"],
            "city": counts["city"],
            "special_district": counts["special_district"],
            "unknown": counts["unknown"],
            "unmatched": unmatched,
            # Candidates whose GEOID came from the county-prefix rule, not an exact name.
            "prefix_matched": prefix_matched,
            # Agencies dropped because their tenant is already registered...
            "duplicates": duplicates,
            # ...as opposed to tenant paths the harvester saw more than once while paging.
            "harvest_duplicates": int(harvest_stats.get("duplicates") or 0),
            # Agencies the harvester itself dropped for having no state (only a `states` run).
            "unresolved_state_skipped": int(harvest_stats.get("unresolved_state_skipped") or 0),
            "stopped_reason": harvest_stats.get("stopped_reason"),
            "duration_ms": int((perf_counter() - started) * 1000),
        },
    }
