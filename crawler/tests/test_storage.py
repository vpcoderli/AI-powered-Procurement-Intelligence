import sqlite3

from apsi_crawler.storage.sqlite import upsert_bid, write_crawler_log


def test_upsert_bid_is_idempotent(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
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
          fetched_count INTEGER NOT NULL DEFAULT 0,
          inserted_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0
        );
        """
    )

    bid = {
        "id": "sam_gov:abc",
        "source": "SAM.gov",
        "source_bid_id": "abc",
        "dedupe_key": "sam_gov:abc",
        "title": "Cloud",
        "description": "Cloud work",
        "issuer_name": "DOD",
        "issuer_type": "federal",
        "state_code": "US",
        "source_url": "https://sam.gov",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
    }

    assert upsert_bid(connection, bid) == "inserted"
    assert upsert_bid(connection, {**bid, "title": "Cloud Updated"}) == "updated"

    row = connection.execute("SELECT COUNT(*), title FROM bids").fetchone()
    assert row == (1, "Cloud Updated")

    write_crawler_log(
        connection,
        source="SAM.gov",
        run_id="run_1",
        status="success",
        fetched_count=1,
        inserted_count=1,
        updated_count=0,
    )
    assert connection.execute("SELECT COUNT(*) FROM crawler_logs").fetchone()[0] == 1


def test_upsert_bid_writes_and_replaces_attachments_when_table_exists(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE bid_attachments (
          id TEXT PRIMARY KEY,
          bid_id TEXT NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          size_label TEXT,
          mime_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        """
    )

    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-001",
        "source": "Illinois BidBuy",
        "source_bid_id": "IL-BIDBUY-2026-001",
        "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
        "title": "Enterprise data integration services",
        "description": "Enterprise data integration services",
        "issuer_name": "Illinois Department of Innovation and Technology",
        "issuer_type": "state",
        "state_code": "IL",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
        "attachments": [
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "size_label": "242 KB",
                "mime_type": "application/pdf",
                "sort_order": 3,
            }
        ],
    }

    assert upsert_bid(connection, bid) == "inserted"
    rows = connection.execute(
        "SELECT id, bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001:attachment:1",
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Scope of Work.pdf",
            "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            "242 KB",
            "application/pdf",
            3,
        )
    ]

    replacement = {
        **bid,
        "attachments": [
            {
                "name": "Pricing Sheet.xlsx",
                "url": "https://www.bidbuy.illinois.gov/documents/pricing.xlsx",
            }
        ],
    }
    assert upsert_bid(connection, replacement) == "updated"
    rows = connection.execute(
        "SELECT id, bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001:attachment:1",
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Pricing Sheet.xlsx",
            "https://www.bidbuy.illinois.gov/documents/pricing.xlsx",
            None,
            None,
            0,
        )
    ]


def test_upsert_bid_ignores_attachments_when_attachment_table_missing(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE bids (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          source_bid_id TEXT,
          dedupe_key TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          issuer_name TEXT NOT NULL,
          issuer_type TEXT NOT NULL,
          state_code TEXT NOT NULL,
          source_url TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 1,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )

    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-001",
        "source": "Illinois BidBuy",
        "source_bid_id": "IL-BIDBUY-2026-001",
        "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
        "title": "Enterprise data integration services",
        "description": "Enterprise data integration services",
        "issuer_name": "Illinois Department of Innovation and Technology",
        "issuer_type": "state",
        "state_code": "IL",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
        "is_active": 1,
        "first_seen_at": "2026-05-19T00:00:00Z",
        "last_seen_at": "2026-05-19T00:00:00Z",
        "created_at": "2026-05-19T00:00:00Z",
        "updated_at": "2026-05-19T00:00:00Z",
        "attachments": [
            {"name": "Scope of Work.pdf", "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf"}
        ],
    }

    assert upsert_bid(connection, bid) == "inserted"
