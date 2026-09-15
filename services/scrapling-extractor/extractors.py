"""Field extraction on top of Scrapling's parser (base package only — no fetchers)."""

import mimetypes
import re
from urllib.parse import urljoin, urlparse

from scrapling.parser import Selector

SUPPORTED_FIELDS = ("description", "attachments", "category", "contact", "published_date")

_LABELS = {
    "description": ("Description", "Summary", "Scope of Work", "Scope", "Details"),
    "category": ("Category", "Commodity", "NAICS", "UNSPSC", "Classification"),
    "contact": ("Contact", "Buyer", "Procurement Officer", "Point of Contact"),
    "published_date": ("Posted Date", "Published", "Publish Date", "Issue Date", "Post Date", "Posted"),
    "attachments": ("File Attachments", "Attachments", "Documents", "Bid Documents", "Files"),
}
_DOCUMENT_EXTENSIONS = (".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".csv", ".ppt", ".pptx", ".txt")
_NOISE_TAGS = ("nav", "header", "footer", "script", "style", "noscript")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_PHONE_RE = re.compile(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}")
_MAX_TEXT = 20_000


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
            anchors = [a for a in page.css("a[href]") if _mime_for(a.attrib.get("href", ""))]
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
        text = _element_text(_select(page, selector).first) if _select(page, selector) else None
        element = None
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
    name = _clean(name)
    return name, email, phone


def extract(html, url, fields, selectors=None):
    unknown = [field for field in fields if field not in SUPPORTED_FIELDS]
    if unknown:
        raise ExtractError(f"unsupported fields: {unknown}")
    selectors = selectors or {}
    page = Selector(html, url=url, adaptive=True)
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
            diagnostics[field] = "selector" if selector else ("heuristic" if attachments else "not_found")
            continue
        if field == "contact":
            name, email, phone = _contact(page, selector)
            out["contact_name"], out["contact_email"], out["contact_phone"] = name, email, phone
            diagnostics[field] = "selector" if selector else ("heuristic" if (name or email or phone) else "not_found")
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
