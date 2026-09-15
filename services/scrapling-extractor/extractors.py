"""Field extraction on top of Scrapling's parser (base package only — no fetchers)."""

import mimetypes
import os
import re
from urllib.parse import urljoin, urlparse

from scrapling.parser import Selector

SUPPORTED_FIELDS = ("description", "attachments", "category", "contact", "published_date")

_LABELS = {
    "description": ("Description", "Summary", "Scope of Work", "Scope", "Details"),
    # "NIGP Code" is the commodity classification BuySpeed portals (IL BidBuy, OregonBuys) print.
    "category": ("Category", "Commodity", "NIGP Code", "NAICS", "UNSPSC", "Classification"),
    "contact": ("Contact", "Buyer", "Procurement Officer", "Point of Contact"),
    "published_date": ("Posted Date", "Published", "Publish Date", "Issue Date", "Post Date", "Posted"),
    "attachments": ("File Attachments", "Attachments", "Documents", "Bid Documents", "Files"),
}
_DOCUMENT_EXTENSIONS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".csv", ".ppt", ".pptx", ".txt")
_NOISE_TAGS = ("nav", "header", "footer", "script", "style", "noscript")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")
_MAX_TEXT = 20_000
# Scrapling keys its adaptive-selector store by an absolute file path handed to the storage
# class; with no `storage_args` it defaults to `<site-packages>/scrapling/elements_storage.db`
# (scrapling/parser.py `__DEFAULT_DB_FILE__`) and has no environment override of its own.
STORAGE_FILE_NAME = "elements_storage.db"


class ExtractError(ValueError):
    pass


def _clean(text):
    return " ".join((text or "").replace("\xa0", " ").split())[:_MAX_TEXT] or None


def _element_text(element):
    if element is None:
        return None
    return _clean(element.get_all_text(separator=" ", strip=True))


def _label_value(page, labels):
    """Text of the cell/element that follows a label cell (table rows, dt/dd, label/value divs)."""
    for label in labels:
        match = page.find_by_text(label, partial=True, first_match=True, case_sensitive=False)
        if not match:
            continue  # find_by_text(first_match=True) returns an empty Selectors, not None, on no match
        own = _clean(match.text)
        if own is None or len(own) > len(label) + 40:
            continue  # the label matched inside a long paragraph, not a label cell
        following = match.next
        value = _element_text(following)
        if value:
            return value, following
        parent_next = match.parent.next if match.parent is not None else None
        value = _element_text(parent_next)
        if value:
            return value, parent_next
    return None, None


def _select(page, selector):
    if selector.startswith("/") or selector.startswith("("):
        return page.xpath(selector, identifier=selector, adaptive=True, auto_save=True)
    return page.css(selector, identifier=selector, adaptive=True, auto_save=True)


def _largest_text_block(page):
    best, best_len = None, 0
    for element in page.css("main, article, section, div, td, p"):
        if element.tag in _NOISE_TAGS:
            continue
        text = _element_text(element)
        if text and len(text) > best_len and len(element.css("div, section, table")) <= 3:
            best, best_len = text, len(text)
    return best


def _mime_for(href):
    path = urlparse(href).path if href else ""
    for extension in _DOCUMENT_EXTENSIONS:
        if path.lower().endswith(extension):
            return mimetypes.guess_type(path)[0] or "application/octet-stream"
    return None


def _attachments(page, url, selector=None):
    if selector:
        anchors = [a for a in _select(page, selector) if a.tag == "a"]
    else:
        anchors = []
        _, container = _label_value(page, _LABELS["attachments"])
        if container is not None:
            anchors = list(container.css("a[href]"))
        if not anchors:
            # Match on the href path OR the link text: download handlers such as
            # `FileDownload.aspx?file=x/Solicitation_1.pdf` (PA eMarketplace) carry the document
            # extension only in the query string / anchor text, never in the URL path.
            anchors = [
                a
                for a in page.css("a[href]")
                if _mime_for(a.attrib.get("href", "")) or _mime_for(_clean(a.text) or "")
            ]
    results, seen = [], set()
    for anchor in anchors:
        raw_href = (anchor.attrib.get("href") or "").strip()
        name = _clean(anchor.text) or raw_href
        if not raw_href or raw_href in seen:
            continue
        seen.add(raw_href)
        absolute = urljoin(url, raw_href) if not raw_href.lower().startswith("javascript:") else None
        if absolute and urlparse(absolute).scheme not in ("http", "https"):
            absolute = None
        results.append(
            {
                "name": name,
                "url": absolute,
                "raw_href": raw_href,
                "size_label": None,
                "mime_type": _mime_for(raw_href) or _mime_for(name),
                "sort_order": len(results),
            }
        )
    return results


def _contact(page, selector=None):
    if selector:
        # Evaluate the selector once (each `_select` call writes to the adaptive store), and keep
        # the matched element so the mailto:/tel: anchor extraction below runs on this path too.
        selected = _select(page, selector)
        element = selected.first if selected else None
        text = _element_text(element)
    else:
        text, element = _label_value(page, _LABELS["contact"])
    if not text:
        return None, None, None
    email = None
    phone = None
    if element is not None:
        mail = element.css("a[href^='mailto:']")
        if mail:
            email = mail[0].attrib["href"][len("mailto:"):].strip() or None
        tel = element.css("a[href^='tel:']")
        if tel:
            phone = tel[0].attrib["href"][len("tel:"):].strip() or None
    email = email or (_EMAIL_RE.search(text).group(0) if _EMAIL_RE.search(text) else None)
    phone = phone or (_PHONE_RE.search(text).group(0) if _PHONE_RE.search(text) else None)
    name = text
    for token in filter(None, (email, phone)):
        name = name.replace(token, "")
    name = _clean_contact_name(name)
    return name, email, phone


_CONTACT_LEAD_RE = re.compile(
    r"^(?:contact(?: information| info| person)?|buyer|procurement officer|point of contact)\s*[:\-–]?\s*",
    re.I,
)
_CONTACT_TRAIL_RE = re.compile(r"\s*(?:\bat\b|[:\-–,(]|\bphone\b|\bemail\b)+\s*$", re.I)


def _clean_contact_name(text):
    """Turn label-adjacent contact text ("Contact Amanda Olinger at (217) …") into a bare name.

    Strips the leading label word and the trailing connector left behind once the phone/email
    tokens were removed. Returns None when nothing name-like remains or the remainder is a long
    paragraph rather than a name."""
    name = _clean(text)
    if not name:
        return None
    name = _CONTACT_LEAD_RE.sub("", name)
    name = _CONTACT_TRAIL_RE.sub("", name)
    name = _clean(name)
    if not name or len(name) > 120:
        return None
    return name


def extract(html, url, fields, selectors=None, storage_dir=None):
    """Extract `fields` from `html`.

    `storage_dir` is the directory Scrapling's adaptive-selector SQLite store is written to; when
    it is None the store falls back to scrapling's own default inside site-packages.
    """
    unknown = [field for field in fields if field not in SUPPORTED_FIELDS]
    if unknown:
        raise ExtractError(f"unsupported fields: {unknown}")
    selectors = selectors or {}
    storage_args = (
        {"storage_file": os.path.join(storage_dir, STORAGE_FILE_NAME), "url": url}
        if storage_dir
        else None
    )
    page = Selector(html, url=url, adaptive=True, storage_args=storage_args)
    out = {
        "description": None, "full_description": None, "original_category": None,
        "contact_name": None, "contact_email": None, "contact_phone": None, "published_date": None,
    }
    attachments = []
    diagnostics = {}

    for field in fields:
        selector = selectors.get(field)
        if field == "attachments":
            attachments = _attachments(page, url, selector)
            # "selector"/"heuristic" only when the strategy actually produced a value.
            diagnostics[field] = ("selector" if selector else "heuristic") if attachments else "not_found"
            continue
        if field == "contact":
            name, email, phone = _contact(page, selector)
            out["contact_name"], out["contact_email"], out["contact_phone"] = name, email, phone
            found = bool(name or email or phone)
            diagnostics[field] = ("selector" if selector else "heuristic") if found else "not_found"
            continue

        value = None
        if selector:
            selected = _select(page, selector)
            value = _element_text(selected.first) if selected else None
            diagnostics[field] = "selector" if value else "not_found"
        else:
            value, _ = _label_value(page, _LABELS[field])
            if value is None and field == "description":
                value = _largest_text_block(page)
            diagnostics[field] = "heuristic" if value else "not_found"

        if field == "description":
            out["description"] = value
            out["full_description"] = value
        elif field == "category":
            out["original_category"] = value
        elif field == "published_date":
            out["published_date"] = value

    return {"fields": out, "attachments": attachments, "diagnostics": diagnostics}
