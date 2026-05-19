import argparse
import os
import sqlite3
import traceback
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.registry import get_fixture_loader, get_live_fetcher, get_source
from apsi_crawler.spiders.sam_gov_api import fetch_sam_gov_opportunities
from apsi_crawler.storage.sqlite import now_iso, upsert_bid, write_crawler_log


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


def import_fixture(database, fixture, source=DEFAULT_SOURCE):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    Path(database).parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database)
    try:
        loader = get_fixture_loader(source)
        bids = loader(fixture)
        inserted_count, updated_count = _upsert_bids(connection, bids)

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
        )
        return 0
    finally:
        connection.close()


def fetch_sam_gov(database, posted_from, posted_to, api_key=None, limit=100, max_records=None):
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
        inserted_count, updated_count = _upsert_bids(connection, bids)

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
            metadata={"posted_from": posted_from, "posted_to": posted_to, "limit": limit},
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
        bids = fetcher(source_metadata, **fetch_kwargs)
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

    fetch_sam_gov_parser = subparsers.add_parser("fetch-sam-gov")
    fetch_sam_gov_parser.add_argument("--database", required=True)
    fetch_sam_gov_parser.add_argument("--api-key")
    fetch_sam_gov_parser.add_argument("--posted-from", required=True)
    fetch_sam_gov_parser.add_argument("--posted-to", required=True)
    fetch_sam_gov_parser.add_argument("--limit", type=int, default=100)
    fetch_sam_gov_parser.add_argument("--max-records", type=int)

    fetch_state_parser = subparsers.add_parser("fetch-state")
    fetch_state_parser.add_argument("--database", required=True)
    fetch_state_parser.add_argument("--source", required=True)
    fetch_state_parser.add_argument("--query")
    fetch_state_parser.add_argument("--limit", type=int, default=25)
    fetch_state_parser.add_argument("--fixture-json")
    fetch_state_parser.add_argument("--fixture-html")

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "import-fixture":
        return import_fixture(args.database, args.fixture, args.source)

    if args.command == "fetch-sam-gov":
        return fetch_sam_gov(
            args.database,
            posted_from=args.posted_from,
            posted_to=args.posted_to,
            api_key=args.api_key,
            limit=args.limit,
            max_records=args.max_records,
        )

    if args.command == "fetch-state":
        return fetch_state(
            args.database,
            source=args.source,
            query=args.query,
            limit=args.limit,
            fixture_json=args.fixture_json,
            fixture_html=args.fixture_html,
        )

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
