import sqlite3

import pytest

from apsi_crawler.storage.sqlite import upsert_bid, write_crawler_log


def _create_bid_attachment_database(connection, attachment_name_constraint=""):
    connection.executescript(
        f"""
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
          source_confidence TEXT NOT NULL DEFAULT 'medium',
          quality_flags_json TEXT NOT NULL DEFAULT '[]',
          admin_review_status TEXT NOT NULL DEFAULT 'unreviewed',
          detail_archive_status TEXT NOT NULL DEFAULT 'not_archived',
          detail_archive_path TEXT,
          detail_fetched_at TEXT,
          detail_checksum_sha256 TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE bid_attachments (
          id TEXT PRIMARY KEY,
          bid_id TEXT NOT NULL,
          name TEXT NOT NULL{attachment_name_constraint},
          url TEXT NOT NULL,
          original_url TEXT,
          storage_path TEXT,
          byte_size INTEGER,
          content_type TEXT,
          checksum_sha256 TEXT,
          fetched_at TEXT,
          archive_status TEXT NOT NULL DEFAULT 'not_archived',
          size_label TEXT,
          mime_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        """
    )


def _il_bid(**overrides):
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
    }
    bid.update(overrides)
    return bid


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
    _create_bid_attachment_database(connection)

    bid = _il_bid(
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "size_label": "242 KB",
                "mime_type": "application/pdf",
                "sort_order": 3,
            }
        ],
    )

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


def test_upsert_bid_writes_archive_and_quality_metadata_when_columns_exist(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection)

    bid = _il_bid(
        source_confidence="high",
        quality_flags_json=["missing_deadline"],
        admin_review_status="needs_review",
        detail_archive_status="archived",
        detail_archive_path="data/attachments/details/il_bidbuy.html",
        detail_fetched_at="2026-05-19T00:01:00Z",
        detail_checksum_sha256="detail-sha",
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "original_url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "storage_path": "data/attachments/il/scope.pdf",
                "byte_size": 2048,
                "content_type": "application/pdf",
                "checksum_sha256": "attachment-sha",
                "fetched_at": "2026-05-19T00:02:00Z",
                "archive_status": "archived",
            }
        ],
    )

    assert upsert_bid(connection, bid) == "inserted"
    bid_row = connection.execute(
        """
        SELECT source_confidence, quality_flags_json, admin_review_status,
               detail_archive_status, detail_archive_path, detail_fetched_at, detail_checksum_sha256
        FROM bids
        """
    ).fetchone()
    assert bid_row == (
        "high",
        '["missing_deadline"]',
        "needs_review",
        "archived",
        "data/attachments/details/il_bidbuy.html",
        "2026-05-19T00:01:00Z",
        "detail-sha",
    )
    attachment_row = connection.execute(
        """
        SELECT original_url, storage_path, byte_size, content_type,
               checksum_sha256, fetched_at, archive_status
        FROM bid_attachments
        """
    ).fetchone()
    assert attachment_row == (
        "https://www.bidbuy.illinois.gov/documents/scope.pdf",
        "data/attachments/il/scope.pdf",
        2048,
        "application/pdf",
        "attachment-sha",
        "2026-05-19T00:02:00Z",
        "archived",
    )


def test_upsert_bid_preserves_existing_archive_metadata_when_refresh_lacks_it(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection)

    archived = _il_bid(
        detail_archive_status="archived",
        detail_archive_path="data/attachments/details/il_bidbuy.html",
        detail_fetched_at="2026-05-19T00:01:00Z",
        detail_checksum_sha256="detail-sha",
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "storage_path": "data/attachments/il/scope.pdf",
                "byte_size": 2048,
                "content_type": "application/pdf",
                "checksum_sha256": "attachment-sha",
                "fetched_at": "2026-05-19T00:02:00Z",
                "archive_status": "archived",
            }
        ],
    )
    assert upsert_bid(connection, archived) == "inserted"

    refreshed = _il_bid(
        title="Enterprise data integration services refreshed",
        detail_archive_status="not_archived",
        detail_archive_path=None,
        detail_fetched_at=None,
        detail_checksum_sha256=None,
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            }
        ],
    )
    assert upsert_bid(connection, refreshed) == "updated"

    bid_row = connection.execute(
        """
        SELECT title, detail_archive_status, detail_archive_path,
               detail_fetched_at, detail_checksum_sha256
        FROM bids
        """
    ).fetchone()
    assert bid_row == (
        "Enterprise data integration services refreshed",
        "archived",
        "data/attachments/details/il_bidbuy.html",
        "2026-05-19T00:01:00Z",
        "detail-sha",
    )
    attachment_row = connection.execute(
        """
        SELECT storage_path, byte_size, content_type,
               checksum_sha256, fetched_at, archive_status
        FROM bid_attachments
        """
    ).fetchone()
    assert attachment_row == (
        "data/attachments/il/scope.pdf",
        2048,
        "application/pdf",
        "attachment-sha",
        "2026-05-19T00:02:00Z",
        "archived",
    )

def test_upsert_bid_rolls_back_bid_and_attachment_changes_when_attachment_insert_fails(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection, " CHECK(name != 'INVALID')")
    bid = _il_bid(
        title="Original title",
        attachments=[
            {
                "name": "Original Scope.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/original.pdf",
            }
        ],
    )
    assert upsert_bid(connection, bid) == "inserted"

    with pytest.raises(sqlite3.IntegrityError):
        upsert_bid(
            connection,
            {
                **bid,
                "title": "Updated title",
                "attachments": [
                    {
                        "name": "INVALID",
                        "url": "https://www.bidbuy.illinois.gov/documents/broken.pdf",
                    }
                ],
            },
        )

    connection.commit()

    assert connection.execute("SELECT title FROM bids").fetchone()[0] == "Original title"
    rows = connection.execute(
        "SELECT bid_id, name, url FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Original Scope.pdf",
            "https://www.bidbuy.illinois.gov/documents/original.pdf",
        )
    ]


def test_upsert_bid_raises_and_rolls_back_when_attachment_is_missing_url(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection)
    bid = _il_bid(
        title="Original title",
        attachments=[
            {
                "name": "Original Scope.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/original.pdf",
            }
        ],
    )
    assert upsert_bid(connection, bid) == "inserted"

    with pytest.raises(ValueError) as error:
        upsert_bid(
            connection,
            {
                **bid,
                "title": "Updated title",
                "attachments": [{"name": "Broken Scope.pdf"}],
            },
        )

    assert str(error.value) == "Bid attachment is missing url"
    connection.commit()

    assert connection.execute("SELECT title FROM bids").fetchone()[0] == "Original title"
    rows = connection.execute(
        "SELECT bid_id, name, url FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Original Scope.pdf",
            "https://www.bidbuy.illinois.gov/documents/original.pdf",
        )
    ]


def test_upsert_bid_uses_index_when_attachment_sort_order_is_none(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection)

    bid = _il_bid(
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                "sort_order": None,
            }
        ],
    )

    assert upsert_bid(connection, bid) == "inserted"
    assert connection.execute(
        "SELECT sort_order FROM bid_attachments"
    ).fetchone()[0] == 0


def test_upsert_bid_update_writes_attachments_with_existing_bid_id(tmp_path):
    db_path = tmp_path / "apsi.sqlite"
    connection = sqlite3.connect(db_path)
    _create_bid_attachment_database(connection)
    stored_bid = _il_bid(id="stored-il-bid-id")
    assert upsert_bid(connection, stored_bid) == "inserted"

    incoming_bid = _il_bid(
        id="incoming-il-bid-id",
        attachments=[
            {
                "name": "Scope of Work.pdf",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            }
        ],
    )

    assert upsert_bid(connection, incoming_bid) == "updated"
    assert connection.execute("SELECT id FROM bids").fetchone()[0] == "stored-il-bid-id"
    rows = connection.execute(
        "SELECT id, bid_id, name FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "stored-il-bid-id:attachment:1",
            "stored-il-bid-id",
            "Scope of Work.pdf",
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
