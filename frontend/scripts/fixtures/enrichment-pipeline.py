"""Offline cross-language fixture: real list adapter + local HTTP extractor + CLI JSON.

The saved IL detail page's description cell is expanded to exercise the long-body
boundary. Only the portal transport is replaced; no public portal is contacted.
"""

import contextlib
import io
import json
from pathlib import Path
import re
import sys
import tempfile
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "crawler"))
sys.path.insert(0, str(ROOT / "services" / "scrapling-extractor"))

from apsi_crawler import cli  # noqa: E402
from apsi_crawler.adapters import registry  # noqa: E402
from apsi_crawler.enrichment import ExtractorClient  # noqa: E402
from apsi_crawler.html.public_page import FetchedPage  # noqa: E402
from apsi_crawler.spiders.il_bidbuy import fetch_il_bidbuy_opportunities  # noqa: E402
from server import create_server  # noqa: E402


def sam_run(description_ok):
    notice_id = "offline-pipeline-sam"
    description_url = f"https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid={notice_id}"
    record = {
        "noticeId": notice_id, "title": "Federal data integration services",
        "fullParentPathName": "GENERAL SERVICES ADMINISTRATION.OFFICE OF PROCUREMENT",
        "description": description_url, "postedDate": "2026-09-16",
        "responseDeadLine": "2099-12-31", "uiLink": f"https://sam.gov/opp/{notice_id}/view",
    }
    body = ("Provide implementation and training services. " * 20) + "SamBoundaryOnlyKeyword."

    class Response:
        status_code = 200 if description_ok else 429

        def json(self):
            return {"totalRecords": 1, "opportunitiesData": [record]}

        def iter_content(self, chunk_size):
            yield json.dumps({"description": f"<p>{body}</p>"}).encode()

        def close(self):
            pass

    class Session:
        def get(self, url, **kwargs):
            response = Response()
            if url.endswith("/search"):
                response.status_code = 200
            return response

    output = io.StringIO()
    with patch("apsi_crawler.spiders.sam_gov_api.requests.Session", return_value=Session()), \
         contextlib.redirect_stdout(output):
        status = cli.fetch_sam_gov(
            database=None, api_key="offline-test-key", posted_from="09/16/2026",
            posted_to="09/17/2026", output_json=True,
        )
    assert status == 0, output.getvalue()
    return json.loads(output.getvalue()), body


def sam_backfill_run():
    """One SAM backfill run with an attempt budget of 1 whose oldest candidate links an untrusted description."""
    def row(key, first_seen_at, description_url):
        return {
            "id": f"sam_gov:{key}", "source_bid_id": key, "dedupe_key": f"sam_gov:{key}", "source": "SAM.gov",
            "title": f"Trail maintenance {key}", "description": "", "full_description": None,
            "issuer_name": "Department of the Interior", "issuer_type": "federal", "state_code": "US",
            "source_url": f"https://sam.gov/opp/{key}/view", "first_seen_at": first_seen_at,
            "raw_payload": {"description": description_url}, "attachments": [],
        }

    history = [
        row("offline-backfill-untrusted", "2020-01-01T00:00:00+00:00",
            "https://untrusted.example/noticedesc?noticeid=offline-backfill-untrusted"),
        row("offline-backfill-later", "2020-01-02T00:00:00+00:00",
            "https://api.sam.gov/prod/opportunities/v1/noticedesc?noticeid=offline-backfill-later"),
    ]

    class Session:
        def get(self, url, **kwargs):
            raise AssertionError(f"an untrusted description link is never fetched: {url}")

    output = io.StringIO()
    with patch("apsi_crawler.spiders.sam_gov_api.requests.Session", return_value=Session()), \
         contextlib.redirect_stdout(output):
        status = cli.fetch_sam_gov(
            database=None, api_key="offline-test-key", posted_from="09/16/2026", posted_to="09/17/2026",
            output_json=True, detail_history=history, detail_backfill_only=True, max_descriptions=1,
        )
    assert status == 0, output.getvalue()
    return history, json.loads(output.getvalue())


def main():
    scope = ("Install and commission the procurement data integration system. " * 20) + "BoundaryOnlyKeyword."
    detail_html = (ROOT / "services/scrapling-extractor/tests/fixtures/live/il_bidbuy_detail.html").read_text()
    detail_html, replaced = re.subn(
        r"(<td[^>]*>\s*Bulletin Desc:\s*</td>\s*<td[^>]*>).*?(</td>)",
        lambda match: match.group(1) + scope + match.group(2),
        detail_html,
        count=1,
        flags=re.S,
    )
    assert replaced == 1, "saved detail fixture must contain the description cell"

    def list_adapter(source, **kwargs):
        return fetch_il_bidbuy_opportunities(
            source,
            fixture_html=str(ROOT / "crawler/tests/fixtures/il_bidbuy_open_bids.html"),
            **kwargs,
        )

    task = {
        "task_id": "offline-pipeline", "source_id": "il_bidbuy", "label": "Illinois BidBuy",
        "state_code": "IL", "jurisdiction_level": "state", "provider_family": None,
        "limit": 1, "query": None, "date_range": None,
        "fetch_config": {
            "base_url": "https://www.bidbuy.illinois.gov/bso/",
            "enrichment": {
                "enabled": True, "min_interval_seconds": 0,
                "detail_selectors": {
                    "description": "//td[normalize-space(.)='Bulletin Desc:']/following-sibling::td[1]",
                    "contact": "//td[normalize-space(.)='Info Contact:']/following-sibling::td[1]",
                },
                "attachment_url_template": "https://www.bidbuy.illinois.gov/bso/external/bidDetail.sdo?downloadFileNbr={id}&docId={source_bid_id}",
            },
        },
    }
    with tempfile.TemporaryDirectory(prefix="apsi-extractor-pipeline-") as storage:
        server = create_server(0, storage_dir=storage)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        extractor = ExtractorClient(f"http://127.0.0.1:{server.server_address[1]}")
        try:
            def run(enabled, level="state"):
                request = json.loads(json.dumps(task))
                request["fetch_config"]["enrichment"]["enabled"] = enabled
                request["jurisdiction_level"] = level
                if level != "state":
                    request["source_id"] = f"offline_{level}"
                    request["label"] = f"Offline {level} procurement"
                output = io.StringIO()
                with patch.dict(registry.DEDICATED_ADAPTERS, {request["source_id"]: list_adapter}), \
                     patch("apsi_crawler.enrichment.ExtractorClient", return_value=extractor), \
                     patch.dict("os.environ", {"SCRAPLING_EXTRACTOR_URL": extractor.base_url}), \
                     patch("apsi_crawler.enrichment.fetch_page", side_effect=lambda url, **kwargs: FetchedPage(detail_html, url, False)), \
                     contextlib.redirect_stdout(output):
                    status = cli.fetch_task(request)
                assert status == 0, output.getvalue()
                return json.loads(output.getvalue())

            enriched = run(True)
            plain = run(False)
            local = {level: run(False, level) for level in ("county", "city", "township", "special_district")}
            sam_enriched, sam_body = sam_run(True)
            sam_failed, _ = sam_run(False)
            sam_backfill_history, sam_backfill = sam_backfill_run()
            print(json.dumps({
                "enriched": enriched, "plain": plain, "scope": scope, "local": local,
                "sam_enriched": sam_enriched, "sam_failed": sam_failed, "sam_body": sam_body,
                "sam_backfill_history": sam_backfill_history, "sam_backfill": sam_backfill,
            }))
        finally:
            extractor.session.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
