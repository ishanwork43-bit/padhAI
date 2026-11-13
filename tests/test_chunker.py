"""Check chunk boundaries, reproducibility, and citation metadata."""
import pymupdf
import pytest

from src.chunker import chunk_document
from src.document_loader import load_document


def test_overlap_preserves_exact_source_offsets():
    document = load_document('notes.txt', b'abcdefghij')
    chunks = chunk_document(document, chunk_size=4, overlap=1)
    assert [(chunk.start_char, chunk.end_char) for chunk in chunks] == [(0, 4), (3, 7), (6, 10)]
    assert [chunk.text for chunk in chunks] == ['abcd', 'defg', 'ghij']
    for chunk in chunks:
        assert chunk.text == document.pages[0].text[chunk.start_char:chunk.end_char]
        assert chunk.document_id == document.document_id
        assert chunk.filename == 'notes.txt'
        assert chunk.page_number is None


@pytest.mark.parametrize('text', ['a', 'abcd', 'abcde', 'a' * 20, 'पढ़ाई is fun'])
def test_all_non_whitespace_characters_are_covered(text):
    document = load_document('notes.txt', text.encode())
    chunks = chunk_document(document, chunk_size=4, overlap=1)
    covered = {index for chunk in chunks for index in range(chunk.start_char, chunk.end_char)}
    assert {i for i, char in enumerate(text) if not char.isspace()} <= covered
    assert all(0 < len(chunk.text) <= 4 for chunk in chunks)
    assert len({chunk.chunk_id for chunk in chunks}) == len(chunks)


def test_zero_overlap_and_no_redundant_tail():
    document = load_document('notes.txt', b'abcdefgh')
    chunks = chunk_document(document, chunk_size=4, overlap=0)
    assert [chunk.text for chunk in chunks] == ['abcd', 'efgh']


def test_whitespace_only_chunks_are_skipped():
    document = load_document('notes.txt', b'word        tail')
    chunks = chunk_document(document, chunk_size=4, overlap=0)
    assert [chunk.text for chunk in chunks] == ['word', 'tail']
    assert [(chunk.start_char, chunk.end_char) for chunk in chunks] == [(0, 4), (12, 16)]


def test_chunk_ids_are_stable_and_distinguish_different_settings():
    document = load_document('notes.txt', b'abcdefghij')
    first = chunk_document(document, chunk_size=4, overlap=1)
    repeated = chunk_document(document, chunk_size=4, overlap=1)
    alternate = chunk_document(document, chunk_size=4, overlap=0)
    assert first == repeated
    assert first[0].chunk_id != alternate[0].chunk_id


def test_pdf_chunks_keep_page_numbers_and_do_not_cross_pages():
    with pymupdf.open() as pdf:
        for text in ['Same words', '', 'Same words']:
            page = pdf.new_page()
            if text:
                page.insert_text((72, 72), text)
        content = pdf.tobytes()
    document = load_document('book.pdf', content)
    chunks = chunk_document(document, chunk_size=100, overlap=10)
    assert [chunk.page_number for chunk in chunks] == [1, 3]
    assert len({chunk.chunk_id for chunk in chunks}) == 2
    for chunk in chunks:
        page = document.pages[chunk.page_number - 1]
        assert chunk.text == page.text[chunk.start_char:chunk.end_char]
        assert chunk.filename == 'book.pdf'


@pytest.mark.parametrize('chunk_size,overlap', [(0, 0), (-1, 0), (2, -1), (2, 2), (2, 3),
                                               (True, 0), (2, False), (2.5, 0), (2, 0.5), ('2', 0)])
def test_invalid_parameters_fail_before_chunking(chunk_size, overlap):
    document = load_document('notes.txt', b'Valid text')
    with pytest.raises((ValueError, TypeError)):
        chunk_document(document, chunk_size=chunk_size, overlap=overlap)
