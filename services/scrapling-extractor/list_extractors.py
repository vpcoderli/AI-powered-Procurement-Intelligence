"""List-page extraction (contract C2) on top of Scrapling's parser.

`/extract` turns ONE detail page into fields; this module turns ONE list page into the rows a
crawler adapter would otherwise find with a regex. The input HTML is always fetched by the caller
(the crawler, or the browser-downloader sidecar's `/render`) — nothing here makes a request.

Strategy per request:
  1. explicit `item_selector` (CSS or XPath) when the caller configured one, else
  2. a heuristic: the repeated sibling group whose members hold the most detail-looking anchors.
Per field: caller selector → heuristic → `not_found`, reported in `diagnostics`.

Empty-list pages are recognized separately (`detect_empty_state`) so a legitimately empty portal
page is reported as such instead of being parsed into whatever navigation chrome it carries.
"""

import re
from urllib.parse import urljoin, urlparse

from scrapling.parser import Selector

# Same adaptive-selector store and text hygiene as `/extract` — the two routes share one storage
# file per deployment, keyed by the request URL's host (see server.resolve_storage_dir).
from extractors import STORAGE_FILE_NAME, ExtractError, _clean, _has_noise_ancestor

LIST_FIELDS = ("title", "url", "published_date", "deadline_date", "source_bid_id", "issuer_name")
DEFAULT_MAX_ITEMS = 200
MAX_ITEMS_CAP = 500
# Tags a repeated result row is actually built from. `table`/`tbody`/`ul` are deliberately absent:
# a whole table holds every detail anchor on the page and would otherwise win as "one item".
_CANDIDATE_TAGS = ("tr", "li", "article", "dd", "div", "section", "td")
# Preference order when two candidate groups are equally good; a `tr` or `li` is a row by
# construction, a `div` only sometimes.
_TAG_RANK = {"tr": 0, "li": 1, "article": 2, "dd": 3, "section": 4, "div": 5, "td": 6}
_MAX_TITLE_CHARS = 400
_MAX_ISSUER_CHARS = 200

# ---------------------------------------------------------------------------------------------
# Empty-list detection. The phrase set mirrors contract C1's rule in the crawler
# (`content_quality.detect_empty_list`); tenant confirmation is the crawler's job, not ours —
# this service only reports which phrase it saw.
# ---------------------------------------------------------------------------------------------
_EMPTY_STATE_RE = re.compile(
    r"there are (?:currently )?no\s+\w+"
    r"|no open (?:bids|solicitations|opportunities)"
    r"|no (?:bids|solicitations|opportunities) (?:are )?(?:currently )?(?:open|available|posted)"
    r"|no solicitations (?:are )?(?:currently )?available"
    r"|no (?:current|matching|active) (?:bids|solicitations|opportunities)"
    r"|no (?:results|records|bids|solicitations|opportunities)(?: were)? found"
    r"|no results found"
    r"|your search returned no",
    re.I,
)
_SENTENCE_END = ".!?\n"
_MAX_MARKER_CHARS = 200

_DATE_RE = re.compile(
    r"(?:\d{4}-\d{2}-\d{2}"
    r"|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}"
    r"|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}"
    r"|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4})"
    r"(?:\s*,?\s*\d{1,2}:\d{2}(?:\s*[APap]\.?[Mm]\.?)?)?"
)
_PUBLISHED_HINTS = ("publi", "posted", "post date", "issue", "advertis", "release", "start date", "begin")
_DEADLINE_HINTS = ("clos", "due", "deadline", "expir", "opening", "response date", "end date", "submit")
_ISSUER_HINTS = ("agency", "organization", "issuer", "entity", "department", "buyer", "owner", "jurisdiction", "dept")
# Column-header keywords, checked in this order against each `<th>` of the row's table.
_HEADER_HINTS = {
    "title": ("title", "description", "subject", "project", "solicitation name", "bid name", "short desc"),
    "issuer_name": _ISSUER_HINTS,
    "published_date": _PUBLISHED_HINTS,
    "deadline_date": _DEADLINE_HINTS,
    "source_bid_id": ("#", "number", "no.", " no", "id", "reference", "ref ", "code"),
}

# Hrefs that are navigation, not a solicitation. The hyphenated group is matched mid-segment
# because portals spell the sign-up link every way ("/public/user-registration"); the plain group
# is matched at segment boundaries only, so a solicitation slug such as
# "/…/Nursing-Home-Renovation/0000425954" is not mistaken for a "home" link.
_NON_DETAIL_HREF_RE = re.compile(
    r"^(?:javascript:|mailto:|tel:|#)"
    r"|/(?:login|logout|signin|sign-in|register|registration|help|faq|support|contact|terms|privacy|about|search|home)(?:[/?#.]|$)"
    r"|(?:^|[/-])(?:user-registration|vendor-registration|account-registration|create-account|forgot-password|reset-password)(?:[/?#.]|$)"
    r"|[?&](?:page|pagenum|sort|sortby|order|lang|locale)=",
    re.I,
)
_ID_QUERY_KEYS = (
    "docid", "bidid", "solicitationid", "solicitation", "contractid", "projectid", "eventid",
    "opportunityid", "oppid", "noticeid", "recordid", "itemid", "id", "sid", "bidnumber", "number",
)
_NUMERIC_SEGMENT_RE = re.compile(r"^\d{4,}$")


_VISIBLE_TEXT_XPATH = (
    "//text()[not(ancestor::script) and not(ancestor::style) and not(ancestor::noscript)"
    " and not(ancestor::template) and not(ancestor::*[@aria-hidden='true']) and not(ancestor::*[@hidden])"
    " and not(ancestor::*[contains(translate(@style, ' ', ''), 'display:none')])"
    " and not(ancestor::*[contains(translate(@style, ' ', ''), 'visibility:hidden')])]"
)


def _visible_text(page):
    """Page copy a browser would actually show — hidden template rows must not speak for the page.

    BidNet keeps an `aria-hidden="true"` "There are no open bids" row in the DOM above the real
    rows (verified 2026-09-16 on a tenant with 16 open solicitations).
    """
    try:
        nodes = page.xpath(_VISIBLE_TEXT_XPATH)
        return " ".join(str(node) for node in nodes)
    except Exception:  # noqa: BLE001 - fall back to the plain text walk on odd markup
        return page.get_all_text(separator=" ", strip=True) or ""


def detect_empty_state(page):
    """`{"detected": bool, "marker": str|None}` for a list page whose VISIBLE copy says it holds no bids."""
    text = _clean(_visible_text(page)) or ""
    match = _EMPTY_STATE_RE.search(text)
    if not match:
        return {"detected": False, "marker": None}
    return {"detected": True, "marker": _marker_sentence(text, match.start(), match.end())}


def _marker_sentence(text, start, end):
    """The phrase plus the rest of its sentence, so operators can see what the page said.

    Nothing before the phrase is kept: list pages glue their filter chrome ("keywords Find Bids")
    to the message with no punctuation in between, and that chrome is not what the portal said.
    """
    right = min(
        (position for position in (text.find(char, end) for char in _SENTENCE_END) if position != -1),
        default=-1,
    )
    sentence = text[start: right + 1 if right != -1 else min(len(text), end + _MAX_MARKER_CHARS)]
    return " ".join(sentence.split())[:_MAX_MARKER_CHARS].strip() or None


# ---------------------------------------------------------------------------------------------
# Selection helpers
# ---------------------------------------------------------------------------------------------


def _select(node, selector, auto_save=True):
    """Run a caller-supplied CSS/XPath selector with Scrapling's adaptive matching enabled."""
    if selector.startswith("/") or selector.startswith("("):
        return node.xpath(selector, identifier=selector, adaptive=True, auto_save=auto_save)
    return node.css(selector, identifier=selector, adaptive=True, auto_save=auto_save)


def _depth(element):
    depth, current = 0, element.parent
    while current is not None and depth < 100:
        depth += 1
        current = current.parent
    return depth


# Presentational / alternating-row classes must not split one row group into two ("odd" rows
# and "even" rows), otherwise the heuristic picks half the table (BidNet, verified 2026-09-16).
_STATE_CLASSES = frozenset((
    "odd", "even", "first", "last", "alt", "alternate", "striped", "selected", "active", "hover",
    "expanded", "collapsed", "highlight", "highlighted",
))


def _class_signature(element):
    return tuple(sorted(
        name for name in (element.attrib.get("class") or "").split()
        if name.lower() not in _STATE_CLASSES and not name.lower().startswith(("row-", "row_", "item-", "n-"))
    ))


def _is_detail_href(href, base_url):
    if not href or _NON_DETAIL_HREF_RE.search(href.strip()):
        return False
    absolute = urljoin(base_url, href.strip())
    parsed = urlparse(absolute)
    if parsed.scheme not in ("http", "https"):
        return False
    target = f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path
    # A solicitation link always carries an identifier of some kind; a bare section path does not.
    return bool(re.search(r"\d", target)) and len(target.strip("/")) > 1


def _detail_anchors(element, base_url):
    return [
        anchor
        for anchor in element.css("a[href]")
        if _is_detail_href(anchor.attrib.get("href"), base_url) and not _has_noise_ancestor(anchor)
    ]


def _candidate_groups(page, base_url):
    """Group same-parent, same-shape elements; score each by how many members look like rows."""
    groups = {}
    for element in page.css(", ".join(_CANDIDATE_TAGS)):
        if _has_noise_ancestor(element):
            continue
        parent = element.parent
        key = (id(parent._root) if parent is not None else 0, element.tag, _class_signature(element))
        groups.setdefault(key, []).append(element)
    scored = []
    for (_, tag, _classes), members in groups.items():
        hits = [member for member in members if _detail_anchors(member, base_url)]
        if not hits:
            continue
        scored.append(
            {
                "members": members,
                "hits": len(hits),
                "ratio": len(hits) / len(members),
                "tag_rank": _TAG_RANK.get(tag, 9),
                "depth": _depth(members[0]),
            }
        )
    return scored


def _heuristic_items(page, base_url):
    """(elements, descriptive selector) for the best repeated row group, or ([], None)."""
    scored = _candidate_groups(page, base_url)
    if not scored:
        return [], None
    best = max(scored, key=lambda group: (group["hits"], group["ratio"], -group["tag_rank"], -group["depth"]))
    members = [member for member in best["members"] if _detail_anchors(member, base_url)]
    if not members:
        return [], None
    return members, _describe(members[0])


def _describe(element):
    """A CSS selector naming the chosen group, so an operator can pin it in `item_selector`."""
    classes = _class_signature(element)
    if classes:
        return element.tag + "".join(f".{name}" for name in classes)
    parent = element.parent
    return f"{parent.tag} > {element.tag}" if parent is not None else element.tag


def _locate_items(page, item_selector, base_url, auto_save):
    if item_selector:
        matched = [element for element in _select(page, item_selector, auto_save) if element.tag is not None]
        return matched, (item_selector if matched else None), "selector"
    elements, descriptor = _heuristic_items(page, base_url)
    return elements, descriptor, "heuristic"


# ---------------------------------------------------------------------------------------------
# Field heuristics
# ---------------------------------------------------------------------------------------------


def _header_map(element):
    """{field: column index} for a `<tr>` whose table has a header row; {} otherwise."""
    if element.tag != "tr":
        return {}
    table = element
    while table is not None and table.tag != "table":
        table = table.parent
    if table is None:
        return {}
    headers = [_clean(cell.get_all_text(separator=" ", strip=True)) or "" for cell in table.css("th")]
    if not headers:
        first_row = table.css("tr")
        headers = (
            [_clean(cell.get_all_text(separator=" ", strip=True)) or "" for cell in first_row[0].css("td")]
            if first_row and first_row[0]._root is not element._root
            else []
        )
    mapping = {}
    for index, header in enumerate(headers):
        lowered = header.lower()
        for field, hints in _HEADER_HINTS.items():
            if field not in mapping and any(hint in lowered for hint in hints):
                mapping[field] = index
                break
    return mapping


def _cell_text(element, mapping, field):
    index = mapping.get(field)
    if index is None:
        return None
    cells = element.css("td")
    if index >= len(cells):
        return None
    return _clean(cells[index].get_all_text(separator=" ", strip=True))


def _labelled_date(element, hints):
    """Date from the tightest descendant whose class, id or text carries one of `hints`.

    "Tightest" matters: a row's outer cell usually contains both the published and the closing
    label, so the first matching ancestor would answer every hint with the first date on the row.
    The smallest matching element is the one that actually belongs to the label.
    """
    best, best_length = None, None
    for node in element.css("*"):
        text = _clean(node.get_all_text(separator=" ", strip=True)) or ""
        marker = f"{node.attrib.get('class') or ''} {node.attrib.get('id') or ''} {text}".lower()
        if not any(hint in marker for hint in hints):
            continue
        match = _DATE_RE.search(text)
        if match and (best_length is None or len(text) < best_length):
            best, best_length = " ".join(match.group(0).split()), len(text)
    return best


def _issuer_text(element):
    for node in element.css("*"):
        marker = f"{node.attrib.get('class') or ''} {node.attrib.get('id') or ''}".lower()
        if not any(hint in marker for hint in _ISSUER_HINTS):
            continue
        text = _clean(node.get_all_text(separator=" ", strip=True))
        if text and len(text) <= _MAX_ISSUER_CHARS:
            return text
    return None


def _source_bid_id_from_url(absolute_url):
    if not absolute_url:
        return None
    parsed = urlparse(absolute_url)
    for segment in reversed([part for part in parsed.path.split("/") if part]):
        if _NUMERIC_SEGMENT_RE.match(segment):
            return segment
    query = {}
    for pair in parsed.query.split("&"):
        if "=" not in pair:
            continue
        key, value = pair.split("=", 1)
        query.setdefault(key.strip().lower(), value.strip())
    for key in _ID_QUERY_KEYS:
        value = query.get(key)
        if value and len(value) >= 2:
            return value
    return None


def _selector_value(element, selector, field, base_url, auto_save):
    selected = _select(element, selector, auto_save)
    node = selected.first if selected else None
    if node is None:
        return None
    if field == "url":
        return _absolute_href(_href_of(node), base_url)
    return _clean(node.get_all_text(separator=" ", strip=True))


def _href_of(node):
    href = node.attrib.get("href") if node.tag == "a" else None
    if href:
        return href
    anchors = node.css("a[href]")
    return anchors[0].attrib.get("href") if anchors else None


def _absolute_href(href, base_url):
    if not href:
        return None
    absolute = urljoin(base_url, href.strip())
    return absolute if urlparse(absolute).scheme in ("http", "https") else None


_LOWERCASE_WORD_RE = re.compile(r"[a-z]{3,}")


def _looks_like_identifier(text):
    """Solicitation numbers ("IL-BIDBUY-2026-001", "27-444DHS-P", "0000437133"), not titles.

    At most two tokens, at least one digit, and no lowercase word of three letters or more.
    """
    words = text.split()
    return len(words) <= 2 and any(ch.isdigit() for ch in text) and not _LOWERCASE_WORD_RE.search(text)


def _heuristic_value(field, element, anchor, mapping, base_url, absolute_url):
    if field == "url":
        return absolute_url
    if field == "title":
        cell = _cell_text(element, mapping, "title")
        anchor_text = _clean(anchor.get_all_text(separator=" ", strip=True)) if anchor is not None else None
        # Table portals often print the solicitation number in the link and the real title in a
        # "Description" column; prefer the column only when the link text is an identifier.
        # When the link already carries a human title, the cell is the whole row (title + dates
        # + labels) and must not replace it.
        if cell and (not anchor_text or (_looks_like_identifier(anchor_text) and cell != anchor_text)):
            return cell[:_MAX_TITLE_CHARS]
        return anchor_text[:_MAX_TITLE_CHARS] if anchor_text else (cell or None)
    if field in ("published_date", "deadline_date"):
        hints = _PUBLISHED_HINTS if field == "published_date" else _DEADLINE_HINTS
        cell = _cell_text(element, mapping, field)
        if cell:
            match = _DATE_RE.search(cell)
            if match:
                return " ".join(match.group(0).split())
        return _labelled_date(element, hints)
    if field == "source_bid_id":
        return _source_bid_id_from_url(absolute_url) or _cell_text(element, mapping, "source_bid_id")
    if field == "issuer_name":
        cell = _cell_text(element, mapping, "issuer_name")
        if cell:
            return cell[:_MAX_ISSUER_CHARS]
        return _issuer_text(element)
    return None


def _extract_item(element, fields, selectors, base_url, auto_save, diagnostics):
    anchors = _detail_anchors(element, base_url)
    anchor = next(
        (candidate for candidate in anchors if _clean(candidate.get_all_text(separator=" ", strip=True))),
        anchors[0] if anchors else None,
    )
    absolute_url = _absolute_href(anchor.attrib.get("href"), base_url) if anchor is not None else None
    mapping = _header_map(element)
    item = {}
    for field in fields:
        selector = selectors.get(field)
        value = None
        if selector:
            value = _selector_value(element, selector, field, base_url, auto_save)
            if value:
                diagnostics[field] = "selector"
        else:
            value = _heuristic_value(field, element, anchor, mapping, base_url, absolute_url)
            if value and diagnostics.get(field) != "selector":
                diagnostics[field] = "heuristic"
        item[field] = value or None
    return item


# ---------------------------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------------------------


def _validate(url, fields, selectors, item_selector, max_items):
    if fields is None:
        fields = list(LIST_FIELDS)
    if not isinstance(fields, list):
        raise ExtractError("fields must be a list")
    unknown = [field for field in fields if not isinstance(field, str) or field not in LIST_FIELDS]
    if unknown:
        raise ExtractError(f"unsupported fields: {unknown}")
    selectors = {} if selectors is None else selectors
    if not isinstance(selectors, dict) or any(
        key not in LIST_FIELDS or not isinstance(value, str) or not value.strip()
        for key, value in selectors.items()
    ):
        raise ExtractError("selectors must map supported fields to nonempty selector strings")
    if item_selector is not None and (not isinstance(item_selector, str) or not item_selector.strip()):
        raise ExtractError("item_selector must be a nonempty string or null")
    if isinstance(max_items, bool) or not isinstance(max_items, int):
        raise ExtractError("max_items must be an integer")
    if not 1 <= max_items <= MAX_ITEMS_CAP:
        raise ExtractError(f"max_items must be between 1 and {MAX_ITEMS_CAP}")
    try:
        parsed = urlparse(url)
        valid = parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ExtractError("url must be an absolute HTTP(S) URL")
    return fields, selectors


def extract_list(
    html,
    url,
    item_selector=None,
    selectors=None,
    fields=None,
    max_items=DEFAULT_MAX_ITEMS,
    storage_dir=None,
    auto_save=True,
):
    """Extract solicitation rows from one list page (C2).

    `storage_dir` is the directory holding Scrapling's adaptive-selector SQLite store (shared with
    `/extract`); when None the store falls back to scrapling's own default inside site-packages.
    """
    fields, selectors = _validate(url, fields, selectors, item_selector, max_items)
    if not isinstance(html, str):
        raise ExtractError("html must be a string")
    storage_args = (
        {"storage_file": f"{storage_dir.rstrip('/')}/{STORAGE_FILE_NAME}", "url": url}
        if storage_dir
        else None
    )
    page = Selector(html, url=url, adaptive=True, storage_args=storage_args)
    # Rows first, empty state second: a page with parsed rows is never "empty", whatever
    # copy its (hidden) templates carry. The row heuristic must therefore not invent rows out
    # of chrome — registration/"get notified" links are excluded in _locate_items.
    elements, item_selector_used, _strategy = _locate_items(page, item_selector, url, auto_save)
    diagnostics = {field: "not_found" for field in fields}
    items = []
    for element in elements:
        if len(items) >= max_items:
            break
        item = _extract_item(element, fields, selectors, url, auto_save, diagnostics)
        if not item.get("title") and not item.get("url"):
            continue  # header rows, spacer rows, and anything else with nothing to persist
        items.append(item)
    if not items:
        item_selector_used = item_selector_used if item_selector else None
    detected = detect_empty_state(page) if not items else {"detected": False, "marker": None}
    return {
        "items": items,
        "diagnostics": diagnostics,
        "item_selector_used": item_selector_used,
        "empty_state": detected,
    }
