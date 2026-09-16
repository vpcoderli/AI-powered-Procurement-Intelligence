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
            def run(enabled):
                task["fetch_config"]["enrichment"]["enabled"] = enabled
                output = io.StringIO()
                with patch.dict(registry.DEDICATED_ADAPTERS, {"il_bidbuy": list_adapter}), \
                     patch("apsi_crawler.enrichment.ExtractorClient", return_value=extractor), \
                     patch.dict("os.environ", {"SCRAPLING_EXTRACTOR_URL": extractor.base_url}), \
                     patch("apsi_crawler.enrichment.fetch_page", side_effect=lambda url, **kwargs: FetchedPage(detail_html, url, False)), \
                     contextlib.redirect_stdout(output):
                    status = cli.fetch_task(task)
                assert status == 0, output.getvalue()
                return json.loads(output.getvalue())

            enriched = run(True)
            plain = run(False)
            print(json.dumps({"enriched": enriched, "plain": plain, "scope": scope}))
        finally:
            extractor.session.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    main()
