"""Shared description comparisons and HTML quality checks at the list/detail boundary."""

import re
from html.parser import HTMLParser
from urllib.parse import unquote, urlparse


# Portals print the same sentence with and without a trailing period/colon ("Road repair" vs
# "Road repair."), so an echo comparison that only collapses whitespace and case still lets a
# title copy through as a description/full body. Edge punctuation is stripped for IDENTITY
# comparisons only — lengths and body checks keep using the full text.
_EDGE_PUNCTUATION = " \t\r\n.,:;!?-–—_*/'\"()[]{}。，、：；！？"


def comparable_text(value):
    return " ".join(value.split()).casefold() if isinstance(value, str) else ""


def echo_key(value):
    return comparable_text(value).strip(_EDGE_PUNCTUATION)


def same_text(left, right):
    return echo_key(left) == echo_key(right)


def useful_text(value, title):
    text = echo_key(value)
    return bool(text) and text != echo_key(title)


def is_body(value, title):
    text = comparable_text(value)
    return useful_text(value, title) and len(text) >= 150 and (
        "." in text or "。" in text or len(text.split()) >= 25
    )


def has_full_body(bid):
    full = bid.get("full_description")
    description = bid.get("description")
    if not useful_text(full, bid.get("title")):
        return False
    return is_body(full, bid.get("title")) or (
        not same_text(full, description)
        and len(comparable_text(full)) > len(comparable_text(description))
    )


# Portals qualify the description label ("Solicitation Description", "Short Description",
# "Bulletin Desc"). An exact-match list of five strings made every such page look like a login
# wall as soon as it also carried a site-wide login widget, which disables enrichment for the
# whole source. Match the label word instead, with a length bound so a paragraph that merely
# contains the word is not mistaken for a label cell.
_DESCRIPTION_LABEL_RE = re.compile(
    r"^.{0,30}?\b(?:desc|description|scope of work|statement of work|summary)\b.{0,20}$"
)


class _DetailContentParser(HTMLParser):
    """Recognize login controls without treating page-wide WebForms as login pages."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = [{"tag": "document", "children": [], "text": [], "excluded": False}]
        self.nodes = []
        self.headings = []
        self.has_credentials = False
        self.login_action = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        login_form = tag == "form" and bool(re.search(
            r"/(?:login|signin|sign-in|auth)(?:/|$)",
            unquote(urlparse(attrs.get("action", "")).path).lower(),
        ))
        parent = self.stack[-1]
        node = {
            "tag": tag, "children": [], "text": [], "parent": parent,
            "excluded": parent["excluded"] or login_form or tag in ("script", "style", "nav", "header", "footer", "aside"),
        }
        parent["children"].append(node)
        self.nodes.append(node)
        if tag not in ("input", "br", "hr", "img", "meta", "link", "source", "wbr", "area", "base", "embed", "param", "track", "col"):
            self.stack.append(node)
        if tag == "input" and attrs.get("type", "").lower() in ("password", "email"):
            self.has_credentials = True
        if login_form:
            self.login_action = True

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index]["tag"] == tag:
                self.stack = self.stack[:index]
                break

    def handle_data(self, data):
        if any(node["tag"] in ("title", "h1", "h2") for node in self.stack):
            self.headings.append(data)
        if not self.stack[-1]["excluded"]:
            for node in self.stack:
                node["text"].append(data)

    def has_public_description(self):
        """Require a label/value or prose body outside login controls and instructions."""
        login_instructions = re.compile(r"\b(?:log\s*in|sign\s*in|create an account)\b")
        for node in self.nodes:
            text = comparable_text(" ".join(node["text"]))
            if not node["excluded"] and node["tag"] in ("p", "article", "main") and is_body(text, "") and not login_instructions.search(text):
                return True
            if node["excluded"] or node["tag"] not in ("td", "th", "dt", "label", "h2", "h3", "span", "strong", "b"):
                continue
            if not _DESCRIPTION_LABEL_RE.search(text.rstrip(": ")):
                continue
            # Portals put the label directly in a td/dt or wrap it in a span/b element.
            for label_node in (node, node["parent"]):
                parent = label_node.get("parent")
                if not parent:
                    continue
                siblings = parent["children"]
                index = next(index for index, sibling in enumerate(siblings) if sibling is label_node)
                if index + 1 >= len(siblings):
                    continue
                value = siblings[index + 1]
                text = comparable_text(" ".join(value["text"]))
                if not value["excluded"] and len(text) >= 15 and not login_instructions.search(text):
                    return True
        return False


def is_login_html(html):
    parser = _DetailContentParser()
    parser.feed(html)
    headings = comparable_text(" ".join(parser.headings))
    login_heading = bool(re.search(r"\b(?:log\s*in|sign\s*in|authenticate)\b", headings))
    return parser.has_credentials and (login_heading or parser.login_action) and not parser.has_public_description()


# --- verified empty list (contract C1) ----------------------------------------------------

# The exact phrase set from the C1 contract. Kept narrow on purpose: every phrase here is an
# explicit statement that the list is empty, never a generic "nothing to show" chrome string.
_EMPTY_LIST_RE = re.compile(
    r"no open bids"
    r"|no open solicitations"
    r"|no solicitations (?:are )?(?:currently )?available"
    r"|no results found"
    r"|there are currently no",
    re.I,
)

# Words that appear in nearly every source label and therefore prove nothing about WHICH
# tenant page we are looking at. Two-letter state codes are dropped by the length bound.
_LABEL_STOP_WORDS = frozenset(
    (
        "county", "counties", "city", "cities", "state", "states", "town", "township", "village",
        "borough", "parish", "district", "region", "regional", "municipal", "municipality",
        "bidnet", "direct", "bonfire", "portal", "public", "government", "govt", "agency",
        "procurement", "purchasing", "solicitations", "solicitation", "opportunities",
        "opportunity", "bids", "bid", "rfp", "rfps", "rfq", "open", "the", "and", "for", "usa",
    )
)

_LABEL_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'’-]*")


class _VisibleTextParser(HTMLParser):
    """Page copy a human would read: everything outside script/style, plus the <title>.

    Block-level tags emit a newline so an empty-state sentence can be bounded by the element
    that holds it. Without that, the "marker" we report drifts into whatever navigation label
    happened to precede it in the markup.
    """

    _SKIPPED = ("script", "style", "noscript", "template")
    _BLOCKS = (
        "p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "thead", "tbody", "br", "hr",
        "section", "article", "aside", "nav", "header", "footer", "main", "form", "label",
        "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd", "dl", "option", "button", "figcaption",
    )

    _VOID = ("br", "hr", "img", "input", "meta", "link", "source", "wbr", "area", "base", "col", "embed", "param", "track")

    def __init__(self):
        HTMLParser.__init__(self, convert_charrefs=True)
        self.title_parts = []
        self.text_parts = []
        self._skip_depth = 0
        self._in_title = False
        # Elements the browser would not show. Portal templates keep every state's copy in the
        # DOM (BidNet renders an aria-hidden "There are no open bids" row above 16 real rows,
        # verified 2026-09-16), so hidden text must never count as what the page "says".
        self._hidden_stack = []

    @staticmethod
    def _is_hidden(attrs):
        for name, value in attrs:
            lowered = (value or "").replace(" ", "").lower()
            if name == "aria-hidden" and lowered == "true":
                return True
            if name == "hidden":
                return True
            if name == "style" and ("display:none" in lowered or "visibility:hidden" in lowered):
                return True
        return False

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIPPED:
            self._skip_depth += 1
            return
        if tag == "title":
            self._in_title = True
            return
        if tag not in self._VOID and self._is_hidden(attrs):
            self._hidden_stack.append(tag)
        if tag in self._BLOCKS:
            self.text_parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag in self._BLOCKS:
            self.text_parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIPPED:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag == "title":
            self._in_title = False
        else:
            if self._hidden_stack and self._hidden_stack[-1] == tag:
                self._hidden_stack.pop()
            if tag in self._BLOCKS:
                self.text_parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth or self._hidden_stack:
            return
        if self._in_title:
            self.title_parts.append(data)
        else:
            self.text_parts.append(data)


def label_tokens(label):
    """Distinctive words of a source label, longest first ("Erie County, NY (BidNet)" -> ["Erie"])."""
    tokens = []
    seen = set()
    for token in _LABEL_TOKEN_RE.findall(label or ""):
        lowered = token.casefold()
        if len(token) < 3 or lowered in _LABEL_STOP_WORDS or lowered in seen:
            continue
        seen.add(lowered)
        tokens.append(token)
    tokens.sort(key=len, reverse=True)
    return tokens


def _sentence_around(text, start, end):
    """The sentence (or block) of `text` that holds the match at [start, end)."""
    left = 0
    for terminator in ".!?\n":
        index = text.rfind(terminator, 0, start)
        if index + 1 > left:
            left = index + 1
    right = len(text)
    for terminator in ".!?":
        index = text.find(terminator, end)
        if index != -1 and index + 1 < right:
            right = index + 1
    newline = text.find("\n", end)
    if newline != -1 and newline < right:
        right = newline
    return text[left:right].strip()[:200]


def tenant_is_confirmed(title, body_text, label):
    """True when a distinctive label token appears in the page title or its visible copy."""
    haystack = "{0} {1}".format(title or "", body_text or "").casefold()
    for token in label_tokens(label):
        if re.search(r"\b{0}\b".format(re.escape(token.casefold())), haystack):
            return True
    return False


def detect_empty_list(html, label):
    """Contract C1: `{"detected", "marker", "tenant_confirmed"}` for a fetched list page.

    `detected` needs an explicit empty-list phrase in the page's visible copy — never in a
    script body, where portals keep i18n strings for every state the page can be in.
    `tenant_confirmed` is the separate, stricter question the caller must also answer yes to
    before a zero-row run may be called a success.
    """
    parser = _VisibleTextParser()
    try:
        parser.feed(html or "")
    except Exception:  # noqa: BLE001 - malformed markup must never crash a run
        pass
    title = normalize_space_text(" ".join(parser.title_parts))
    body = _normalize_block_text("".join(parser.text_parts))

    match = _EMPTY_LIST_RE.search(body)
    if not match:
        return {"detected": False, "marker": None, "tenant_confirmed": False}

    return {
        "detected": True,
        "marker": _sentence_around(body, match.start(), match.end()),
        "tenant_confirmed": tenant_is_confirmed(title, body, label),
    }


def normalize_space_text(value):
    return " ".join((value or "").replace("\xa0", " ").split())


def _normalize_block_text(value):
    """Collapse horizontal whitespace but keep the block boundaries as single newlines."""
    text = (value or "").replace("\xa0", " ").replace("\r", "\n")
    text = re.sub(r"[^\S\n]+", " ", text)
    return re.sub(r" *\n[\s\n]*", "\n", text).strip()
