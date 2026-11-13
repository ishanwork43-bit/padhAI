"""Exercise untrusted file boundaries with small, generated fixtures."""
import hashlib
import re

import pymupdf
import pytest

from src.document_loader import DocumentError, load_document


def make_pdf(*page_texts, **save_options):
    with pymupdf.open() as pdf:
        for text in page_texts:
            page = pdf.new_page()
            if text:
                page.insert_text((72, 72), text)
        return pdf.tobytes(**save_options)


@pytest.mark.parametrize('filename', ['notes.txt', 'notes.TXT', 'notes.md', 'notes.MD'])
def test_unicode_text_and_markdown_preserve_metadata(filename):
    content = '\ufeff# Notes\r\nपढ़ाई और learning\rFinal line'.encode('utf-8')
    document = load_document(filename, content)
    assert document.filename == filename
    assert document.byte_size == len(content)
    assert document.document_id == hashlib.sha256(content).hexdigest()
    assert document.pages[0].page_number is None
    assert document.pages[0].text == '# Notes\nपढ़ाई और learning\nFinal line'
    assert len(document.pages) == 1


def test_identity_depends_on_content_not_filename():
    first = load_document('first.txt', b'Atomic values')
    renamed = load_document('second.txt', b'Atomic values')
    changed = load_document('first.txt', b'Changed content')
    assert first.document_id == renamed.document_id
    assert first.document_id != changed.document_id


@pytest.mark.parametrize('filename', ['../../notes.txt', r'C:\fakepath\notes.txt'])
def test_paths_are_reduced_to_display_basename(filename):
    assert load_document(filename, b'Valid text').filename == 'notes.txt'


@pytest.mark.parametrize('filename', ['notes.csv', 'notes', 'notes.pdf.exe', '.txt'])
def test_unsupported_extensions(filename):
    with pytest.raises(DocumentError):
        load_document(filename, b'Valid text')


@pytest.mark.parametrize('filename', ['', 'notes\x00.txt', 'notes\n.txt', 'x' * 201 + '.txt'])
def test_unsafe_filenames(filename):
    with pytest.raises(DocumentError):
        load_document(filename, b'Valid text')


@pytest.mark.parametrize('content', [b'', b' \n\t\r', b'\xef\xbb\xbf', '\u200b\ufeff'.encode()])
def test_empty_or_invisible_documents(content):
    with pytest.raises(DocumentError):
        load_document('empty.txt', content)


@pytest.mark.parametrize('content', [b'\xff\xfeN\x00', b'notes\x00payload', b'notes\x01payload', b'PK\x03\x04archive', b'%PDF-1.7\nnot text'])
def test_binary_invalid_encoding_and_disguised_pdf(content):
    with pytest.raises(DocumentError):
        load_document('notes.txt', content)


def test_size_limit_is_in_bytes_and_inclusive():
    content = 'é'.encode('utf-8')
    assert load_document('notes.txt', content, max_bytes=2).byte_size == 2
    with pytest.raises(DocumentError):
        load_document('notes.txt', content, max_bytes=1)


def test_character_limit_is_inclusive():
    assert load_document('notes.md', b'abc', max_characters=3).pages[0].text == 'abc'
    with pytest.raises(DocumentError):
        load_document('notes.md', b'abcd', max_characters=3)


def test_pdf_page_numbers_and_empty_pages_are_preserved():
    document = load_document('chapter.PDF', make_pdf('First page', '', 'Third page'))
    assert [page.page_number for page in document.pages] == [1, 2, 3]
    assert document.pages[0].text.strip() == 'First page'
    assert not document.pages[1].text.strip()
    assert document.pages[2].text.strip() == 'Third page'
    assert document.warnings


@pytest.mark.parametrize('content', [b'plain text pretending to be a PDF', b'%PDF-1.7\nbroken structure'])
def test_corrupted_or_disguised_pdf(content):
    with pytest.raises(DocumentError):
        load_document('broken.pdf', content)


def test_repaired_pdf_is_rejected_instead_of_silently_accepting_partial_data():
    content = re.sub(rb'startxref\n\d+', b'startxref\n0', make_pdf('Chapter text'))
    with pymupdf.open(stream=content, filetype='pdf') as pdf:
        assert pdf.is_repaired  # Fixture must actually exercise parser recovery.
    with pytest.raises(DocumentError):
        load_document('repaired.pdf', content)


@pytest.mark.parametrize('user_password', ['password', ''])
def test_encrypted_pdf_is_rejected_even_with_empty_user_password(user_password):
    content = make_pdf('Private chapter', encryption=pymupdf.PDF_ENCRYPT_AES_256,
                       owner_pw='owner-password', user_pw=user_password)
    with pytest.raises(DocumentError):
        load_document('locked.pdf', content)


def test_blank_pdf_has_no_extractable_text():
    with pytest.raises(DocumentError):
        load_document('blank.pdf', make_pdf('', ''))


def test_graphics_only_pdf_has_no_extractable_text():
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.draw_rect(pymupdf.Rect(20, 20, 100, 100), color=(1, 0, 0))
        content = pdf.tobytes()
    with pytest.raises(DocumentError):
        load_document('scan.pdf', content)


def test_pdf_page_and_total_character_limits():
    content = make_pdf('First', 'Second')
    assert len(load_document('notes.pdf', content, max_pages=2).pages) == 2
    with pytest.raises(DocumentError):
        load_document('notes.pdf', content, max_pages=1)
    with pytest.raises(DocumentError):
        load_document('notes.pdf', content, max_characters=10)


@pytest.mark.parametrize('error_type', [pymupdf.mupdf.FzErrorGeneric, RuntimeError, ValueError, OSError])
def test_parser_errors_are_safe(monkeypatch, error_type):
    def fail_to_parse(*args, **kwargs):
        raise error_type('private parsing text')
    monkeypatch.setattr('src.document_loader.pymupdf.open', fail_to_parse)
    with pytest.raises(DocumentError) as caught:
        load_document('broken.pdf', b'%PDF-1.7\ncorrupt')
    assert 'private parsing text' not in str(caught.value)


@pytest.mark.parametrize('limit', [0, -1, True, 1.5, '10'])
@pytest.mark.parametrize('parameter', ['max_bytes', 'max_pages', 'max_characters'])
def test_invalid_limits_are_rejected(limit, parameter):
    with pytest.raises(ValueError):
        load_document('notes.txt', b'Valid text', **{parameter: limit})
