import json
import sqlite3
from pathlib import Path

from apsi_crawler.cli import main
from tests.test_cli import create_crawler_database, normalized_bid


def state_bid():
    bid = normalized_bid()
    bid.update(
        {
            "id": "ca_caleprocure:CA-LIVE-2026-001",
            "source": "California Cal eProcure",
            "source_bid_id": "CA-LIVE-2026-001",
            "dedupe_key": "ca_caleprocure:CA-LIVE-2026-001",
            "title": "Cloud data warehouse modernization",
            "issuer_name": "Department of Technology",
            "issuer_type": "state",
            "state_code": "CA",
            "source_url": "https://caleprocure.ca.gov/event/CA-LIVE-2026-001",
        }
    )
    return bid


def source_quality(adapter_kind, maturity, capabilities):
    return {
        "adapter_kind": adapter_kind,
        "maturity": maturity,
        "capabilities": capabilities,
    }


def test_fetch_state_writes_bids_and_success_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    calls = []

    def fake_fetcher(source, query=None, limit=25):
        calls.append({"source": source.id, "query": query, "limit": limit})
        return [state_bid()]

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--query",
            "cloud",
            "--limit",
            "5",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert calls == [{"source": "ca_caleprocure", "query": "cloud", "limit": 5}]
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("ca_caleprocure", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "cloud",
        "limit": 5,
        "source_quality": source_quality("dedicated", "verified", ["query", "pagination"]),
    }


def test_fetch_state_replays_ca_caleprocure_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = (
        Path(__file__).parent
        / "fixtures"
        / "ca_caleprocure_live_response.json"
    )

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--query",
            "cloud",
            "--limit",
            "5",
            "--fixture-json",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source_bid_id, dedupe_key, title FROM bids"
    ).fetchone()
    assert bid == (
        "CA-LIVE-2026-001",
        "ca_caleprocure:CA-LIVE-2026-001",
        "Cloud data warehouse modernization",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("ca_caleprocure", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "cloud",
        "limit": 5,
        "fixture_json": str(fixture),
        "source_quality": source_quality("dedicated", "verified", ["query", "pagination"]),
    }


def test_fetch_state_replays_tx_esbd_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "tx_esbd_live_response.json"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "tx_esbd",
            "--query",
            "data",
            "--limit",
            "5",
            "--fixture-json",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Texas ESBD",
        "ESBD-LIVE-2026-77",
        "tx_esbd:ESBD-LIVE-2026-77",
        "Statewide data catalog services",
        "TX",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("tx_esbd", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "data",
        "limit": 5,
        "fixture_json": str(fixture),
        "source_quality": source_quality(
            "dedicated",
            "verified",
            ["query", "detail_pages", "pagination"],
        ),
    }


def test_fetch_state_replays_ny_contract_reporter_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "ny_contract_reporter_live_response.json"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ny_contract_reporter",
            "--query",
            "records",
            "--limit",
            "5",
            "--fixture-json",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "New York State Contract Reporter",
        "NYSCR-LIVE-2026-310",
        "ny_contract_reporter:NYSCR-LIVE-2026-310",
        "Digital records archive",
        "NY",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("ny_contract_reporter", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "records",
        "limit": 5,
        "fixture_json": str(fixture),
        "source_quality": source_quality(
            "dedicated",
            "verified",
            ["query", "detail_pages", "pagination"],
        ),
    }


def test_fetch_state_replays_fl_mfmp_fixture_json(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "fl_mfmp_live_response.json"

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
            "5",
            "--fixture-json",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "MyFloridaMarketPlace",
        "FL-MFMP-LIVE-2026-42",
        "fl_mfmp:FL-MFMP-LIVE-2026-42",
        "Emergency communications assessment",
        "FL",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("fl_mfmp", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "communications",
        "limit": 5,
        "fixture_json": str(fixture),
        "source_quality": source_quality(
            "dedicated",
            "verified",
            ["query", "detail_pages", "pagination"],
        ),
    }


def test_fetch_state_replays_il_bidbuy_fixture_html(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "il_bidbuy_open_bids.html"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
            "--query",
            "data",
            "--limit",
            "5",
            "--fixture-html",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Illinois BidBuy",
        "IL-BIDBUY-2026-001",
        "il_bidbuy:IL-BIDBUY-2026-001",
        "Enterprise data integration services",
        "IL",
    )
    assert connection.execute("SELECT COUNT(*) FROM bid_attachments").fetchone()[0] == 0
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    assert log[:5] == ("il_bidbuy", "success", 1, 1, 0)
    assert json.loads(log[5]) == {
        "mode": "live",
        "query": "data",
        "limit": 5,
        "fixture_html": str(fixture),
        "source_quality": source_quality(
            "dedicated",
            "verified",
            ["query", "attachments", "detail_pages", "pagination"],
        ),
    }


def test_fetch_state_replays_state_fixture_html_for_live_fetcher(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "bidnet_final_gap_open_bids.html"

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "mi_state_procurement",
            "--query",
            "chip seal",
            "--limit",
            "5",
            "--fixture-html",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Michigan State Procurement",
        "0000425930",
        "mi_state_procurement:0000425930",
        "ADVERTISEMENT FOR BID PROPOSALS FOR LABOR AND MATERIAL TO CHIP SEAL/FOGSEAL PARK",
        "MI",
    )


def test_fetch_state_persists_attachments_from_live_fetcher(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    bid = state_bid()
    bid.update(
        {
            "id": "il_bidbuy:IL-BIDBUY-2026-001",
            "source": "Illinois BidBuy",
            "source_bid_id": "IL-BIDBUY-2026-001",
            "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
            "title": "Enterprise data integration services",
            "state_code": "IL",
            "attachments": [
                {
                    "name": "Scope of Work.pdf",
                    "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                    "size_label": "242 KB",
                    "mime_type": "application/pdf",
                    "sort_order": 0,
                }
            ],
        }
    )

    def fake_fetcher(source, query=None, limit=25):
        return [bid]

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    rows = connection.execute(
        "SELECT bid_id, name, url, size_label, mime_type, sort_order FROM bid_attachments"
    ).fetchall()
    assert rows == [
        (
            "il_bidbuy:IL-BIDBUY-2026-001",
            "Scope of Work.pdf",
            "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            "242 KB",
            "application/pdf",
            0,
        )
    ]


def test_fetch_state_persists_archived_attachment_metadata(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    archive_dir = tmp_path / "attachments"
    create_crawler_database(database)
    bid = state_bid()
    bid.update(
        {
            "id": "il_bidbuy:IL-BIDBUY-2026-001",
            "source": "Illinois BidBuy",
            "source_bid_id": "IL-BIDBUY-2026-001",
            "dedupe_key": "il_bidbuy:IL-BIDBUY-2026-001",
            "title": "Enterprise data integration services",
            "state_code": "IL",
            "attachments": [
                {
                    "name": "Scope of Work.pdf",
                    "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
                    "size_label": "242 KB",
                    "mime_type": "application/pdf",
                    "sort_order": 0,
                }
            ],
        }
    )

    def fake_fetcher(source, query=None, limit=25):
        return [bid]

    class FakeResponse:
        status_code = 200
        content = b"scope-pdf"
        headers = {"Content-Type": "application/pdf"}

        def raise_for_status(self):
            return None

    class FakeSession:
        def get(self, url, headers=None, timeout=30):
            return FakeResponse()

        def close(self):
            return None

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)
    monkeypatch.setattr("apsi_crawler.storage.archive.requests.Session", lambda: FakeSession())

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
            "--archive-documents",
            "--archive-dir",
            str(archive_dir),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    row = connection.execute(
        """
        SELECT original_url, storage_path, byte_size, content_type,
               checksum_sha256, archive_status, archive_error
        FROM bid_attachments
        """
    ).fetchone()
    assert row[0] == "https://www.bidbuy.illinois.gov/documents/scope.pdf"
    assert Path(row[1]).read_bytes() == b"scope-pdf"
    assert row[2:] == (
        9,
        "application/pdf",
        "48fdd17f826c69750bdf5950261d3e6e2f48b363baae48a8417b5d2f4d1a4f61",
        "archived",
        None,
    )
    log = connection.execute("SELECT metadata FROM crawler_logs").fetchone()
    metadata = json.loads(log[0])
    assert metadata["archive"] == {"archived": 1, "failed": 0, "unavailable": 0}


def test_fetch_state_keeps_success_when_attachment_archive_fails(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    bid = state_bid()
    bid.update(
        {
            "attachments": [
                {
                    "name": "Broken Attachment",
                    "url": "https://caleprocure.ca.gov/files/broken.pdf",
                }
            ]
        }
    )

    def fake_fetcher(source, query=None, limit=25):
        return [bid]

    class FakeSession:
        def get(self, url, headers=None, timeout=30):
            raise RuntimeError("download timeout")

        def close(self):
            return None

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)
    monkeypatch.setattr("apsi_crawler.storage.archive.requests.Session", lambda: FakeSession())

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--archive-documents",
            "--archive-dir",
            str(tmp_path / "attachments"),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1
    row = connection.execute(
        "SELECT archive_status, archive_error FROM bid_attachments"
    ).fetchone()
    assert row == ("failed", "download timeout")
    log = connection.execute("SELECT status, metadata FROM crawler_logs").fetchone()
    assert log[0] == "success"
    assert json.loads(log[1])["archive"] == {"archived": 0, "failed": 1, "unavailable": 0}


def test_fetch_state_unsupported_source_writes_failure_log(tmp_path, monkeypatch):
    from apsi_crawler.sources.base import Source
    from apsi_crawler.sources import registry

    static_source = Source(
        id="test_static_source",
        name="Static Test Source",
        source_label="Static Test Source",
        jurisdiction="state",
        state_code="TS",
        fixture_loader=lambda path: [],
    )
    monkeypatch.setitem(registry.STATE_SOURCES, "test_static_source", static_source)
    monkeypatch.setitem(registry.SOURCES, "test_static_source", static_source)
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "test_static_source",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "test_static_source",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: test_static_source",
    )


def test_fetch_state_falls_back_to_bundled_ca_fixture_when_live_fetch_fails(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetcher(source, query=None, limit=25):
        raise RuntimeError("state portal unavailable")

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--query",
            "cloud",
            "--limit",
            "5",
            "--fallback-fixture",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source_bid_id, dedupe_key, title FROM bids"
    ).fetchone()
    assert bid == (
        "CA-LIVE-2026-001",
        "ca_caleprocure:CA-LIVE-2026-001",
        "Cloud data warehouse modernization",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    metadata = json.loads(log[5])
    assert log[:5] == ("ca_caleprocure", "success", 1, 1, 0)
    assert metadata["fallback_source"] == "bundled_demo_fixture"
    assert metadata["fallback_reason"] == "state portal unavailable"
    assert metadata["fallback_fixture"].endswith("ca_caleprocure_live_response.json")


def test_fetch_state_falls_back_to_bundled_il_fixture_when_live_fetch_fails(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetcher(source, query=None, limit=25):
        raise RuntimeError("Illinois BidBuy timed out")

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "il_bidbuy",
            "--query",
            "data",
            "--limit",
            "5",
            "--fallback-fixture",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, source_bid_id, dedupe_key, title, state_code FROM bids"
    ).fetchone()
    assert bid == (
        "Illinois BidBuy",
        "IL-BIDBUY-2026-001",
        "il_bidbuy:IL-BIDBUY-2026-001",
        "Enterprise data integration services",
        "IL",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, metadata FROM crawler_logs"
    ).fetchone()
    metadata = json.loads(log[5])
    assert log[:5] == ("il_bidbuy", "success", 1, 1, 0)
    assert metadata["fallback_source"] == "bundled_demo_fixture"
    assert metadata["fallback_reason"] == "Illinois BidBuy timed out"
    assert metadata["fallback_fixture"].endswith("il_bidbuy_open_bids.html")


def test_fetch_state_adapter_failure_writes_failure_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetcher(source, query=None, limit=25):
        raise RuntimeError("state portal unavailable")

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == ("ca_caleprocure", "failure", 1, "RuntimeError", "state portal unavailable")


def test_fetch_state_empty_result_writes_failure_log(tmp_path, monkeypatch):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    def fake_fetcher(source, query=None, limit=25):
        return []

    monkeypatch.setattr("apsi_crawler.cli.get_live_fetcher", lambda source: fake_fetcher)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "wa_state_procurement",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 0
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "wa_state_procurement",
        "failure",
        0,
        0,
        0,
        1,
        "EmptyCrawlerResultError",
        "Crawler returned no opportunities for source: wa_state_procurement",
    )


def test_validate_state_live_exits_success_when_sources_are_non_empty(monkeypatch, capsys):
    from apsi_crawler.sources.registry import get_source

    def fake_validate_state_live_sources(source_ids, query=None, limit=25, timeout=30):
        source = get_source(source_ids[0])
        return type(
            "Result",
            (),
            {
                "ok": True,
                "sources": [
                    type(
                        "SourceResult",
                        (),
                        {
                            "source": source.id,
                            "status": "success",
                            "fetched_count": 1,
                            "error_code": None,
                            "error_message": None,
                        },
                    )()
                ],
            },
        )()

    monkeypatch.setattr("apsi_crawler.cli.validate_state_live_sources", fake_validate_state_live_sources)

    exit_code = main(
        [
            "validate-state-live",
            "--source",
            "wa_state_procurement",
            "--query",
            "network",
            "--limit",
            "3",
            "--timeout",
            "7",
        ]
    )

    assert exit_code == 0
    assert "wa_state_procurement success fetched=1" in capsys.readouterr().out


def test_validate_state_live_exits_failure_when_any_source_fails(monkeypatch, capsys):
    def fake_validate_state_live_sources(source_ids, query=None, limit=25, timeout=30):
        return type(
            "Result",
            (),
            {
                "ok": False,
                "sources": [
                    type(
                        "SourceResult",
                        (),
                        {
                            "source": "wa_state_procurement",
                            "status": "failure",
                            "fetched_count": 0,
                            "error_code": "EmptyCrawlerResultError",
                            "error_message": "Crawler returned no opportunities for source: wa_state_procurement",
                        },
                    )()
                ],
            },
        )()

    monkeypatch.setattr("apsi_crawler.cli.validate_state_live_sources", fake_validate_state_live_sources)

    exit_code = main(["validate-state-live", "--source", "wa_state_procurement"])

    assert exit_code == 1
    assert (
        "wa_state_procurement failure fetched=0 error=EmptyCrawlerResultError: Crawler returned no opportunities for source: wa_state_procurement"
        in capsys.readouterr().out
    )
