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
    assert json.loads(log[5]) == {"mode": "live", "query": "cloud", "limit": 5}


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
    }


def test_fetch_state_unsupported_source_writes_failure_log(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)

    exit_code = main(
        [
            "fetch-state",
            "--database",
            str(database),
            "--source",
            "ny_contract_reporter",
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 1
    log = connection.execute(
        "SELECT source, status, failed_count, error_code, error_message FROM crawler_logs"
    ).fetchone()
    assert log == (
        "ny_contract_reporter",
        "failure",
        1,
        "UnsupportedLiveSourceError",
        "Live fetch is not implemented for source: ny_contract_reporter",
    )


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
