"""`archive_bid_documents` (fetch-sam-gov --archive-documents) after the 2026-09-16 hardening.

`storage_path` is now RELATIVE to the archive root, requests carry the crawler's browser
headers plus the detail page as Referer, the body is streamed with a size cap, and an
attachment whose bytes are HTML is refused instead of being written under a `.pdf` name.
"""

from pathlib import Path

from apsi_crawler.html.public_page import BROWSER_REQUEST_HEADERS
from apsi_crawler.storage.archive import archive_bid_documents


PDF_BYTES = b"%PDF-1.4 scope"


class FakeResponse:
    def __init__(self, status_code=200, content=b"%PDF-1.4 contract notice", headers=None, url=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {"Content-Type": "application/pdf"}
        self.url = url
        self.history = []
        self.closed = False

    def iter_content(self, chunk_size=8192):
        for start in range(0, len(self.content), chunk_size):
            yield self.content[start:start + chunk_size]

    def close(self):
        self.closed = True


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, headers=None, timeout=30, stream=False, **kwargs):
        self.calls.append({"url": url, "headers": headers, "timeout": timeout, "stream": stream})
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
    session = FakeSession([FakeResponse(content=PDF_BYTES, headers={"Content-Type": "application/pdf"})])

    enriched = archive_bid_documents(bid, tmp_path, session=session, fetched_at="2026-05-29T00:00:00Z")

    attachment = enriched["attachments"][0]
    assert attachment["original_url"] == "https://www.bidbuy.illinois.gov/documents/scope.pdf"
    assert attachment["storage_path"] == "illinois_bidbuy/il_bidbuy_il-bidbuy-2026-001/attachment-1.pdf"
    assert not Path(attachment["storage_path"]).is_absolute()
    assert (tmp_path / attachment["storage_path"]).read_bytes() == PDF_BYTES
    assert attachment["byte_size"] == 14
    assert attachment["content_type"] == "application/pdf"
    assert attachment["checksum_sha256"] == "832d1aef7b8bc5c7f7906dfdba5696a8d1b5cc2977acf54c578bb83ac21125ff"
    assert attachment["fetched_at"] == "2026-05-29T00:00:00Z"
    assert attachment["archive_status"] == "archived"
    assert session.calls[0]["url"] == "https://www.bidbuy.illinois.gov/documents/scope.pdf"
    assert session.calls[0]["timeout"] == 30
    assert session.calls[0]["stream"] is True
    assert session.calls[0]["headers"]["User-Agent"] == BROWSER_REQUEST_HEADERS["User-Agent"]
    assert session.calls[0]["headers"]["Accept"] == "*/*"
    assert session.calls[0]["headers"]["Referer"] == bid["source_url"]


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


def test_downloads_urls_that_merely_contain_a_blocklist_word(tmp_path):
    bid = {
        "id": "local:2",
        "source": "Local",
        "source_url": "https://example.gov/detail",
        "attachments": [{"name": "Authority packet", "url": "https://example.gov/authority/packet.pdf"}],
    }
    session = FakeSession([FakeResponse(content=PDF_BYTES)])

    enriched = archive_bid_documents(bid, tmp_path, session=session)

    assert enriched["attachments"][0]["archive_status"] == "archived"


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
    assert attachment["failure_kind"] == "http_4xx"
    assert attachment["storage_path"] is None


def test_refuses_to_store_an_html_page_as_an_attachment(tmp_path):
    bid = {
        "id": "il_bidbuy:IL-BIDBUY-2026-003",
        "source": "Illinois BidBuy",
        "source_url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?docId=IL-BIDBUY-2026-003",
        "attachments": [
            {"name": "Session error", "url": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr=1"}
        ],
    }
    session = FakeSession([
        FakeResponse(
            content=b"<html><body>ERROR IN PROCESSING YOUR SESSION</body></html>",
            headers={"Content-Type": "text/html"},
        )
    ])

    enriched = archive_bid_documents(bid, tmp_path, session=session)

    attachment = enriched["attachments"][0]
    assert attachment["archive_status"] == "failed"
    assert attachment["failure_kind"] == "html_response"
    assert attachment["storage_path"] is None
    assert list(tmp_path.rglob("*")) == []


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
    assert attachment["archive_error"] == "Downloaded document was empty."
    assert attachment["failure_kind"] == "network"
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
    assert enriched["detail_archive_path"] == (
        "washington_state_procurement/wa_state_procurement_des-2026-0815/detail-1.html"
    )
    assert (tmp_path / enriched["detail_archive_path"]).read_bytes() == b"<html>detail</html>"
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
