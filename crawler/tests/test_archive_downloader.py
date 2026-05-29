from pathlib import Path

import pytest

from apsi_crawler.storage.archive import archive_bid_documents


class FakeResponse:
    def __init__(self, status_code=200, content=b"contract notice", headers=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {"Content-Type": "application/pdf"}
        self.text = content.decode("utf-8", errors="ignore")

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, headers=None, timeout=30):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout})
        if not self.responses:
            raise AssertionError("No fake response queued")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def test_archives_public_attachment_with_metadata(tmp_path):
    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-001",
        "source": "Illinois BidBuy",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-001",
        "attachments": [
            {
                "name": "Scope of Work",
                "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            }
        ],
    }
    session = FakeSession([FakeResponse(content=b"scope-pdf", headers={"Content-Type": "application/pdf"})])

    enriched = archive_bid_documents(bid, tmp_path, session=session, fetched_at="2026-05-29T00:00:00Z")

    attachment = enriched["attachments"][0]
    assert attachment["original_url"] == "https://www.bidbuy.illinois.gov/documents/scope.pdf"
    assert attachment["storage_path"].startswith(str(tmp_path))
    assert Path(attachment["storage_path"]).read_bytes() == b"scope-pdf"
    assert attachment["byte_size"] == 9
    assert attachment["content_type"] == "application/pdf"
    assert attachment["checksum_sha256"] == "48fdd17f826c69750bdf5950261d3e6e2f48b363baae48a8417b5d2f4d1a4f61"
    assert attachment["fetched_at"] == "2026-05-29T00:00:00Z"
    assert attachment["archive_status"] == "archived"
    assert session.calls == [
        {
            "url": "https://www.bidbuy.illinois.gov/documents/scope.pdf",
            "headers": {"User-Agent": "Mozilla/5.0 APSI crawler"},
            "timeout": 30,
        }
    ]


def test_marks_non_public_attachment_urls_unavailable(tmp_path):
    bid = {
        "id": "local:1",
        "source": "Local",
        "source_url": "https://example.gov/detail",
        "attachments": [
            {"name": "Email", "url": "mailto:buyer@example.gov"},
            {"name": "Portal", "url": "https://example.gov/login/download"},
        ],
    }
    session = FakeSession([])

    enriched = archive_bid_documents(bid, tmp_path, session=session)

    assert [attachment["archive_status"] for attachment in enriched["attachments"]] == ["unavailable", "unavailable"]
    assert [attachment["archive_error"] for attachment in enriched["attachments"]] == [
        "Attachment URL is not public HTTP(S).",
        "Attachment URL appears to require browser/login access.",
    ]
    assert session.calls == []


def test_marks_attachment_fetch_failure_without_raising(tmp_path):
    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-002",
        "source": "Illinois BidBuy",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-002",
        "attachments": [
            {
                "name": "Broken Scope",
                "url": "https://www.bidbuy.illinois.gov/documents/broken.pdf",
            }
        ],
    }
    session = FakeSession([FakeResponse(status_code=404, content=b"missing")])

    enriched = archive_bid_documents(bid, tmp_path, session=session)

    attachment = enriched["attachments"][0]
    assert attachment["archive_status"] == "failed"
    assert attachment["archive_error"] == "HTTP 404"
    assert attachment["storage_path"] is None


def test_marks_empty_attachment_response_failed_without_writing_file(tmp_path):
    bid = {
        "id": "empty:1",
        "source": "Empty Source",
        "source_url": "https://example.gov/detail",
        "attachments": [{"name": "Empty PDF", "url": "https://example.gov/empty.pdf"}],
    }
    session = FakeSession([FakeResponse(content=b"")])

    enriched = archive_bid_documents(bid, tmp_path, session=session)

    attachment = enriched["attachments"][0]
    assert attachment["archive_status"] == "failed"
    assert attachment["archive_error"] == "Downloaded attachment was empty."
    assert attachment["storage_path"] is None
    assert list(tmp_path.rglob("*")) == []


def test_archives_detail_page_when_enabled(tmp_path):
    bid = {
        "id": "wa_state_procurement:DES-2026-0815",
        "source": "Washington State Procurement",
        "source_url": "https://pr-webs-vendor.des.wa.gov/bid/detail/DES-2026-0815",
        "attachments": [],
    }
    session = FakeSession([FakeResponse(content=b"<html>detail</html>", headers={"Content-Type": "text/html"})])

    enriched = archive_bid_documents(
        bid,
        tmp_path,
        session=session,
        fetch_detail=True,
        fetched_at="2026-05-29T00:00:00Z",
    )

    assert enriched["detail_archive_status"] == "archived"
    assert Path(enriched["detail_archive_path"]).read_bytes() == b"<html>detail</html>"
    assert enriched["detail_checksum_sha256"] == "5f7b772adc2f70a5ceec0e4ac26a4010c69878a9875af2484086854498f78daf"
    assert enriched["detail_fetched_at"] == "2026-05-29T00:00:00Z"


def test_detail_page_skips_browser_or_login_urls(tmp_path):
    bid = {
        "id": "portal:1",
        "source": "Portal",
        "source_url": "https://example.gov/browser_check",
        "attachments": [],
    }
    session = FakeSession([])

    enriched = archive_bid_documents(bid, tmp_path, session=session, fetch_detail=True)

    assert enriched["detail_archive_status"] == "unavailable"
    assert enriched["detail_archive_error"] == "Detail URL appears to require browser/login access."
    assert session.calls == []
