import sqlite3
from pathlib import Path

from apsi_crawler.cli import main


def create_crawler_database(database):
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


def normalized_bid():
    timestamp = "2026-05-19T00:00:00+00:00"
    return {
        "id": "sam_gov:abc-123",
        "source": "SAM.gov",
        "source_bid_id": "abc-123",
        "dedupe_key": "sam_gov:abc-123",
        "title": "Cloud analytics platform",
        "description": "Build cloud analytics.",
        "issuer_name": "Department of Health",
        "issuer_type": "federal",
        "state_code": "US",
        "source_url": "https://sam.gov/opp/abc-123/view",
        "is_active": 1,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
    }


def test_import_fixture_writes_bids_and_crawler_log(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
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


def test_fetch_sam_gov_writes_bids_and_crawler_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    monkeypatch.setenv("SAM_API_KEY", "secret")

    calls = []

    def fake_fetch_sam_gov_opportunities(**kwargs):
        calls.append(kwargs)
        return [normalized_bid()]

    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", fake_fetch_sam_gov_opportunities)

    exit_code = main(
        [
            "fetch-sam-gov",
            "--database",
            str(database),
            "--posted-from",
            "05/01/2026",
            "--posted-to",
            "05/19/2026",
            "--limit",
            "50",
            "--max-records",
            "75",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1
    assert calls[0]["api_key"] == "secret"
    assert calls[0]["posted_from"] == "05/01/2026"
    assert calls[0]["posted_to"] == "05/19/2026"
    assert calls[0]["limit"] == 50
    assert calls[0]["max_records"] == 75
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count FROM crawler_logs"
    ).fetchone()
    assert log == ("SAM.gov", "success", 1, 1, 0)


def test_fetch_sam_gov_failure_writes_crawler_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetch_sam_gov_opportunities(**kwargs):
        raise RuntimeError("api unavailable")

    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", fake_fetch_sam_gov_opportunities)

    exit_code = main(
        [
            "fetch-sam-gov",
            "--database",
            str(database),
            "--api-key",
            "secret",
            "--posted-from",
            "05/01/2026",
            "--posted-to",
            "05/19/2026",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT status, fetched_count, inserted_count, updated_count, failed_count, error_message FROM crawler_logs"
    ).fetchone()
    assert log == ("failure", 0, 0, 0, 1, "api unavailable")
