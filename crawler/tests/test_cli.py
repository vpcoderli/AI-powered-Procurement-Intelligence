import sqlite3
from pathlib import Path

from apsi_crawler.cli import main


def test_import_fixture_writes_bids_and_crawler_log(tmp_path):
    database = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(database)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          full_description TEXT,
          original_category TEXT,
          amount TEXT,
          amount_min INTEGER,
          amount_max INTEGER,
          currency TEXT NOT NULL DEFAULT 'USD',
          published_date TEXT,
          deadline_date TEXT,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          contact_name TEXT,
          contact_email TEXT,
          contact_phone TEXT,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          raw_payload TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE crawler_logs (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          duration_ms INTEGER,
          fetched_count INTEGER NOT NULL DEFAULT 0,
          inserted_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          error_code TEXT,
          error_message TEXT,
          error_stack TEXT,
          metadata TEXT
        );
        """
    )
    connection.close()
    fixture = Path(__file__).parent / "fixtures" / "sam_gov_opportunities.json"

    exit_code = main(
        [
            "import-fixture",
            "--database",
            str(database),
            "--fixture",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 2
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count FROM crawler_logs"
    ).fetchone()
    assert log == ("SAM.gov", "success", 2, 2, 0)
