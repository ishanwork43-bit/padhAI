import type { Passage } from '../lib/types';
import type { Page, StoredNote, VectorPassage } from './store';
import { LIMITS, LocalError } from './constants';

export function validateFile(name: string, bytes: Uint8Array) {
  if (!name || name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(name))
    throw new LocalError(
      'filename',
      'Use a filename without directory paths or control characters.',
    );
  const extension = name.split('.').at(-1)?.toLowerCase();
  if (!['pdf', 'txt', 'md'].includes(extension ?? ''))
    throw new LocalError('file_type', 'Choose a PDF, TXT, or Markdown file.');
  if (!bytes.length) throw new LocalError('empty_file', 'This file is empty.');
  if (bytes.length > LIMITS.fileBytes)
    throw new LocalError(
      'file_size',
      'This file exceeds the 10 MiB limit. Split it into smaller files.',
    );
  if (extension === 'pdf' && !new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-'))
    throw new LocalError(
      'invalid_pdf',
      'This file is not a readable PDF. Export it as a PDF and retry.',
    );
  return extension as 'pdf' | 'txt' | 'md';
}
export function decodeText(bytes: Uint8Array) {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new LocalError(
      'encoding',
      'Save this text file as UTF-8 or UTF-16 with a byte-order mark, then retry.',
    );
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
    throw new LocalError(
      'binary_file',
      'This looks like binary content. Use a readable text or Markdown file.',
    );
  return text.replace(/\r\n?/g, '\n').trim();
}
export function chunksFor(note: Pick<StoredNote, 'id' | 'filename' | 'pages'>): Passage[] {
  const chunks: Passage[] = [];
  for (const page of note.pages) {
    let start = 0;
    while (start < page.text.length) {
      let end = Math.min(start + 800, page.text.length);
      if (end < page.text.length) {
        const boundary = Math.max(
          page.text.lastIndexOf('\n', end),
          page.text.lastIndexOf(' ', end),
        );
        if (boundary > start + 400) end = boundary;
        if (/[\uD800-\uDBFF]/.test(page.text[end - 1] ?? '')) end--;
      }
      const raw = page.text.slice(start, end);
      const leading = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (text)
        chunks.push({
          chunk_id: `${note.id}:${page.page_number ?? 0}:${start + leading}`,
          document_id: note.id,
          filename: note.filename,
          page_number: page.page_number,
          start_char: start + leading,
          end_char: start + leading + text.length,
          text,
          similarity: 0,
        });
      if (chunks.length > LIMITS.chunks)
        throw new LocalError(
          'too_many_passages',
          'This document has too many passages. Split it into smaller notes.',
        );
      if (end === page.text.length) break;
      start = Math.max(start + 1, end - 120);
      if (/[\uDC00-\uDFFF]/.test(page.text[start] ?? '')) start++;
    }
  }
  return chunks;
}
export function validatePages(pages: Page[]) {
  if (!pages.some((p) => p.text.trim()))
    throw new LocalError(
      'no_text',
      'No selectable text was found. Scanned PDFs need OCR first; image recognition is not included.',
    );
  if (pages.reduce((sum, p) => sum + p.text.length, 0) > LIMITS.characters)
    throw new LocalError(
      'too_much_text',
      'This document is too large for local processing. Use fewer pages.',
    );
}
export function rankPassages(
  passages: VectorPassage[],
  query: Float32Array,
  limit: number,
): Passage[] {
  const scored = passages
    .map(({ vector, ...passage }) => {
      if (vector.length !== query.length)
        throw new LocalError(
          'index_incompatible',
          'This index needs rebuilding for the current search model.',
          409,
        );
      let similarity = 0;
      for (let i = 0; i < query.length; i++) similarity += vector[i] * query[i];
      return { ...passage, similarity };
    })
    .filter((p) => Number.isFinite(p.similarity) && p.similarity >= 0.22)
    .sort((a, b) => b.similarity - a.similarity || a.chunk_id.localeCompare(b.chunk_id));
  const selected: Passage[] = [];
  for (const passage of scored) {
    if (
      selected.some(
        (other) =>
          other.document_id === passage.document_id &&
          other.page_number === passage.page_number &&
          Math.max(
            0,
            Math.min(other.end_char, passage.end_char) -
              Math.max(other.start_char, passage.start_char),
          ) >
            Math.min(other.text.length, passage.text.length) * 0.6,
      )
    )
      continue;
    selected.push(passage);
    if (selected.length >= limit) break;
  }
  return selected;
}
