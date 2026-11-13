"""Validate in-memory uploads and preserve the text's original page numbers."""
from dataclasses import dataclass
from hashlib import sha256
from pathlib import PurePosixPath
import unicodedata

import pymupdf


class DocumentError(ValueError):
    """An upload cannot be processed; safe to display without private content."""


@dataclass(frozen=True)
class Page:
    text: str
    page_number: int | None  # TXT/Markdown have no reliable page boundaries.


@dataclass(frozen=True)
class Document:
    document_id: str
    filename: str
    pages: tuple[Page, ...]
    warnings: tuple[str, ...]
    byte_size: int


def _filename(filename: str) -> str:
    if not isinstance(filename, str):
        raise DocumentError("Provide a file with a valid name.")
    # Names are display metadata, never filesystem paths. Handle both OS styles.
    name = filename.replace("\\", "/").split("/")[-1].strip()
    if (not name or len(name) > 200
            or any(unicodedata.category(c).startswith("C") for c in name)):
        raise DocumentError("Use a filename of 1–200 characters without control characters.")
    if PurePosixPath(name).suffix.lower() not in {".pdf", ".txt", ".md"}:
        raise DocumentError("Unsupported file type. Upload a PDF, TXT, or Markdown (.md) file.")
    return name


def _normalize(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _has_text(text: str) -> bool:
    # Invisible formatting alone should not count as study material.
    return any(not c.isspace() and not unicodedata.category(c).startswith("C") for c in text)


def _text_pages(content: bytes) -> tuple[Page, ...]:
    if content.lstrip().startswith((b"%PDF-", b"PK\x03\x04", b"\x89PNG", b"GIF87a", b"GIF89a", b"\xff\xd8")):
        raise DocumentError("The file contents do not match a text document. Use the original file type.")
    try:
        text = _normalize(content.decode("utf-8-sig"))
    except UnicodeDecodeError:
        raise DocumentError("Text files must use UTF-8 encoding. Re-save this file as UTF-8.") from None
    if any(unicodedata.category(c) == "Cc" and c not in "\n\t\f" for c in text):
        raise DocumentError("The text file contains binary or unsupported control characters.")
    if not _has_text(text):
        raise DocumentError("The document is empty or contains only whitespace/invisible characters.")
    return (Page(text, None),)


def _pdf_pages(content: bytes, max_pages: int, max_characters: int) -> tuple[tuple[Page, ...], tuple[str, ...]]:
    if not content.startswith(b"%PDF-"):
        raise DocumentError("The file does not have a PDF header. Export it as a PDF and try again.")
    pages = []
    blank_pages = 0
    characters = 0
    try:
        with pymupdf.open(stream=content, filetype="pdf") as pdf:
            if pdf.needs_pass or pdf.is_encrypted or (pdf.metadata or {}).get("encryption"):
                raise DocumentError("Encrypted PDFs are not supported. Upload an unlocked copy you can access.")
            if pdf.is_repaired:
                raise DocumentError("The PDF is damaged and required repair. Re-export it before uploading.")
            if pdf.page_count > max_pages:
                raise DocumentError(f"PDF exceeds the {max_pages}-page limit. Split it into smaller files.")
            for number, page in enumerate(pdf, start=1):
                text = _normalize(page.get_text("text", sort=True))
                characters += len(text)
                if characters > max_characters:
                    raise DocumentError(f"Extracted text exceeds the {max_characters:,}-character limit.")
                if not _has_text(text):
                    blank_pages += 1
                pages.append(Page(text, number))
    except DocumentError:
        raise
    except (RuntimeError, ValueError, OSError, pymupdf.mupdf.FzErrorBase):
        # Parser diagnostics can include private paths or content. Do not echo them.
        raise DocumentError("The PDF could not be read. It may be corrupted; re-export it and try again.") from None
    if not pages or blank_pages == len(pages):
        raise DocumentError("No readable text was found. Scanned/image-only PDFs need OCR first; blank PDFs cannot be used.")
    warnings = ()
    if blank_pages:
        warnings = (f"{blank_pages} page(s) contain no readable text and will not produce chunks. OCR is not included.",)
    return tuple(pages), warnings


def load_document(filename: str, content: bytes, *, max_bytes: int = 10 * 1024 * 1024,
                  max_pages: int = 300, max_characters: int = 1_000_000) -> Document:
    """Validate actual bytes, extract locally, and return immutable metadata.

    Limits bound accepted output; they do not sandbox the native PDF parser or
    impose a hard CPU/memory limit while a single PDF page is being decoded.
    """
    for value in (max_bytes, max_pages, max_characters):
        if type(value) is not int or value < 1:
            raise ValueError("Document limits must be positive integers.")
    name = _filename(filename)
    if not isinstance(content, bytes):
        raise DocumentError("Upload content must be bytes.")
    if not content:
        raise DocumentError("The uploaded file is empty (zero bytes).")
    if len(content) > max_bytes:
        raise DocumentError(f"File exceeds the {max_bytes:,}-byte upload limit.")
    warnings = ()
    if PurePosixPath(name).suffix.lower() == ".pdf":
        pages, warnings = _pdf_pages(content, max_pages, max_characters)
    else:
        pages = _text_pages(content)
        if len(pages[0].text) > max_characters:
            raise DocumentError(f"Extracted text exceeds the {max_characters:,}-character limit.")
    return Document(sha256(content).hexdigest(), name, pages, warnings, len(content))
