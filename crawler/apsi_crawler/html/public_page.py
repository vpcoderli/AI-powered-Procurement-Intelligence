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
        self._table = None
        self._row = None
        self._cell = None
        self._in_table = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self._in_table = True
            self._table = []
        elif self._in_table and tag == "tr":
            self._row = []
        elif self._in_table and tag in ("th", "td"):
            self._cell = {"text": [], "links": []}
        elif self._cell is not None and tag == "a":
            href = attrs.get("href")
            if href:
                self._cell["links"].append(href)

    def handle_data(self, data):
        if self._cell is not None:
            self._cell["text"].append(data)

    def handle_endtag(self, tag):
        if self._in_table and tag in ("th", "td") and self._cell is not None:
            self._row.append(
                {
                    "text": normalize_space("".join(self._cell["text"])),
                    "links": list(self._cell["links"]),
                }
            )
            self._cell = None
        elif self._in_table and tag == "tr" and self._row is not None:
            if self._row:
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._in_table:
            self.tables.append(self._table or [])
            self._table = None
            self._in_table = False


def extract_table_rows(html, required_headers):
    parser = _TableParser()
    parser.feed(html)
    required = tuple(required_headers)
    last_missing = list(required)

    for table in parser.tables:
        if not table:
            continue
        headers = [cell["text"] for cell in table[0]]
        missing = [header for header in required if header not in headers]
        if missing:
            last_missing = missing
            continue

        rows = []
        for row in table[1:]:
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
