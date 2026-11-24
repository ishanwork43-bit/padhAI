import { describe, expect, it } from 'vitest';
import { chunksFor, decodeText, rankPassages, validateFile, validatePages } from './text';
import type { VectorPassage } from './store';
const encode = (text: string) => new TextEncoder().encode(text);
describe('local document boundaries', () => {
  it('rejects invalid types, misleading PDFs, empty and binary text', () => {
    expect(() => validateFile('payload.exe', encode('hello'))).toThrow('PDF, TXT');
    expect(() => validateFile('../notes.txt', encode('hello'))).toThrow('filename');
    expect(() => validateFile('notes.pdf', encode('not a PDF'))).toThrow('readable PDF');
    expect(() => validateFile('notes.txt', new Uint8Array())).toThrow('empty');
    expect(() => decodeText(new Uint8Array([0, 1, 255]))).toThrow();
    expect(() => decodeText(encode('binary\u0000content'))).toThrow('binary');
    expect(() => validatePages([{ text: '   ', page_number: 1 }])).toThrow('OCR');
  });
  it('preserves Unicode, UTF-16 BOM text, and safe literal Markdown', () => {
    expect(decodeText(encode('नमस्ते\r\n<script>alert(1)</script>'))).toBe(
      'नमस्ते\n<script>alert(1)</script>',
    );
    expect(decodeText(new Uint8Array([0xff, 0xfe, 65, 0, 66, 0]))).toBe('AB');
  });
  it('keeps exact offsets and page provenance across overlapping Unicode chunks', () => {
    const pages = [
      { page_number: 1, text: '  Biology 🌱 and photosynthesis.\n'.repeat(100) },
      { page_number: 2, text: 'A separate second-page fact.' },
    ];
    const chunks = chunksFor({ id: 'note', filename: 'bio.pdf', pages });
    for (const chunk of chunks) {
      expect(pages[chunk.page_number! - 1].text.slice(chunk.start_char, chunk.end_char)).toBe(
        chunk.text,
      );
      expect(chunk.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
    }
    expect(chunks.at(-1)?.page_number).toBe(2);
    expect(chunks.at(-1)?.text).toBe('A separate second-page fact.');
  });
  it('ranks normalized semantic vectors and excludes weak evidence', () => {
    const passages = chunksFor({
      id: 'n',
      filename: 'n.txt',
      pages: [{ text: 'evidence', page_number: null }],
    });
    const vectors: VectorPassage[] = [
      { ...passages[0], vector: new Float32Array([0, 1]), chunk_id: 'weak' },
      { ...passages[0], vector: new Float32Array([1, 0]), chunk_id: 'strong' },
    ];
    expect(rankPassages(vectors, new Float32Array([1, 0]), 5).map((x) => x.chunk_id)).toEqual([
      'strong',
    ]);
    expect(rankPassages(vectors, new Float32Array([-1, 0]), 5)).toEqual([]);
    expect(() => rankPassages(vectors, new Float32Array([1]), 5)).toThrow('rebuilding');
  });
});
