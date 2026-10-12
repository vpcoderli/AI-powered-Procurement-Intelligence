import argparse
import json
import os
import sqlite3
import sys
import traceback
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from apsi_crawler.adapters.registry import (
    AdapterNotFoundError,
    resolve_adapter,
    resolve_list_html_adapter,
)
from apsi_crawler.adapters.task import task_source_from_payload
from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.date_window import apply_date_window
from apsi_crawler.discovery_service import (
    InvalidSourceDiscoveryRequestError,
    discover_sources,
)
from apsi_crawler.enrichment import enrich_bids, parse_enrichment_config
from apsi_crawler.data_quality import body_of, core_issues, prepare_persisted_bid, record, redact_evidence, text
from apsi_crawler.detail_backfill import apply_detail_history, detail_priority, historical_candidates, outcome_of, retry_due
from apsi_crawler.errors import VerifiedEmptyListError
from apsi_crawler.robots_fetch import InvalidRobotsRequestError, fetch_robots
from apsi_crawler.list_extraction import (
    resolve_list_extraction_config,
    resolve_pagination_request,
    run_list_extraction,
    run_paginated_list_extraction,
)
from apsi_crawler.live_validation import (
    BETA_DEDICATED_STATE_SOURCES,
    validate_state_live_sources,
)
from apsi_crawler.tenant_discovery import InvalidDiscoveryRequestError, discover_tenant
from apsi_crawler.sources.registry import get_fixture_loader
from apsi_crawler.spiders.sam_gov_api import enrich_sam_gov_bids, fetch_sam_gov_opportunities
from apsi_crawler.storage.archive import archive_bid_documents
from apsi_crawler.storage.archive_attachments import (
    InvalidArchiveRequestError,
    archive_attachments,
)
from apsi_crawler.storage.sqlite import now_iso, upsert_bid, write_crawler_log


class EmptyCrawlerResultError(Exception):
    pass


def _upsert_bids(connection, bids, quality=None):
    inserted_count = 0
    updated_count = 0
    quality = quality if quality is not None else {}
    quality.update({"schemaVersion": 1, "checkedAt": now_iso(), "execution": "success", "listCoverage": "unknown",
                    "contentStatus": "unknown", "receivedCount": len(bids), "uniqueCount": 0, "acceptedCount": 0,
                    "quarantinedCount": 0, "duplicateCount": 0, "validBodyCount": 0, "retainedBodyCount": 0,
                    "fetchedBodyCount": 0, "analysisReadyCount": 0, "acceptedIds": [], "quarantinedRecords": [], "duplicateRecords": []})
    groups = []
    aliases = {}
    for index, bid in enumerate(bids):
        keys = [f"{field}:{text(bid.get(field))}" for field in ("id", "dedupe_key", "source_bid_id") if text(bid.get(field))]
        linked = []
        for key in keys:
            group = aliases.get(key)
            if group is not None and not any(group is previous for previous in linked):
                linked.append(group)
        group = linked[0] if linked else []
        if not linked:
            groups.append(group)
        for other in linked[1:]:
            group.extend(other)
            groups.remove(other)
            for key, value in list(aliases.items()):
                if value is other:
                    aliases[key] = group
        group.append((index, bid))
        for key in keys:
            aliases[key] = group
    if not connection.in_transaction:
        connection.execute("BEGIN IMMEDIATE")
    try:
        for group in groups:
            quality["uniqueCount"] += 1
            quality["duplicateCount"] += len(group) - 1
            ranked = sorted(group, key=lambda item: (len(core_issues(item[1])), -len(body_of(item[1])), item[0]))
            index, bid = ranked[0]
            quality["duplicateRecords"].extend({"index": duplicate_index, "id": duplicate.get("id"), "row": redact_evidence(duplicate)} for duplicate_index, duplicate in ranked[1:])
            issues = core_issues(bid)
            identity_fields = ("source_bid_id", "dedupe_key", "state_code", "issuer_type", "jurisdiction_level", "fips_code")
            if any(len({text(row.get(field)) for _, row in group if text(row.get(field))}) > 1 for field in identity_fields):
                issues.append("conflicting_duplicate_identity")
            cursor = connection.execute("SELECT * FROM bids WHERE id = ? LIMIT 1", (bid.get("id"),))
            stored = cursor.fetchone()
            if stored is None:
                cursor = connection.execute("SELECT * FROM bids WHERE dedupe_key = ? LIMIT 1", (bid.get("dedupe_key"),))
                stored = cursor.fetchone()
            existing = dict(zip((column[0] for column in cursor.description), stored)) if stored else None
            if existing and not core_issues(existing):
                issues.extend(f"identity_changed:{field}" for field in identity_fields if text(bid.get(field)) and text(existing.get(field)) and text(bid[field]) != text(existing[field]))
            if issues:
                quality["quarantinedRecords"].append({"index": index, "id": bid.get("id"), "issues": issues, "row": redact_evidence(bid)})
                quality["quarantinedCount"] += 1
                continue
            incoming = {**bid}
            if existing:
                incoming["id"] = existing["id"]
                if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='bid_attachments'").fetchone():
                    cursor = connection.execute("SELECT * FROM bid_attachments WHERE bid_id = ?", (existing["id"],))
                    old_files = [dict(zip((column[0] for column in cursor.description), row)) for row in cursor.fetchall()]
                    files = {file.get("url"): file for file in old_files}
                    for file in incoming.get("attachments") or []:
                        prior_file = files.get(file.get("url"), {})
                        merged_file = {**prior_file, **file}
                        same_archive = prior_file and all(merged_file.get(field) == prior_file.get(field) for field in ("storage_path", "byte_size", "content_type", "checksum_sha256"))
                        merged_file["verified_at"] = prior_file.get("verified_at") if same_archive else None
                        files[file.get("url")] = merged_file
                    incoming["attachments"] = list(files.values())
            merged = prepare_persisted_bid(incoming, existing, quality["checkedAt"])
            result = upsert_bid(connection, merged, commit=False)
            inserted_count += int(result == "inserted")
            updated_count += int(result == "updated")
            quality["acceptedCount"] += 1
            quality["acceptedIds"].append(merged["id"])
            body = record(record(merged.get("raw_payload")).get("data_quality"))["body"]
            quality["validBodyCount"] += int(body["valid"])
            quality["retainedBodyCount"] += int(body["valid"] and body["reused"])
        quality["fetchedBodyCount"] = quality["validBodyCount"] - quality["retainedBodyCount"]
        quality["analysisReadyCount"] = quality["validBodyCount"]
        quality["contentStatus"] = "unusable" if not quality["acceptedCount"] else "partial" if quality["quarantinedCount"] or quality["validBodyCount"] < quality["acceptedCount"] else "usable"
        quality["reconciliation"] = {"observed": quality["uniqueCount"], "accepted": quality["acceptedCount"], "quarantined": quality["quarantinedCount"], "balanced": quality["uniqueCount"] == quality["acceptedCount"] + quality["quarantinedCount"]}
    except Exception:
        connection.rollback()
        raise
    return inserted_count, updated_count


def _default_archive_dir(database):
    return str(Path(database).resolve().parent / "attachments")


def _archive_target_dir(database, archive_dir):
    if archive_dir:
        return archive_dir
    if database:
        return _default_archive_dir(database)
    return str(Path.cwd() / "attachments")


def _archive_summary(bids):
    summary = {"archived": 0, "failed": 0, "unavailable": 0}
    for bid in bids:
        for attachment in bid.get("attachments") or []:
            status = attachment.get("archive_status")
            if status in summary:
                summary[status] += 1
        detail_status = bid.get("detail_archive_status")
        if detail_status in summary:
            summary[detail_status] += 1
    return summary


def _archive_bids(bids, archive_dir, fetch_detail=False):
    return [
        archive_bid_documents(
            bid,
            archive_dir,
            fetch_detail=fetch_detail,
        ) if not core_issues(bid) else bid
        for bid in bids
    ]


def _oldest_candidates(candidates, budget):
    """A backfill run's attempt budget of due candidates, oldest attempt first; the rest wait.

    Rows still cooling down never take a slot, as in the parent's own selection: a candidate this
    run cannot attempt keeps its old attempt time and would otherwise come first every run.
    """
    timestamp = now_iso()
    due = [row for row in candidates if retry_due(row, timestamp)]
    return sorted(due, key=lambda row: detail_priority(row, timestamp))[:max(budget, 0)]


def _require_non_empty_bids(bids, source):
    if not bids:
        raise EmptyCrawlerResultError(f"Crawler returned no opportunities for source: {source}")
    return bids


def _json_run_payload(
    *,
    source,
    run_id,
    status,
    started_at,
    finished_at,
    duration_ms,
    metadata=None,
    bids=None,
    error_code=None,
    error_message=None,
    error_stack=None,
):
    return {
        "source": source,
        "runId": run_id,
        "status": status,
        "startedAt": started_at,
        "finishedAt": finished_at,
        "durationMs": duration_ms,
        "metadata": metadata or {},
        "bids": bids or [],
        "errorCode": error_code,
        "errorMessage": error_message,
        "errorStack": error_stack,
    }


def _print_json_payload(payload):
    print(json.dumps(payload, separators=(",", ":"), sort_keys=True))


def import_fixture(
    database,
    fixture,
    source=DEFAULT_SOURCE,
    archive_documents=False,
    archive_dir=None,
    archive_detail_pages=False,
):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    connection = None
    if database:
        Path(database).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(database)

    try:
        loader = get_fixture_loader(source)
        bids = loader(fixture)
        _require_non_empty_bids(bids, source)
        if archive_documents:
            bids = _archive_bids(bids, archive_dir or _default_archive_dir(database), archive_detail_pages)
        quality = {}
        inserted_count, updated_count = _upsert_bids(connection, bids, quality)
        metadata = {"dataQuality": quality}
        if archive_documents:
            metadata["archive"] = _archive_summary(bids)

        write_crawler_log(
            connection,
            source=source,
            run_id=run_id,
            status="success",
            fetched_count=len(bids),
            inserted_count=inserted_count,
            updated_count=updated_count,
            started_at=started_at,
            finished_at=now_iso(),
            duration_ms=int((perf_counter() - started) * 1000),
            metadata=metadata,
        )
        return 0
    except Exception as error:
        if connection:
            connection.rollback()
        write_crawler_log(
            connection,
            source=source,
            run_id=run_id,
            status="failure",
            fetched_count=0,
            inserted_count=0,
            updated_count=0,
            failed_count=1,
            started_at=started_at,
            finished_at=now_iso(),
            duration_ms=int((perf_counter() - started) * 1000),
            error_code=type(error).__name__,
            error_message=str(error),
            error_stack=traceback.format_exc(),
            metadata={"fixture": fixture},
        )
        return 1
    finally:
        connection.close()


def fetch_sam_gov(
    database,
    posted_from,
    posted_to,
    api_key=None,
    limit=100,
    max_records=None,
    archive_documents=False,
    archive_dir=None,
    archive_detail_pages=False,
    output_json=False,
    max_descriptions=25,
    detail_history=None,
    detail_backfill_only=False,
):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    connection = None
    if database:
        Path(database).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(database)
    try:
        resolved_key = api_key or os.environ.get("SAM_API_KEY", "")
        if detail_backfill_only:
            bids = enrich_sam_gov_bids(_oldest_candidates(historical_candidates(detail_history, "sam_gov"), max_descriptions),
                                       resolved_key, max_descriptions=max_descriptions, backfill=True)
        else:
            bids = fetch_sam_gov_opportunities(
                api_key=resolved_key,
                posted_from=posted_from,
                posted_to=posted_to,
                limit=limit,
                max_records=max_records,
                max_descriptions=max_descriptions,
                detail_history=detail_history,
            )
        _require_non_empty_bids(bids, DEFAULT_SOURCE)
        if archive_documents:
            bids = _archive_bids(bids, _archive_target_dir(database, archive_dir), archive_detail_pages)
        inserted_count = 0
        updated_count = 0
        quality = {}
        if connection:
            inserted_count, updated_count = _upsert_bids(connection, bids, quality)
        metadata = {"posted_from": posted_from, "posted_to": posted_to, "limit": limit}
        if quality:
            metadata["dataQuality"] = quality
        outcomes = [outcome_of(bid) for bid in bids]
        metadata["enrichment"] = {
            "attempted": sum(outcome.get("attempted") is True for outcome in outcomes),
            "enriched": sum(bool((bid.get("raw_payload") or {}).get("enrichment", {}).get("applied_fields")) for bid in bids),
            "valid_bodies": sum(outcome.get("attempted") is True and outcome.get("status") == "success" for outcome in outcomes),
            "failed": sum(outcome.get("status") in ("failure", "restricted") for outcome in outcomes),
            "skipped": sum(outcome.get("attempted") is not True for outcome in outcomes),
        }
        if detail_backfill_only:
            metadata["mode"] = "detail_backfill"
            metadata["pagination"] = {"complete": False, "stopped_reason": "detail_backfill", "requests_made": metadata["enrichment"]["attempted"]}
        if archive_documents:
            metadata["archive"] = _archive_summary(bids)
        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)

        if connection:
            write_crawler_log(
                connection,
                source=DEFAULT_SOURCE,
                run_id=run_id,
                status="success",
                fetched_count=len(bids),
                inserted_count=inserted_count,
                updated_count=updated_count,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=duration_ms,
                metadata=metadata,
            )
        if output_json:
            _print_json_payload(
                _json_run_payload(
                    source=DEFAULT_SOURCE,
                    run_id=run_id,
                    status="success",
                    started_at=started_at,
                    finished_at=finished_at,
                    duration_ms=duration_ms,
                    metadata=metadata,
                    bids=bids,
                )
            )
        return 0
    except Exception as error:
        if connection:
            connection.rollback()
        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)
        error_code = type(error).__name__
        error_message = str(error)
        error_stack = traceback.format_exc()
        metadata = {"posted_from": posted_from, "posted_to": posted_to, "limit": limit}
        if connection:
            write_crawler_log(
                connection,
                source=DEFAULT_SOURCE,
                run_id=run_id,
                status="failure",
                fetched_count=0,
                inserted_count=0,
                updated_count=0,
                failed_count=1,
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=duration_ms,
                error_code=error_code,
                error_message=error_message,
                error_stack=error_stack,
                metadata=metadata,
            )
        if output_json:
            _print_json_payload(
                _json_run_payload(
                    source=DEFAULT_SOURCE,
                    run_id=run_id,
                    status="failure",
                    started_at=started_at,
                    finished_at=finished_at,
                    duration_ms=duration_ms,
                    metadata=metadata,
                    error_code=error_code,
                    error_message=error_message,
                    error_stack=error_stack,
                )
            )
        return 1
    finally:
        if connection:
            connection.close()


def _adapter_list_stats(bids):
    return {
        "method": "adapter",
        "items": len(bids),
        "diagnostics": {},
        "rendered": False,
        "extractor": None,
        "fallback_reason": None,
    }


def run_list_stage(source, adapter, payload, query, limit):
    """Produce the list-stage bids, `metadata.listExtraction` and (paged adapters) `metadata.pagination`.

    Scrapling is the MAIN path whenever the sidecar is configured and the adapter can hand over
    raw list HTML; otherwise (and on any sidecar problem) the adapter's own parser runs. Paged
    adapters (BidNet) walk the list page by page on the same rule, one request per page.
    """
    fetch_config = payload.get("fetch_config")
    list_adapter = resolve_list_html_adapter(source.id, payload.get("provider_family"))
    config = resolve_list_extraction_config(
        fetch_config,
        os.environ.get("SCRAPLING_EXTRACTOR_URL", "").strip(),
        list_adapter is not None,
    )
    if list_adapter is not None and list_adapter.page_reader is not None:
        request = resolve_pagination_request(payload)
        return run_paginated_list_extraction(source, list_adapter, config, request, query=query, limit=limit)

    single_page_limit = limit if limit is not None else 25
    if config["mode"] != "scrapling":
        bids = adapter(source, query=query, limit=single_page_limit)
        return bids, _adapter_list_stats(bids), None

    bids, stats = run_list_extraction(source, list_adapter, config, query=query, limit=single_page_limit)
    return bids, stats, None


def fetch_task(payload):
    """执行单个抓取任务。输入为任务 JSON,输出结果 JSON 到 stdout。

    与 fetch_state 的区别:源信息全部来自 payload,不查硬编码 registry;
    不做 fixture 回退——空结果就是失败,这样 last_success_at 才是真信号。
    """
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    task_id = payload.get("task_id")
    source_id = payload.get("source_id")
    raw_limit = payload.get("limit")
    limit = int(raw_limit) if raw_limit not in (None, "") else None
    query = payload.get("query")
    date_range = payload.get("date_range")
    metadata = {"mode": "live", "query": query, "limit": limit, "task_id": task_id}

    try:
        source = task_source_from_payload(payload)
        if payload.get("detail_backfill_only") is True:
            budget = parse_enrichment_config(payload.get("fetch_config"))["max_details_per_run"]
            bids = _oldest_candidates(historical_candidates(payload.get("detail_history"), source.id, source), budget)
            _require_non_empty_bids(bids, source.id)
            bids, enrichment_stats = enrich_bids(bids, source, payload.get("fetch_config"), backfill=True)
            metadata.update({"mode": "detail_backfill", "enrichment": enrichment_stats,
                             "pagination": {"complete": False, "stopped_reason": "detail_backfill", "requests_made": enrichment_stats["attempted"]}})
            result = _json_run_payload(source=source.id, run_id=run_id, status="success", started_at=started_at,
                                       finished_at=now_iso(), duration_ms=int((perf_counter() - started) * 1000), metadata=metadata, bids=bids)
            result["taskId"] = task_id
            _print_json_payload(result)
            return 0
        adapter = resolve_adapter(source.id, payload.get("provider_family"))
        metadata["adapter"] = getattr(adapter, "__name__", "unknown")

        try:
            bids, list_stats, pagination = run_list_stage(source, adapter, payload, query, limit)
        except VerifiedEmptyListError as error:
            if not error.tenant_confirmed:
                # An empty phrase we could not tie to THIS tenant (404 shell, wrong slug,
                # generic search chrome) must stay a failure — otherwise a broken source
                # reports healthy forever.
                raise EmptyCrawlerResultError(
                    f"Crawler returned no opportunities for source: {source.id} "
                    f"(empty-state marker {error.marker!r} could not be tied to the source label)"
                ) from error
            metadata["emptyState"] = error.as_metadata()
            metadata["listExtraction"] = {
                "method": error.method, "items": 0, "diagnostics": {}, "rendered": False,
                "extractor": None, "fallback_reason": None,
            }
            if error.discarded_offsite_rows:
                metadata["listExtraction"]["discarded_offsite_rows"] = error.discarded_offsite_rows
            if error.discarded_navigation_rows:
                metadata["listExtraction"]["discarded_navigation_rows"] = error.discarded_navigation_rows
            if error.pagination is not None:
                metadata["pagination"] = dict(error.pagination)
            finished_at = now_iso()
            result = _json_run_payload(
                source=source.id,
                run_id=run_id,
                status="success",
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=int((perf_counter() - started) * 1000),
                metadata=metadata,
                bids=[],
            )
            result["taskId"] = task_id
            _print_json_payload(result)
            return 0

        metadata["listExtraction"] = list_stats
        # Liveness check runs BEFORE the window filter: an adapter that fetched real
        # rows must count as a live source even when the window then drops them all.
        _require_non_empty_bids(bids, source.id)
        # Optional detail-page enrichment (fetch_config.enrichment.enabled). Runs after the
        # liveness check and before the date window so filtered-out rows are never fetched
        # twice... but is ALWAYS fail-open: any crash here is recorded, never raised.
        try:
            apply_detail_history(bids, payload.get("detail_history"), source.id)
            bids, enrichment_stats = enrich_bids(bids, source, payload.get("fetch_config"))
        except Exception as error:  # noqa: BLE001 - enrichment must never fail the run
            enrichment_stats = {
                "attempted": 0, "enriched": 0, "failed": 0, "skipped": len(bids),
                "reason": "enrichment_crashed", "extractor": None, "error": f"{type(error).__name__}: {error}",
            }
        metadata["enrichment"] = enrichment_stats
        bids, date_filter_stats = apply_date_window(bids, date_range)
        if date_filter_stats is not None:
            metadata["dateFilter"] = date_filter_stats
        if pagination is not None:
            # A date window drops rows the walk did see, so the run can no longer prove which
            # open bids disappeared; enrichment detail fetches hit the same platform budget.
            if date_filter_stats is not None:
                pagination["complete"] = False
            pagination["requests_made"] += int(enrichment_stats.get("attempted") or 0)
            metadata["pagination"] = pagination

        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)
        result = _json_run_payload(
            source=source.id,
            run_id=run_id,
            status="success",
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=duration_ms,
            metadata=metadata,
            bids=bids,
        )
        result["taskId"] = task_id
        _print_json_payload(result)
        return 0
    except Exception as error:
        finished_at = now_iso()
        duration_ms = int((perf_counter() - started) * 1000)
        result = _json_run_payload(
            source=source_id,
            run_id=run_id,
            status="failure",
            started_at=started_at,
            finished_at=finished_at,
            duration_ms=duration_ms,
            metadata=metadata,
            bids=[],
            error_code=type(error).__name__,
            error_message=str(error),
            error_stack=traceback.format_exc(),
        )
        result["taskId"] = task_id
        _print_json_payload(result)
        return 1


def archive_attachments_command(stream=None):
    """Contract C1: read one JSON request from stdin, write one JSON response to stdout.

    Exit 0 whenever the request could be executed — per-item failures travel inside
    `results`. Exit 2 (with `{"error": {...}}` on stdout) only when the request itself is
    unusable. Every diagnostic line goes to stderr so stdout stays a single JSON document.
    """
    stream = stream if stream is not None else sys.stdin
    try:
        payload = json.load(stream)
    except ValueError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": f"stdin was not valid JSON: {error}"}})
        return 2

    try:
        response = archive_attachments(payload)
    except InvalidArchiveRequestError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": str(error)}})
        return 2
    except Exception as error:  # noqa: BLE001 - stdout must still be exactly one JSON document
        print(traceback.format_exc(), file=sys.stderr)
        _print_json_payload(
            {"error": {"code": type(error).__name__, "message": str(error)}}
        )
        return 2

    _print_json_payload(response)
    return 0


def discover_tenant_command(stream=None):
    """Contract C4: one JSON request on stdin, one JSON response on stdout.

    Exit 0 when the probe ran (a fruitless probe is still a result); exit 2 only when the
    request itself is unusable. Diagnostics go to stderr so stdout stays a single document.
    """
    stream = stream if stream is not None else sys.stdin
    try:
        payload = json.load(stream)
    except ValueError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": f"stdin was not valid JSON: {error}"}})
        return 2

    try:
        response = discover_tenant(payload)
    except InvalidDiscoveryRequestError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": str(error)}})
        return 2
    except Exception as error:  # noqa: BLE001 - stdout must still be exactly one JSON document
        print(traceback.format_exc(), file=sys.stderr)
        _print_json_payload({"error": {"code": type(error).__name__, "message": str(error)}})
        return 2

    _print_json_payload(response)
    return 0


def discover_sources_command(stream=None):
    """Contract C3: one JSON request on stdin, one JSON response on stdout.

    Exit 0 whenever the directory walk ran at all — a partial walk (a WAF challenge, the
    `max_pages` cap) is still a usable result and says so in `stats.stopped_reason`. Exit 2
    only when the request itself is unusable. Diagnostics go to stderr so stdout stays a
    single JSON document that can be piped straight into `npm run source:register`.
    """
    stream = stream if stream is not None else sys.stdin
    try:
        payload = json.load(stream)
    except ValueError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": f"stdin was not valid JSON: {error}"}})
        return 2

    try:
        response = discover_sources(payload)
    except InvalidSourceDiscoveryRequestError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": str(error)}})
        return 2
    except Exception as error:  # noqa: BLE001 - stdout must still be exactly one JSON document
        print(traceback.format_exc(), file=sys.stderr)
        _print_json_payload({"error": {"code": type(error).__name__, "message": str(error)}})
        return 2

    stats = response.get("stats") or {}
    print(
        "discover-sources: {0} candidates, {1} for review, {2} agencies over {3} pages"
        " (stopped: {4})".format(
            len(response.get("candidates") or []),
            len(response.get("review") or []),
            stats.get("agencies", 0),
            stats.get("pages", 0),
            stats.get("stopped_reason"),
        ),
        file=sys.stderr,
    )
    _print_json_payload(response)
    return 0


def fetch_robots_command(stream=None):
    """One JSON request ({"base_url"}) on stdin, one JSON robots.txt document on stdout."""
    stream = stream if stream is not None else sys.stdin
    try:
        payload = json.load(stream)
    except ValueError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": f"stdin was not valid JSON: {error}"}})
        return 2
    try:
        response = fetch_robots(payload)
    except InvalidRobotsRequestError as error:
        _print_json_payload({"error": {"code": "INVALID_REQUEST", "message": str(error)}})
        return 2
    except Exception as error:  # noqa: BLE001 - stdout must still be exactly one JSON document
        print(traceback.format_exc(), file=sys.stderr)
        _print_json_payload({"error": {"code": type(error).__name__, "message": str(error)}})
        return 2
    _print_json_payload(response)
    return 0


def build_parser():
    parser = argparse.ArgumentParser(prog="apsi-crawler")
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_fixture_parser = subparsers.add_parser("import-fixture")
    import_fixture_parser.add_argument("--database", required=True)
    import_fixture_parser.add_argument("--fixture", required=True)
    import_fixture_parser.add_argument("--source", default=DEFAULT_SOURCE)
    import_fixture_parser.add_argument("--archive-documents", action="store_true")
    import_fixture_parser.add_argument("--archive-dir")
    import_fixture_parser.add_argument("--archive-detail-pages", action="store_true")

    fetch_sam_gov_parser = subparsers.add_parser("fetch-sam-gov")
    fetch_sam_gov_parser.add_argument("--database")
    fetch_sam_gov_parser.add_argument("--api-key")
    fetch_sam_gov_parser.add_argument("--posted-from", required=True)
    fetch_sam_gov_parser.add_argument("--posted-to", required=True)
    fetch_sam_gov_parser.add_argument("--limit", type=int, default=100)
    fetch_sam_gov_parser.add_argument("--max-records", type=int)
    fetch_sam_gov_parser.add_argument("--max-descriptions", type=int, default=25)
    fetch_sam_gov_parser.add_argument("--archive-documents", action="store_true")
    fetch_sam_gov_parser.add_argument("--archive-dir")
    fetch_sam_gov_parser.add_argument("--archive-detail-pages", action="store_true")
    fetch_sam_gov_parser.add_argument("--output-json", action="store_true")
    fetch_sam_gov_parser.add_argument("--detail-history-stdin", action="store_true")
    fetch_sam_gov_parser.add_argument("--detail-backfill-only", action="store_true")

    subparsers.add_parser("fetch-task")

    subparsers.add_parser("archive-attachments")

    subparsers.add_parser("discover-tenant")
    subparsers.add_parser("discover-sources")
    subparsers.add_parser("fetch-robots")

    validate_state_live_parser = subparsers.add_parser("validate-state-live")
    validate_state_live_parser.add_argument(
        "--source",
        action="append",
        choices=BETA_DEDICATED_STATE_SOURCES,
        help=(
            "Beta dedicated state source to validate. Repeat to validate multiple. "
            "Defaults to all beta dedicated sources."
        ),
    )
    validate_state_live_parser.add_argument("--query")
    validate_state_live_parser.add_argument("--limit", type=int, default=25)
    validate_state_live_parser.add_argument("--timeout", type=int, default=30)

    return parser


def _print_live_validation_result(result):
    for source_result in result.sources:
        line = (
            f"{source_result.source} {source_result.status} "
            f"fetched={source_result.fetched_count}"
        )
        if source_result.error_code:
            line = f"{line} error={source_result.error_code}: {source_result.error_message}"
        print(line)


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "fetch-sam-gov" and not args.database and not args.output_json:
        parser.error("--database is required unless --output-json is used")

    if args.command == "import-fixture":
        return import_fixture(
            args.database,
            args.fixture,
            args.source,
            archive_documents=args.archive_documents,
            archive_dir=args.archive_dir,
            archive_detail_pages=args.archive_detail_pages,
        )

    if args.command == "fetch-sam-gov":
        return fetch_sam_gov(
            args.database,
            posted_from=args.posted_from,
            posted_to=args.posted_to,
            api_key=args.api_key,
            limit=args.limit,
            max_records=args.max_records,
            max_descriptions=args.max_descriptions,
            detail_history=json.load(sys.stdin) if args.detail_history_stdin else None,
            detail_backfill_only=args.detail_backfill_only,
            archive_documents=args.archive_documents,
            archive_dir=args.archive_dir,
            archive_detail_pages=args.archive_detail_pages,
            output_json=args.output_json,
        )

    if args.command == "fetch-task":
        return fetch_task(json.load(sys.stdin))

    if args.command == "archive-attachments":
        return archive_attachments_command()

    if args.command == "fetch-robots":
        return fetch_robots_command()
    if args.command == "discover-tenant":
        return discover_tenant_command()
    if args.command == "discover-sources":
        return discover_sources_command()

    if args.command == "validate-state-live":
        result = validate_state_live_sources(
            source_ids=args.source,
            query=args.query,
            limit=args.limit,
            timeout=args.timeout,
        )
        _print_live_validation_result(result)
        return 0 if result.ok else 1

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
