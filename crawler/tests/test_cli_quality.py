import json
import sqlite3

from apsi_crawler.cli import main
from test_cli import create_crawler_database, normalized_bid


def run_fetch(database):
    return main(["fetch-sam-gov", "--database", str(database), "--posted-from", "09/01/2026", "--posted-to", "10/01/2026"])


def test_direct_cli_quarantines_invalid_core_and_keeps_evidence(tmp_path, monkeypatch):
    database = tmp_path / "quality.sqlite"
    create_crawler_database(database)
    valid = normalized_bid()
    invalid = {**valid, "id": "sam_gov:bad", "source_bid_id": "bad", "dedupe_key": "sam_gov:bad", "title": "Untitled SAM.gov opportunity"}
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [valid, invalid])
    assert run_fetch(database) == 0
    connection = sqlite3.connect(database)
    assert connection.execute("SELECT id FROM bids").fetchall() == [(valid["id"],)]
    metadata = json.loads(connection.execute("SELECT metadata FROM crawler_logs").fetchone()[0])
    assert metadata["dataQuality"]["quarantinedCount"] == 1
    assert metadata["dataQuality"]["quarantinedRecords"][0]["issues"] == ["invalid_title"]
    connection.close()


def test_direct_cli_failed_batch_rolls_back_earlier_good_writes(tmp_path, monkeypatch):
    database = tmp_path / "quality.sqlite"
    create_crawler_database(database)
    valid = normalized_bid()
    second = {**valid, "id": "sam_gov:second", "source_bid_id": "second", "dedupe_key": "sam_gov:second", "attachments": [{"name": "missing URL"}]}
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [valid, second])
    assert run_fetch(database) == 1
    connection = sqlite3.connect(database)
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 0
    assert connection.execute("SELECT status FROM crawler_logs").fetchall() == [("failure",)]
    connection.close()


def test_direct_cli_list_refresh_preserves_body_and_unseen_attachments(tmp_path, monkeypatch):
    database = tmp_path / "quality.sqlite"
    create_crawler_database(database)
    original = normalized_bid()
    original["description"] = "Build the data platform and train staff."
    original["detail_fetched_at"] = "2026-09-01T00:00:00Z"
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [original])
    assert run_fetch(database) == 0
    refresh = {**original, "description": original["title"], "full_description": None, "detail_fetched_at": "2026-10-01T00:00:00Z", "raw_payload": {"enrichment": {"applied_fields": []}}, "attachments": []}
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [refresh])
    assert run_fetch(database) == 0
    connection = sqlite3.connect(database)
    assert connection.execute("SELECT description FROM bids").fetchone()[0] == original["description"]
    assert connection.execute("SELECT COUNT(*) FROM bid_attachments").fetchone()[0] == 1
    stored = json.loads(connection.execute("SELECT raw_payload FROM bids").fetchone()[0])
    assert stored["data_quality"]["body"]["verifiedAt"] == original["detail_fetched_at"]
    assert stored["data_quality"]["body"]["reused"] is True
    connection.close()


def test_direct_cli_retains_attachment_verification_and_repair_history(tmp_path, monkeypatch):
    database = tmp_path / "quality.sqlite"
    create_crawler_database(database)
    connection = sqlite3.connect(database)
    for definition in ("verified_at TEXT", "repair_attempts INTEGER DEFAULT 0", "next_repair_at TEXT", "failure_kind TEXT"):
        connection.execute("ALTER TABLE bid_attachments ADD COLUMN " + definition)
    connection.commit()
    original = normalized_bid()
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [original])
    assert run_fetch(database) == 0
    connection.execute("UPDATE bid_attachments SET id = 'stable-file', verified_at = '2026-09-01T00:00:00Z', repair_attempts = 4, next_repair_at = '2026-10-02T00:00:00Z', failure_kind = 'timeout'")
    connection.commit()
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [{**original, "attachments": []}])
    assert run_fetch(database) == 0
    assert connection.execute("SELECT id, verified_at, repair_attempts, next_repair_at, failure_kind FROM bid_attachments").fetchall() == [
        ('stable-file', '2026-09-01T00:00:00Z', 4, '2026-10-02T00:00:00Z', 'timeout')]
    connection.close()


def test_direct_cli_new_attachment_id_skips_reserved_historical_ids(tmp_path, monkeypatch):
    database = tmp_path / "quality.sqlite"
    create_crawler_database(database)
    original = normalized_bid()
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [original])
    assert run_fetch(database) == 0
    connection = sqlite3.connect(database)
    old_id = original["id"] + ":attachment:2"
    connection.execute("UPDATE bid_attachments SET id = ?", (old_id,))
    connection.commit()
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [{**original, "attachments": [{"name": "New scope", "url": "https://sam.gov/new-scope.pdf"}]}])
    assert run_fetch(database) == 0
    ids = [row[0] for row in connection.execute("SELECT id FROM bid_attachments").fetchall()]
    assert old_id in ids and len(ids) == len(set(ids)) == 2
    connection.close()
