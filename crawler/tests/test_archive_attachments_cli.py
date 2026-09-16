"""`python -m apsi_crawler.cli archive-attachments` contract (C1): stdin JSON -> one stdout JSON."""

import io
import json

import pytest

from apsi_crawler import cli
from apsi_crawler.storage import archive_attachments as archive_attachments_module


PDF_BYTES = b"%PDF-1.7\ntrailer\n%%EOF\n"


class FakeResponse:
    def __init__(self, content=b"", status_code=200, headers=None, url=None):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}
        self.url = url
        self.history = []

    def iter_content(self, chunk_size=8192):
        for start in range(0, len(self.content), chunk_size):
            yield self.content[start:start + chunk_size]

    def close(self):
        pass


class FakeSession:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = []

    def get(self, url, headers=None, timeout=None, stream=False, **kwargs):
        self.calls.append(url)
        if not self.responses:
            raise AssertionError("No fake response queued")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        pass


def _run(stdin_text, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(stdin_text))
    exit_code = cli.main(["archive-attachments"])
    captured = capsys.readouterr()
    return exit_code, captured


def _request(tmp_path, items):
    return {
        "archive_root": str(tmp_path),
        "browser_downloader_url": None,
        "source": {
            "id": "mo_missouri_buys",
            "label": "Missouri MissouriBUYS",
            "mode": "direct",
            "min_interval_seconds": 0,
            "timeout_seconds": 30,
            "max_bytes": 52428800,
            "browser_link_selector": None,
        },
        "items": items,
    }


def _item(url, item_id="mo:1:attachment:1"):
    return {
        "id": item_id,
        "bid_id": "mo_missouri_buys:1",
        "bid_source": "Missouri MissouriBUYS",
        "source_bid_id": "1",
        "page_url": "https://missouribuys.mo.gov/bid/1",
        "url": url,
        "name": "Solicitation.pdf",
        "expected_extension": ".pdf",
    }


def test_archive_attachments_is_a_registered_subcommand():
    parser = cli.build_parser()
    args = parser.parse_args(["archive-attachments"])
    assert args.command == "archive-attachments"


def test_successful_run_prints_exactly_one_json_document(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        archive_attachments_module.requests,
        "Session",
        lambda: FakeSession([FakeResponse(PDF_BYTES, headers={"Content-Type": "application/pdf"})]),
    )

    exit_code, captured = _run(
        json.dumps(_request(tmp_path, [_item("https://missouribuys.mo.gov/docs/scope.pdf")])),
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    payload = json.loads(captured.out)
    assert captured.out.strip().count("\n") == 0
    assert payload["stats"] == {"archived": 1, "failed": 0, "unavailable": 0, "duration_ms": payload["stats"]["duration_ms"]}
    result = payload["results"][0]
    assert result["id"] == "mo:1:attachment:1"
    assert result["storage_path"] == "mo_missouri_buys/mo_missouri_buys_1/mo_1_attachment_1.pdf"
    assert (tmp_path / result["storage_path"]).read_bytes() == PDF_BYTES


def test_failing_items_still_exit_zero(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        archive_attachments_module.requests,
        "Session",
        lambda: FakeSession([FakeResponse(b"<html>error</html>", headers={"Content-Type": "text/html"})]),
    )

    exit_code, captured = _run(
        json.dumps(_request(tmp_path, [_item("https://missouribuys.mo.gov/docs/scope.pdf")])),
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    payload = json.loads(captured.out)
    assert payload["results"][0]["archive_status"] == "failed"
    assert payload["results"][0]["failure_kind"] == "html_response"
    assert payload["stats"]["failed"] == 1


def test_non_http_items_need_no_network_and_exit_zero(tmp_path, monkeypatch, capsys):
    exit_code, captured = _run(
        json.dumps(_request(tmp_path, [_item("/attachments/demo-download-note.txt")])),
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    payload = json.loads(captured.out)
    assert payload["results"][0]["archive_status"] == "unavailable"
    assert payload["results"][0]["failure_kind"] == "unavailable"


def test_unparseable_stdin_exits_two_with_a_json_error(monkeypatch, capsys):
    exit_code, captured = _run("not json at all", monkeypatch, capsys)

    assert exit_code == 2
    payload = json.loads(captured.out)
    assert payload["error"]["code"] == "INVALID_REQUEST"
    assert payload["error"]["message"]
    assert "results" not in payload


def test_invalid_request_shape_exits_two_with_a_json_error(monkeypatch, capsys):
    exit_code, captured = _run(json.dumps({"items": []}), monkeypatch, capsys)

    assert exit_code == 2
    payload = json.loads(captured.out)
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_diagnostics_go_to_stderr_not_stdout(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(
        archive_attachments_module.requests,
        "Session",
        lambda: FakeSession([FakeResponse(b"<html>error</html>", headers={"Content-Type": "text/html"})]),
    )

    exit_code, captured = _run(
        json.dumps(_request(tmp_path, [_item("https://missouribuys.mo.gov/docs/scope.pdf")])),
        monkeypatch,
        capsys,
    )

    assert exit_code == 0
    json.loads(captured.out)
    assert "html_response" in captured.err


@pytest.mark.parametrize("payload", ["[]", '{"archive_root": "/tmp/x", "items": "nope"}'])
def test_every_invalid_request_still_prints_one_json_document(payload, monkeypatch, capsys):
    exit_code, captured = _run(payload, monkeypatch, capsys)

    assert exit_code == 2
    assert json.loads(captured.out)["error"]["code"] == "INVALID_REQUEST"
