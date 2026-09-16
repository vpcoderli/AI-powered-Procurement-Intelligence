"""Pure link matching over a minimal element model.

`downloader.py` scrapes the page once into `LinkElement`s and hands them here, so the C2 resolution
order — selector → href_contains → text — is testable without starting a browser.
"""

from dataclasses import dataclass

# Elements the sidecar is willing to click. Anything else (inputs, links inside a login form) is
# never a download control on the portals this serves.
CLICKABLE_TAGS = ("a", "button")


@dataclass(frozen=True)
class LinkElement:
    index: int
    tag: str = "a"
    href: str = ""
    onclick: str = ""
    text: str = ""


def normalize_text(value):
    """Collapse whitespace (incl. &nbsp;) the way portals render link labels."""
    if not isinstance(value, str):
        return ""
    return " ".join(value.replace("\xa0", " ").split())


def _haystack(element):
    return f"{element.href or ''} {element.onclick or ''}".lower()


def _token_bounded(haystack, needle):
    """True when `needle` occurs delimited by non-alphanumerics: `1` must not match `1812427`."""
    start = 0
    while True:
        index = haystack.find(needle, start)
        if index < 0:
            return False
        before = haystack[index - 1] if index > 0 else ""
        after = haystack[index + len(needle)] if index + len(needle) < len(haystack) else ""
        if not before.isalnum() and not after.isalnum():
            return True
        start = index + 1


def find_by_href_contains(elements, needle, text=None):
    """Anchor whose href/onclick carries `needle` as a whole token.

    Several controls can carry the same token (a preview and a download link, or a portal
    that repeats an id). Disambiguate by the attachment's label; an unresolved ambiguity
    returns None so the caller reports LINK_NOT_FOUND instead of downloading the wrong file.
    """
    needle = (needle or "").strip().lower()
    if not needle:
        return None
    matches = [element for element in elements if _token_bounded(_haystack(element), needle)]
    if len(matches) == 1:
        return matches[0]
    if not matches:
        return None
    labelled = find_by_text(matches, text)
    if labelled is not None:
        return labelled
    return None


def find_by_text(elements, text):
    """Exact match on the normalized label — a substring match would grab the wrong attachment."""
    target = normalize_text(text).casefold()
    if not target:
        return None
    for element in elements:
        if normalize_text(element.text).casefold() == target:
            return element
    return None


def resolve_link(elements, link, selector_matches=()):
    """First match in C2 order, or None.

    `selector_matches` is supplied by the caller because CSS/XPath evaluation needs the live DOM;
    everything else is decided here.
    """
    for match in selector_matches or ():
        return match
    return find_by_href_contains(elements, link.href_contains, link.text) or find_by_text(elements, link.text)


def describe_link(link):
    """Render the request's link spec for an error message (spec only — never page content)."""
    parts = [
        f"{field}={value!r}"
        for field, value in (
            ("selector", link.selector),
            ("href_contains", link.href_contains),
            ("text", link.text),
        )
        if value
    ]
    return ", ".join(parts) or "<empty>"
