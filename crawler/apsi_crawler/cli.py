import argparse
import os
import sqlite3
import traceback
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.live_validation import (
    BETA_DEDICATED_STATE_SOURCES,
    validate_state_live_sources,
)
from apsi_crawler.sources.registry import get_fixture_loader, get_live_fetcher, get_source
from apsi_crawler.spiders.ca_caleprocure import fetch_ca_caleprocure_opportunities
from apsi_crawler.spiders.fl_mfmp import fetch_fl_mfmp_opportunities
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities
from apsi_crawler.spiders.ny_contract_reporter import fetch_ny_contract_reporter_opportunities
from apsi_crawler.spiders.sam_gov_api import fetch_sam_gov_opportunities
from apsi_crawler.spiders.tx_esbd import fetch_tx_esbd_opportunities
from apsi_crawler.storage.archive import archive_bid_documents
from apsi_crawler.storage.sqlite import now_iso, upsert_bid, write_crawler_log


STATE_FALLBACK_FIXTURES = {
    "ca_caleprocure": ("fixture_json", "ca_caleprocure_live_response.json"),
    "tx_esbd": ("fixture_json", "tx_esbd_live_response.json"),
    "ny_contract_reporter": ("fixture_json", "ny_contract_reporter_live_response.json"),
    "fl_mfmp": ("fixture_json", "fl_mfmp_live_response.json"),
    "il_bidbuy": ("fixture_html", "il_bidbuy_open_bids.html"),
}

STATE_FALLBACK_FETCHERS = {
    "ca_caleprocure": fetch_ca_caleprocure_opportunities,
    "tx_esbd": fetch_tx_esbd_opportunities,
    "ny_contract_reporter": fetch_ny_contract_reporter_opportunities,
    "fl_mfmp": fetch_fl_mfmp_opportunities,
    "il_bidbuy": fetch_il_bidbuy_opportunities,
}


class EmptyCrawlerResultError(Exception):
    pass


def _bundled_fixture_path(filename):
    return Path(__file__).resolve().parents[1] / "tests" / "fixtures" / filename


def _fallback_fixture_for_source(source):
    fixture = STATE_FALLBACK_FIXTURES.get(source)
    if not fixture:
        return None

    fixture_kind, filename = fixture
    path = _bundled_fixture_path(filename)
    if not path.exists():
        return None

    return fixture_kind, str(path)


def _upsert_bids(connection, bids):
    inserted_count = 0
    updated_count = 0

    for bid in bids:
        result = upsert_bid(connection, bid)
        if result == "inserted":
            inserted_count += 1
        elif result == "updated":
            updated_count += 1

    return inserted_count, updated_count


def _default_archive_dir(database):
    return str(Path(database).resolve().parent / "attachments")


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
        )
        for bid in bids
    ]


def _require_non_empty_bids(bids, source):
    if not bids:
        raise EmptyCrawlerResultError(f"Crawler returned no opportunities for source: {source}")
    return bids


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
    Path(database).parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database)
    try:
        loader = get_fixture_loader(source)
        bids = loader(fixture)
        _require_non_empty_bids(bids, source)
        if archive_documents:
            bids = _archive_bids(bids, archive_dir or _default_archive_dir(database), archive_detail_pages)
        inserted_count, updated_count = _upsert_bids(connection, bids)
        metadata = {"archive": _archive_summary(bids)} if archive_documents else None

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
):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    Path(database).parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database)
    try:
        bids = fetch_sam_gov_opportunities(
            api_key=api_key or os.environ.get("SAM_API_KEY", ""),
            posted_from=posted_from,
            posted_to=posted_to,
            limit=limit,
            max_records=max_records,
        )
        _require_non_empty_bids(bids, DEFAULT_SOURCE)
        if archive_documents:
            bids = _archive_bids(bids, archive_dir or _default_archive_dir(database), archive_detail_pages)
        inserted_count, updated_count = _upsert_bids(connection, bids)
        metadata = {"posted_from": posted_from, "posted_to": posted_to, "limit": limit}
        if archive_documents:
            metadata["archive"] = _archive_summary(bids)

        write_crawler_log(
            connection,
            source=DEFAULT_SOURCE,
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
            finished_at=now_iso(),
            duration_ms=int((perf_counter() - started) * 1000),
            error_code=type(error).__name__,
            error_message=str(error),
            error_stack=traceback.format_exc(),
            metadata={"posted_from": posted_from, "posted_to": posted_to, "limit": limit},
        )
        return 1
    finally:
        connection.close()


def fetch_state(
    database,
    source,
    query=None,
    limit=25,
    fixture_json=None,
    fixture_html=None,
    fallback_fixture=False,
    archive_documents=False,
    archive_dir=None,
    archive_detail_pages=False,
):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    metadata = {"mode": "live", "query": query, "limit": limit}
    if fixture_json:
        metadata["fixture_json"] = fixture_json
    if fixture_html:
        metadata["fixture_html"] = fixture_html

    connection = sqlite3.connect(database)
    try:
        source_metadata = get_source(source)
        fetcher = get_live_fetcher(source)
        fetch_kwargs = {"query": query, "limit": limit}
        if fixture_json:
            fetch_kwargs["fixture_json"] = fixture_json
        if fixture_html:
            fetch_kwargs["fixture_html"] = fixture_html
        try:
            bids = fetcher(source_metadata, **fetch_kwargs)
        except Exception as error:
            fallback = (
                _fallback_fixture_for_source(source_metadata.id)
                if fallback_fixture and not fixture_json and not fixture_html
                else None
            )
            fallback_fetcher = STATE_FALLBACK_FETCHERS.get(source_metadata.id)
            if not fallback or not fallback_fetcher:
                raise

            fixture_kind, fixture_path = fallback
            metadata["fallback_fixture"] = fixture_path
            metadata["fallback_reason"] = str(error)
            metadata["fallback_source"] = "bundled_demo_fixture"
            fallback_kwargs = {"query": query, "limit": limit, fixture_kind: fixture_path}
            bids = fallback_fetcher(source_metadata, **fallback_kwargs)

        _require_non_empty_bids(bids, source_metadata.id)
        if archive_documents:
            bids = _archive_bids(bids, archive_dir or _default_archive_dir(database), archive_detail_pages)
            metadata["archive"] = _archive_summary(bids)
        inserted_count, updated_count = _upsert_bids(connection, bids)

        write_crawler_log(
            connection,
            source=source_metadata.id,
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
            metadata=metadata,
        )
        return 1
    finally:
        connection.close()


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
    fetch_sam_gov_parser.add_argument("--database", required=True)
    fetch_sam_gov_parser.add_argument("--api-key")
    fetch_sam_gov_parser.add_argument("--posted-from", required=True)
    fetch_sam_gov_parser.add_argument("--posted-to", required=True)
    fetch_sam_gov_parser.add_argument("--limit", type=int, default=100)
    fetch_sam_gov_parser.add_argument("--max-records", type=int)
    fetch_sam_gov_parser.add_argument("--archive-documents", action="store_true")
    fetch_sam_gov_parser.add_argument("--archive-dir")
    fetch_sam_gov_parser.add_argument("--archive-detail-pages", action="store_true")

    fetch_state_parser = subparsers.add_parser("fetch-state")
    fetch_state_parser.add_argument("--database", required=True)
    fetch_state_parser.add_argument("--source", required=True)
    fetch_state_parser.add_argument("--query")
    fetch_state_parser.add_argument("--limit", type=int, default=25)
    fetch_state_parser.add_argument("--fixture-json")
    fetch_state_parser.add_argument("--fixture-html")
    fetch_state_parser.add_argument("--fallback-fixture", action="store_true")
    fetch_state_parser.add_argument("--archive-documents", action="store_true")
    fetch_state_parser.add_argument("--archive-dir")
    fetch_state_parser.add_argument("--archive-detail-pages", action="store_true")

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
            archive_documents=args.archive_documents,
            archive_dir=args.archive_dir,
            archive_detail_pages=args.archive_detail_pages,
        )

    if args.command == "fetch-state":
        return fetch_state(
            args.database,
            source=args.source,
            query=args.query,
            limit=args.limit,
            fixture_json=args.fixture_json,
            fixture_html=args.fixture_html,
            fallback_fixture=args.fallback_fixture,
            archive_documents=args.archive_documents,
            archive_dir=args.archive_dir,
            archive_detail_pages=args.archive_detail_pages,
        )

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
