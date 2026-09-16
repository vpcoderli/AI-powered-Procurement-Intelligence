"""Magic-byte content sniffing for archived attachments.

A portal that answers a download URL with a session-error or login page returns HTTP 200 and
an HTML body — sometimes even under an `application/pdf` header. Trusting the response header
is exactly how an 83 KB "ERROR IN … session" page ended up on disk named `Solicitation.pdf`.
Everything the archiver writes therefore goes through `sniff_bytes` first; the sniffed type
wins over the header whenever the magic bytes are recognized.

stdlib only (`zipfile` is used to tell docx/xlsx/pptx apart from a plain zip).
"""

import io
import zipfile


PDF_MAGIC = b"%PDF"
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
UTF8_BOM = b"\xef\xbb\xbf"

DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

CONTENT_TYPE_EXTENSIONS = {
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.ms-powerpoint": ".ppt",
    DOCX_TYPE: ".docx",
    XLSX_TYPE: ".xlsx",
    PPTX_TYPE: ".pptx",
    "text/html": ".html",
    "text/plain": ".txt",
    "text/csv": ".csv",
}

# Only the first bytes matter for every rule below; HTML detection tolerates leading
# whitespace and a UTF-8 BOM but nothing else, so a document that merely mentions "<html>"
# in its body is not mistaken for a web page.
_HTML_PREFIXES = ("<!doctype html", "<html", "<!doctype>", "<head", "<?xml-stylesheet")
_HTML_SNIFF_WINDOW = 512


def clean_content_type(value):
    """`text/html; charset=utf-8` -> `text/html`; None/blank -> ''."""
    return (value or "").split(";")[0].strip().lower()


def is_html_bytes(data):
    """True when `data` starts an HTML document (leading whitespace/BOM tolerated)."""
    if not data:
        return False
    head = data[:_HTML_SNIFF_WINDOW]
    if head.startswith(UTF8_BOM):
        head = head[len(UTF8_BOM):]
    text = head.decode("utf-8", errors="ignore").lstrip().lower()
    return any(text.startswith(prefix) for prefix in _HTML_PREFIXES)


def is_html(content_type, data):
    """HTML by declared type OR by magic bytes — either one disqualifies a download."""
    return clean_content_type(content_type) == "text/html" or is_html_bytes(data)


def _ooxml_type(data):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = set(archive.namelist())
            payload = ""
            if "[Content_Types].xml" in names:
                payload = archive.read("[Content_Types].xml").decode("utf-8", errors="ignore")
    except (zipfile.BadZipFile, KeyError, OSError, RuntimeError, ValueError):
        # A truncated or encrypted OOXML container is still a zip as far as we are concerned.
        return "application/zip"

    for marker, content_type in (
        ("wordprocessingml.document", DOCX_TYPE),
        ("spreadsheetml.sheet", XLSX_TYPE),
        ("presentationml.presentation", PPTX_TYPE),
    ):
        if marker in payload:
            return content_type
    for prefix, content_type in (("word/", DOCX_TYPE), ("xl/", XLSX_TYPE), ("ppt/", PPTX_TYPE)):
        if any(name.startswith(prefix) for name in names):
            return content_type
    return "application/zip"


def _looks_like_text(data):
    sample = data[:4096]
    if b"\x00" in sample:
        return False
    try:
        sample.decode("utf-8")
    except UnicodeDecodeError:
        return False
    printable = sum(1 for byte in sample if byte >= 0x20 or byte in (0x09, 0x0A, 0x0D))
    return bool(sample) and printable / float(len(sample)) > 0.95


def sniff_bytes(data, header_content_type=None):
    """Return the content type the bytes actually are, or None when unrecognized.

    The header is consulted only to disambiguate inside a recognized family (an OLE compound
    file is `.doc` or `.xls`; plain text is `.txt` or `.csv`) — never to override the magic.
    """
    if not data:
        return None
    header = clean_content_type(header_content_type)
    if is_html_bytes(data):
        return "text/html"
    if data.startswith(PDF_MAGIC):
        return "application/pdf"
    if data.startswith(ZIP_MAGIC):
        return _ooxml_type(data)
    if data.startswith(OLE_MAGIC):
        if header in ("application/vnd.ms-excel", "application/excel"):
            return "application/vnd.ms-excel"
        if header == "application/vnd.ms-powerpoint":
            return "application/vnd.ms-powerpoint"
        return "application/msword"
    if _looks_like_text(data):
        return "text/csv" if header in ("text/csv", "application/csv") else "text/plain"
    return None


def extension_for_content_type(content_type):
    """Canonical extension for a sniffed type, or None when the type is not in the table."""
    return CONTENT_TYPE_EXTENSIONS.get(clean_content_type(content_type))
