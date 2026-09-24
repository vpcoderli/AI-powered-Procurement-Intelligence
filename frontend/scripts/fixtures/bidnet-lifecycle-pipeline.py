"""Offline cross-language fixture: saved BidNet list -> real reader + real Scrapling sidecar -> CLI JSON.

Run 1 serves Denver's saved open list; run 2 serves the same page with one row removed. Only
the portal transport is replaced; no public portal is contacted.
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
from apsi_crawler.html.public_page import FetchedPage  # noqa: E402
from server import create_server  # noqa: E402

REMOVED = "0000436007"


def main():
    page = (ROOT / "crawler/tests/fixtures/bidnet_denver_open_bids_2026_09_24.html").read_text(encoding="utf-8")
    # The saved page renders each row as `<tr  data-index="N"  class="...">` (two spaces, not
    # one) -- `\s+` tolerates that instead of assuming an exact single space.
    without_row, removed = re.subn(r'<tr\s+data-index="\d+"[^>]*>(?:(?!</tr>).)*' + REMOVED + r".*?</tr>", "", page, count=1, flags=re.S)
    assert removed == 1, "the saved page must contain the row to remove"
    # BidNet prints the list total; a walk is only complete when the ids it collected match it.
    assert "6 Open Solicitations" in without_row, "the saved page must print its total"
    without_row = without_row.replace("6 Open Solicitations", "5 Open Solicitations", 1)
    base_url = "https://www.bidnetdirect.com/colorado/city-and-county-of-denver-general-services-purchasing/solicitations/open-bids"
    task = {
        "task_id": "offline-lifecycle", "source_id": "bidnet_co_denver",
        "label": "City and County of Denver General Services Purchasing (BidNet)", "state_code": "CO",
        "jurisdiction_level": "county", "provider_family": "bidnet", "limit": None, "query": None,
        "date_range": None, "list_kind": "open", "start_page": 1, "max_pages": 4, "stop_before": None,
        "fetch_config": {"base_url": base_url},
    }
    with tempfile.TemporaryDirectory(prefix="apsi-lifecycle-pipeline-") as storage:
        server = create_server(0, storage_dir=storage)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def run(html):
                output = io.StringIO()
                with patch("apsi_crawler.spiders.co_bidnet.fetch_page", side_effect=lambda url, **kwargs: FetchedPage(html, url, False)), \
                     patch("apsi_crawler.spiders.co_bidnet.time.sleep", lambda seconds: None), \
                     patch.dict("os.environ", {"SCRAPLING_EXTRACTOR_URL": f"http://127.0.0.1:{server.server_address[1]}"}), \
                     contextlib.redirect_stdout(output):
                    status = cli.fetch_task(dict(task))
                assert status == 0, output.getvalue()
                return json.loads(output.getvalue())

            first = run(page)
            second = run(without_row)
        finally:
            server.shutdown()
    print(json.dumps({"first": first, "second": second, "removedId": f"bidnet_co_denver:{REMOVED}"}))


if __name__ == "__main__":
    main()
