from apsi_crawler.cli import main


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
