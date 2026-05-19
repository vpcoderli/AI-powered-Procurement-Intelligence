import sqlite3
from pathlib import Path

from apsi_crawler.cli import main

from tests.test_cli import create_crawler_database


STATE_FIXTURES = {
    "ca_caleprocure": ("ca_caleprocure_opportunities.json", "California Cal eProcure", "CA"),
    "tx_esbd": ("tx_esbd_opportunities.json", "Texas ESBD", "TX"),
    "ny_contract_reporter": (
        "ny_contract_reporter_opportunities.json",
        "New York State Contract Reporter",
        "NY",
    ),
    "fl_mfmp": ("fl_mfmp_opportunities.json", "MyFloridaMarketPlace", "FL"),
    "il_bidbuy": ("il_bidbuy_opportunities.json", "Illinois BidBuy", "IL"),
}


def test_import_fixture_supports_state_source_argument(tmp_path):
    database = tmp_path / "apsi.sqlite"
    create_crawler_database(database)
    fixture = Path(__file__).parent / "fixtures" / "ca_caleprocure_opportunities.json"

    exit_code = main(
        [
            "import-fixture",
            "--database",
            str(database),
            "--source",
            "ca_caleprocure",
            "--fixture",
            str(fixture),
        ]
    )

    connection = sqlite3.connect(database)
    assert exit_code == 0
    bid = connection.execute(
        "SELECT source, issuer_type, state_code, source_bid_id, dedupe_key, source_url FROM bids"
    ).fetchone()
    assert bid == (
        "California Cal eProcure",
        "state",
        "CA",
        "CA-2026-001",
        "ca_caleprocure:CA-2026-001",
        "https://caleprocure.ca.gov/event/CA-2026-001",
    )
    log = connection.execute(
        "SELECT source, status, fetched_count, inserted_count, updated_count FROM crawler_logs"
    ).fetchone()
    assert log == ("ca_caleprocure", "success", 1, 1, 0)


def test_all_state_fixtures_import_bids_and_crawler_logs(tmp_path):
    fixtures_dir = Path(__file__).parent / "fixtures"

    for source_id, (fixture_name, source_label, state_code) in STATE_FIXTURES.items():
        database = tmp_path / f"{source_id}.sqlite"
        create_crawler_database(database)

        exit_code = main(
            [
                "import-fixture",
                "--database",
                str(database),
                "--source",
                source_id,
                "--fixture",
                str(fixtures_dir / fixture_name),
            ]
        )

        connection = sqlite3.connect(database)
        assert exit_code == 0
        assert connection.execute("SELECT COUNT(*) FROM bids").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM crawler_logs").fetchone()[0] == 1
        bid = connection.execute("SELECT source, issuer_type, state_code FROM bids").fetchone()
        assert bid == (source_label, "state", state_code)
        log = connection.execute("SELECT source, status, fetched_count FROM crawler_logs").fetchone()
        assert log == (source_id, "success", 1)
