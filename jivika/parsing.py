"""Resume file parsing: pypdf by default, Docling (layout-aware, DOCX and image OCR) when available.

JIVIKA_PARSER=auto (default: Docling when importable or JIVIKA_DOCLING_URL is set) | pypdf | docling.
JIVIKA_DOCLING_URL points at a docling-serve instance (POST /v1/convert/file) instead of a local import.
Docling's layout (tables, pictures, columns, page headers and footers, section headings) feeds ResumeMeta.
"""

import importlib.util
import io
import json
import logging
import os
import uuid
import urllib.request

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from jivika import ats

log = logging.getLogger("jivika.parsing")

DOCLING_NEEDED = "This file type needs the Docling parser. Upload a PDF instead."
DOCLING_TIMEOUT = 120
DOCLING_MAX_RESPONSE = 20 * 1024 * 1024
MIME = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
HEADING_LABELS = ("title", "section_header")
BODY_LABELS = ("text", "list_item", "section_header", "paragraph", "title")


class ParseError(Exception):
    """Shown to users; status is the HTTP status the API answers with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def docling_available() -> bool:
    mode = os.getenv("JIVIKA_PARSER", "auto").strip().lower()
    if mode == "pypdf":
        return False
    available = bool(os.getenv("JIVIKA_DOCLING_URL", "").strip()) or importlib.util.find_spec("docling") is not None
    if mode == "docling" and not available:
        log.warning("JIVIKA_PARSER=docling but Docling is not installed and JIVIKA_DOCLING_URL is unset; using pypdf")
    return available


def info() -> dict:
    docling = docling_available()
    return {"parser": "docling" if docling else "pypdf", "docling": docling,
            "accepts": [".pdf", ".docx", ".png", ".jpg", ".jpeg"] if docling else [".pdf"]}


def file_kind(data: bytes, filename: str, content_type: str) -> str | None:
    if data.startswith(b"%PDF"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"PK\x03\x04") and (filename.lower().endswith(".docx") or "wordprocessingml" in content_type):
        return "docx"
    return None


def parse(data: bytes, filename: str, content_type: str) -> dict:
    """{text, pages, characters, meta, parser}; meta is ResumeMeta-shaped. Raises ParseError."""
    content_type = (content_type or "").lower()
    kind = file_kind(data, filename, content_type)
    docling = docling_available()
    if kind is None:
        if docling:
            raise ParseError("Upload a PDF, DOCX, PNG or JPG file.", 415)
        if content_type not in ("", "application/octet-stream") and not content_type.endswith("/pdf"):
            raise ParseError("Please upload a PDF file.", 415)
        raise ParseError("The file is not a valid PDF.")
    if kind != "pdf" and not docling:
        raise ParseError(DOCLING_NEEDED, 415)
    if docling:
        try:
            text, doc = _docling(data, filename or f"resume.{kind}", kind)
            if text.strip() or kind != "pdf":
                return _result(text, docling_meta(doc, text), "docling")
        except ParseError:
            if kind != "pdf":
                raise
        except Exception as exc:  # a Docling failure should not cost the user the basic path
            log.warning("Docling conversion failed: %s", type(exc).__name__)
            if kind != "pdf":
                raise ParseError("The file could not be read.") from None
    text, meta = pdf_text(data)
    return _result(text, {**meta, "layout_source": "pypdf"}, "pypdf")


def _result(text: str, meta: dict, parser: str) -> dict:
    return {"text": text, "pages": meta.get("pages", 0), "characters": len(text), "meta": meta, "parser": parser}


def pdf_text(data: bytes) -> tuple[str, dict]:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise ParseError("Password-protected PDFs are not supported.")
        return ats.pdf_text_and_meta(reader)
    except (PdfReadError, ValueError, KeyError, TypeError, AttributeError):
        raise ParseError("The PDF could not be read.") from None


# ---------------------------------------------------------------------------
# Docling (local import or docling-serve)
# ---------------------------------------------------------------------------

_converter = None


def _docling(data: bytes, filename: str, kind: str) -> tuple[str, dict]:
    """(plain text, DoclingDocument as a dict)."""
    if url := os.getenv("JIVIKA_DOCLING_URL", "").strip():
        return _docling_serve(url, data, filename, kind)
    global _converter
    from docling.datamodel.base_models import DocumentStream
    from docling.document_converter import DocumentConverter

    if _converter is None:
        _converter = DocumentConverter()  # loads layout models once per process
    document = _converter.convert(DocumentStream(name=filename, stream=io.BytesIO(data))).document
    text = document.export_to_text() if hasattr(document, "export_to_text") else document.export_to_markdown()
    return text, document.export_to_dict()


def _docling_serve(url: str, data: bytes, filename: str, kind: str) -> tuple[str, dict]:
    boundary = uuid.uuid4().hex
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._-")[:100] or f"resume.{kind}"
    fields = [("to_formats", "json"), ("to_formats", "text"), ("image_export_mode", "placeholder")]
    body = b"".join(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode() for k, v in fields)
    body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{safe_name}\"\r\n"
             f"Content-Type: {MIME[kind]}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(f"{url.rstrip('/')}/v1/convert/file", data=body, headers={
        "Content-Type": f"multipart/form-data; boundary={boundary}", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=DOCLING_TIMEOUT) as response:
            raw = response.read(DOCLING_MAX_RESPONSE + 1)
    except OSError as exc:
        raise ParseError("The document parser is unavailable right now.", 502) from exc
    if len(raw) > DOCLING_MAX_RESPONSE:
        raise ParseError("The document parser returned too much data.", 502)
    try:
        reply = json.loads(raw)
        document = reply["document"]
    except (ValueError, KeyError, TypeError):
        raise ParseError("The document parser returned an invalid response.", 502) from None
    if reply.get("status") not in ("success", "partial_success"):
        raise ParseError("The file could not be read.")
    doc = document.get("json_content") or {}
    if isinstance(doc, str):
        doc = json.loads(doc)
    return str(document.get("text_content") or document.get("md_content") or ""), doc if isinstance(doc, dict) else {}


def _label(item: dict) -> str:
    return str(item.get("label") or "").lower()


def _box(item: dict) -> tuple[int, dict] | None:
    prov = item.get("prov") or []
    if not prov or not isinstance(prov[0], dict) or not isinstance(prov[0].get("bbox"), dict):
        return None
    return int(prov[0].get("page_no") or 1), prov[0]["bbox"]


def _columns(texts: list[dict], pages: dict) -> bool:
    """Two columns: on some page, at least 3 narrow body blocks sit wholly in each half and the halves overlap vertically."""
    by_page: dict[int, list[dict]] = {}
    for item in texts:
        if _label(item) in BODY_LABELS and (found := _box(item)):
            by_page.setdefault(found[0], []).append(found[1])
    for page_no, boxes in list(by_page.items())[: ats.LAYOUT_PAGES]:
        size = (pages.get(str(page_no)) or pages.get(page_no) or {}).get("size") or {}
        width = float(size.get("width") or 0) or max((float(b.get("r", 0)) for b in boxes), default=0)
        if width <= 0:
            continue
        mid = width / 2
        left = [b for b in boxes if float(b.get("r", 0)) <= mid * 1.05 and float(b.get("r", 0)) - float(b.get("l", 0)) < 0.5 * width]
        right = [b for b in boxes if float(b.get("l", 0)) >= mid * 0.95]
        if len(left) >= 3 and len(right) >= 3:
            span = lambda bs: (min(min(float(b["t"]), float(b["b"])) for b in bs), max(max(float(b["t"]), float(b["b"])) for b in bs))  # noqa: E731
            (l_lo, l_hi), (r_lo, r_hi) = span(left), span(right)
            if min(l_hi, r_hi) > max(l_lo, r_lo):
                return True
    return False


def docling_meta(doc: dict, text: str) -> dict:
    texts = [t for t in doc.get("texts") or [] if isinstance(t, dict)]
    pages = doc.get("pages") if isinstance(doc.get("pages"), dict) else {}
    page_count = len(pages) or 1
    tables, pictures = len(doc.get("tables") or []), len(doc.get("pictures") or [])
    headings = [" ".join(str(t.get("text") or "").split())[:200] for t in texts if _label(t) in HEADING_LABELS]
    try:
        columns = _columns(texts, pages)
    except (TypeError, ValueError, KeyError):
        columns = False
    return {
        "pages": page_count,
        "images": pictures,
        "fonts": 0,
        "has_text_layer": bool(text.strip()),
        "avg_chars_per_page": round(len(text) / page_count),
        "suspected_columns": columns,
        "suspected_tables": tables > 0,
        "tables": tables,
        "pictures": pictures,
        "section_headings": [h for h in headings if h][:60],
        "headers_footers": any(_label(t) in ("page_header", "page_footer") for t in texts),
        "layout_source": "docling",
    }
