"""Split each page into deterministic character windows with source offsets."""
from dataclasses import dataclass
from hashlib import sha256

from src.document_loader import Document, _has_text


@dataclass(frozen=True)
class Chunk:
    chunk_id: str
    document_id: str
    filename: str
    page_number: int | None
    text: str
    start_char: int
    end_char: int  # Exclusive, like Python slices.


def chunk_document(document: Document, *, chunk_size: int = 1000,
                   overlap: int = 150) -> tuple[Chunk, ...]:
    """Preserve page boundaries and exact offsets into normalized page text.

    Character windows are deliberately simple: they can split words. Phase 3
    should choose sizes appropriate to the embedding model's token limit.
    """
    if type(chunk_size) is not int or chunk_size < 1:
        raise ValueError("chunk_size must be a positive integer.")
    if type(overlap) is not int or not 0 <= overlap < chunk_size:
        raise ValueError("overlap must be an integer from 0 to chunk_size - 1.")
    chunks = []
    step = chunk_size - overlap
    for page_index, page in enumerate(document.pages):
        for start in range(0, len(page.text), step):
            end = min(start + chunk_size, len(page.text))
            text = page.text[start:end]
            if _has_text(text):
                # Include version/settings to avoid ID collisions after rechunking.
                identity = f"v1:{document.document_id}:{page_index}:{chunk_size}:{overlap}:{start}:{end}"
                chunks.append(Chunk(sha256(identity.encode()).hexdigest(), document.document_id,
                                    document.filename, page.page_number, text, start, end))
            # Do not emit a final redundant slice consisting entirely of overlap.
            if end == len(page.text):
                break
    return tuple(chunks)
