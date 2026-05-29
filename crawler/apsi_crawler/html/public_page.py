from html.parser import HTMLParser
from urllib.parse import urljoin

import requests


class HtmlPageError(Exception):
    pass


def read_html_fixture(path):
    with open(path, encoding="utf-8") as fixture:
        return fixture.read()


def normalize_space(value):
    return " ".join(str(value or "").replace("\xa0", " ").split())


def absolute_url(base_url, href):
    return urljoin(base_url, href or "")


def fetch_html(url, session=None, timeout=30, params=None):
    client = session or requests.Session()
    close_client = session is None
    try:
        try:
            response = client.get(
                url,
                params=params,
                headers={"Accept": "text/html,application/xhtml+xml"},
                timeout=timeout,
            )
        except requests.RequestException as error:
            raise HtmlPageError(f"HTML request failed: {error}") from error

        if response.status_code != 200:
            raise HtmlPageError(
                f"HTML request failed with status {response.status_code}: {response.text}"
            )

        content_type = response.headers.get("Content-Type", "")
        if "html" not in content_type.lower():
            raise HtmlPageError(
                f"HTML response content type was not HTML: {content_type}"
            )

        if not response.text.strip():
            raise HtmlPageError("HTML response was empty")

        return response.text
    finally:
        if close_client:
            client.close()


class _TableParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._table_stack = []
        self._table_order = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self._table_order += 1
            self._table_stack.append(
                {
                    "rows": [],
                    "row": None,
                    "cell": None,
                    "depth": len(self._table_stack),
                    "order": self._table_order,
                }
            )
            return

        if not self._table_stack:
            return

        current = self._table_stack[-1]
        if tag == "tr":
            current["row"] = []
        elif tag in ("th", "td"):
            current["cell"] = {"text": [], "links": []}
        elif current["cell"] is not None and tag == "a":
            href = attrs.get("href")
            if href:
                current["cell"]["links"].append(href)

    def handle_data(self, data):
        if not self._table_stack:
            return

        current = self._table_stack[-1]
        if current["cell"] is not None:
            current["cell"]["text"].append(data)

    def handle_endtag(self, tag):
        if not self._table_stack:
            return

        current = self._table_stack[-1]
        if tag in ("th", "td") and current["cell"] is not None:
            current["row"].append(
                {
                    "text": normalize_space("".join(current["cell"]["text"])),
                    "links": list(current["cell"]["links"]),
                }
            )
            current["cell"] = None
        elif tag == "tr" and current["row"] is not None:
            if current["row"]:
                current["rows"].append(current["row"])
            current["row"] = None
        elif tag == "table":
            finished = self._table_stack.pop()
            self.tables.append(
                {
                    "depth": finished["depth"],
                    "order": finished["order"],
                    "rows": finished["rows"],
                }
            )


def extract_html_tables(html):
    parser = _TableParser()
    parser.feed(html)
    return [
        table["rows"]
        for table in sorted(
            parser.tables,
            key=lambda item: (item["depth"], item["order"]),
        )
    ]


def extract_table_rows(html, required_headers):
    tables = extract_html_tables(html)
    required = tuple(required_headers)
    last_missing = list(required)

    for table in tables:
        if not table:
            continue
        header_index = None
        headers = []
        for index, row in enumerate(table):
            row_headers = [cell["text"] for cell in row]
            missing = [header for header in required if header not in row_headers]
            if missing:
                if len(missing) < len(last_missing):
                    last_missing = missing
                continue
            header_index = index
            headers = row_headers
            break
        if header_index is None:
            continue

        rows = []
        for row in table[header_index + 1:]:
            values = {}
            links = {}
            for index, header in enumerate(headers):
                if index >= len(row):
                    values[header] = ""
                    continue
                values[header] = row[index]["text"]
                if row[index]["links"]:
                    links[header] = row[index]["links"][0]
            values["_links"] = links
            rows.append(values)
        return rows

    missing = ", ".join(last_missing)
    raise HtmlPageError(f"HTML table was missing required headers: {missing}")
