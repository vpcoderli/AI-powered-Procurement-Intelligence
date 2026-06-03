import json
import sqlite3
from pathlib import Path
from types import SimpleNamespace

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
          source_confidence TEXT NOT NULL DEFAULT 'medium',
          quality_flags_json TEXT NOT NULL DEFAULT '[]',
          admin_review_status TEXT NOT NULL DEFAULT 'unreviewed',
          detail_archive_status TEXT NOT NULL DEFAULT 'not_archived',
          detail_archive_path TEXT,
          detail_fetched_at TEXT,
          detail_checksum_sha256 TEXT,
          detail_archive_error TEXT,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE bid_attachments (
          id TEXT PRIMARY KEY,
          bid_id TEXT NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          original_url TEXT,
          storage_path TEXT,
          byte_size INTEGER,
          content_type TEXT,
          checksum_sha256 TEXT,
          fetched_at TEXT,
          archive_status TEXT NOT NULL DEFAULT 'not_archived',
          archive_error TEXT,
          size_label TEXT,
          mime_type TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
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
        "attachments": [
            {
                "name": "Statement of work",
                "url": "https://sam.gov/api/prod/opps/v3/opportunities/resources/files/abc",
                "mime_type": "application/pdf",
            }
        ],
    }


def normalized_state_bid(source="fl_mfmp"):
    timestamp = "2026-05-19T00:00:00+00:00"
    return {
        "id": f"{source}:FL-001",
        "source": "MyFloridaMarketPlace",
        "source_bid_id": "FL-001",
        "dedupe_key": f"{source}:FL-001",
        "title": "Emergency communications assessment",
        "description": "Assess emergency communications readiness.",
        "issuer_name": "Florida Department of Management Services",
        "issuer_type": "state",
        "state_code": "FL",
        "source_url": "https://vendor.myfloridamarketplace.com/search/bids/detail/FL-001",
        "is_active": 1,
        "first_seen_at": timestamp,
        "last_seen_at": timestamp,
        "created_at": timestamp,
        "updated_at": timestamp,
        "attachments": [
            {
                "name": "Bid package",
                "url": "https://vendor.myfloridamarketplace.com/files/FL-001.pdf",
                "mime_type": "application/pdf",
            }
        ],
    }


def assert_json_run_payload(payload, *, source, status):
    assert payload["source"] == source
    assert payload["runId"]
    assert payload["status"] == status
    assert payload["startedAt"]
    assert payload["finishedAt"]
    assert isinstance(payload["durationMs"], int)
    assert isinstance(payload["metadata"], dict)
    assert "bids" in payload
    assert "errorCode" in payload
    assert "errorMessage" in payload
    assert "errorStack" in payload


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


def test_import_fixture_empty_result_writes_failure_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = tmp_path / "empty.json"
    fixture.write_text("[]", encoding="utf-8")

    monkeypatch.setattr("apsi_crawler.cli.get_fixture_loader", lambda source: lambda path: [])

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
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "SAM.gov",
        "failure",
        0,
        0,
        0,
        1,
        "EmptyCrawlerResultError",
        "Crawler returned no opportunities for source: SAM.gov",
    )


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


def test_fetch_sam_gov_output_json_writes_success_payload(tmp_path, monkeypatch, capsys):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [normalized_bid()])

    exit_code = main(
        [
            "fetch-sam-gov",
            "--database",
            str(database),
            "--posted-from",
            "05/01/2026",
            "--posted-to",
            "05/19/2026",
            "--output-json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert_json_run_payload(payload, source="SAM.gov", status="success")
    assert payload["metadata"] == {"posted_from": "05/01/2026", "posted_to": "05/19/2026", "limit": 100}
    assert payload["bids"] == [normalized_bid()]
    assert payload["errorCode"] is None
    assert payload["errorMessage"] is None
    assert payload["errorStack"] is None


def test_fetch_sam_gov_output_json_does_not_require_database(monkeypatch, capsys):
    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [normalized_bid()])

    exit_code = main(
        [
            "fetch-sam-gov",
            "--posted-from",
            "05/01/2026",
            "--posted-to",
            "05/19/2026",
            "--output-json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert_json_run_payload(payload, source="SAM.gov", status="success")
    assert payload["bids"] == [normalized_bid()]


def test_fetch_sam_gov_empty_result_writes_failure_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    monkeypatch.setattr("apsi_crawler.cli.fetch_sam_gov_opportunities", lambda **kwargs: [])

    exit_code = main(
        [
            "fetch-sam-gov",
            "--database",
            str(database),
            "--posted-from",
            "05/01/2026",
            "--posted-to",
            "05/19/2026",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT status, fetched_count, inserted_count, updated_count, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "failure",
        0,
        0,
        0,
        1,
        "EmptyCrawlerResultError",
        "Crawler returned no opportunities for source: SAM.gov",
    )


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


def test_fetch_state_empty_live_result_uses_fallback_fixture(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    source_metadata = SimpleNamespace(
        id="fl_mfmp",
        adapter_kind="dedicated",
        maturity="verified",
        capabilities=("query", "detail_pages", "pagination"),
        source_authority="official",
        trust_status="verified",
        evidence_mode="direct_portal",
        validity_notes="Verified public state procurement portal with deterministic parser coverage.",
    )

    monkeypatch.setattr("apsi_crawler.cli.get_source", lambda source: source_metadata)
    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: lambda metadata, **kwargs: [])
    monkeypatch.setattr(
        "apsi_crawler.cli._fallback_fixture_for_source",
        lambda source: ("fixture_json", "/fixtures/fl_mfmp_live_response.json"),
    )
    monkeypatch.setitem(
        __import__("apsi_crawler.cli").cli.STATE_FALLBACK_FETCHERS,
        "fl_mfmp",
        lambda metadata, **kwargs: [normalized_state_bid()],
    )

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "fl_mfmp",
            "--fallback-fixture",
            "--limit",
            "1",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert connection.execute("SELECT COUNT(*) FROM bids WHERE state_code = 'FL'").fetchone()[0] == 1
    log = connection.execute(
        "SELECT status, fetched_count, inserted_count, updated_count, failed_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("success", 1, 1, 0, 0)
    metadata = json.loads(log[5])
    assert metadata["fallback_source"] == "bundled_demo_fixture"
    assert metadata["fallback_reason"] == "Crawler returned no opportunities for source: fl_mfmp"


def test_fetch_state_output_json_writes_success_payload(tmp_path, monkeypatch, capsys):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    source_metadata = SimpleNamespace(
        id="fl_mfmp",
        adapter_kind="dedicated",
        maturity="verified",
        capabilities=("query", "detail_pages", "pagination"),
        source_authority="official",
        trust_status="verified",
        evidence_mode="direct_portal",
        validity_notes="Verified public state procurement portal with deterministic parser coverage.",
    )

    monkeypatch.setattr("apsi_crawler.cli.get_source", lambda source: source_metadata)
    monkeypatch.setattr(
        "apsi_crawler.cli.get_live_fetcher",
        lambda source: lambda metadata, **kwargs: [normalized_state_bid()],
    )

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "fl_mfmp",
            "--query",
            "communications",
            "--limit",
            "1",
            "--output-json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert_json_run_payload(payload, source="fl_mfmp", status="success")
    assert payload["metadata"]["mode"] == "live"
    assert payload["metadata"]["query"] == "communications"
    assert payload["metadata"]["limit"] == 1
    assert payload["metadata"]["source_quality"] == {
        "adapter_kind": "dedicated",
        "maturity": "verified",
        "capabilities": ["query", "detail_pages", "pagination"],
    }
    assert payload["metadata"]["source_validity"] == {
        "source_authority": "official",
        "trust_status": "verified",
        "evidence_mode": "direct_portal",
        "validity_notes": "Verified public state procurement portal with deterministic parser coverage.",
    }
    assert payload["bids"] == [normalized_state_bid()]
    assert payload["errorCode"] is None
    assert payload["errorMessage"] is None
    assert payload["errorStack"] is None


def test_fetch_state_output_json_does_not_require_database(monkeypatch, capsys):
    source_metadata = SimpleNamespace(
        id="fl_mfmp",
        adapter_kind="dedicated",
        maturity="verified",
        capabilities=("query", "detail_pages", "pagination"),
    )

    monkeypatch.setattr("apsi_crawler.cli.get_source", lambda source: source_metadata)
    monkeypatch.setattr(
        "apsi_crawler.cli.get_live_fetcher",
        lambda source: lambda metadata, **kwargs: [normalized_state_bid()],
    )

    exit_code = main(
        [
            "fetch-state",
            "--source",
            "fl_mfmp",
            "--output-json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 0
    assert_json_run_payload(payload, source="fl_mfmp", status="success")
    assert payload["bids"] == [normalized_state_bid()]


def test_fetch_state_output_json_writes_failure_payload(tmp_path, monkeypatch, capsys):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_get_live_fetcher(source):
        raise RuntimeError("source registry unavailable")

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", fake_get_live_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "fl_mfmp",
            "--output-json",
        ]
    )

    payload = json.loads(capsys.readouterr().out)
    assert exit_code == 1
    assert_json_run_payload(payload, source="fl_mfmp", status="failure")
    assert payload["bids"] == []
    assert payload["errorCode"] == "RuntimeError"
    assert payload["errorMessage"] == "source registry unavailable"
    assert "RuntimeError: source registry unavailable" in payload["errorStack"]
