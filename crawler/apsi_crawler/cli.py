import argparse
import sqlite3
from pathlib import Path
from time import perf_counter
from uuid import uuid4

from apsi_crawler.config import DEFAULT_SOURCE
from apsi_crawler.sources.registry import get_fixture_loader
from apsi_crawler.storage.sqlite import now_iso, upsert_bid, write_crawler_log


def import_fixture(database, fixture, source=DEFAULT_SOURCE):
    started_at = now_iso()
    started = perf_counter()
    run_id = str(uuid4())
    Path(database).parent.mkdir(parents=True, exist_ok=True)

    connection = sqlite3.connect(database)
    try:
        loader = get_fixture_loader(source)
        bids = loader(fixture)
        inserted_count = 0
        updated_count = 0

        for bid in bids:
            result = upsert_bid(connection, bid)
            if result == "inserted":
                inserted_count += 1
            elif result == "updated":
                updated_count += 1

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


def build_parser():
    parser = argparse.ArgumentParser(prog="apsi-crawler")
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_fixture_parser = subparsers.add_parser("import-fixture")
    import_fixture_parser.add_argument("--database", required=True)
    import_fixture_parser.add_argument("--fixture", required=True)
    import_fixture_parser.add_argument("--source", default=DEFAULT_SOURCE)

    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command == "import-fixture":
        return import_fixture(args.database, args.fixture, args.source)

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
