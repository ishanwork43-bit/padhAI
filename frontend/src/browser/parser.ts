import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { LIMITS, LocalError } from './constants';
import { validateFile, decodeText, validatePages, chunksFor } from './text';
import type { Page, StoredNote } from './store';

export async function parseFile(filename: string, buffer: ArrayBuffer): Promise<StoredNote> {
  const data = new Uint8Array(buffer);
  const type = validateFile(filename, data);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  const id = Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, '0')).join('');
  const byte_size = data.byteLength;
  const pages: Page[] = [];
  const warnings: string[] = [];
  if (type === 'pdf') {
    // PDF.js assumes `window` when creating its own worker. Supply a real nested
    // worker explicitly so PDF parsing can also be terminated independently.
    const port = new Worker(new URL(workerUrl, self.location.origin), { type: 'module' });
    GlobalWorkerOptions.workerPort = port;
    const task = getDocument({
      data,
      useWorkerFetch: true,
      useWasm: false,
      useSystemFonts: false,
      disableFontFace: true,
      isOffscreenCanvasSupported: false,
      stopAtErrors: true,
      cMapUrl: new URL('/pdfjs/cmaps/', self.location.origin).href,
      cMapPacked: true,
      standardFontDataUrl: new URL('/pdfjs/standard_fonts/', self.location.origin).href,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const pdf = await task.promise;
          if (pdf.numPages > LIMITS.pages)
            throw new LocalError('page_limit', 'Use a PDF with 200 pages or fewer.');
          let length = 0;
          for (let n = 1; n <= pdf.numPages; n++) {
            const page = await pdf.getPage(n);
            const content = await page.getTextContent();
            const text = content.items
              .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
              .join('')
              .replace(/\r\n?/g, '\n')
              .trim();
            length += text.length;
            if (length > LIMITS.characters)
              throw new LocalError(
                'text_limit',
                'This PDF contains too much text. Import fewer pages.',
              );
            pages.push({ text, page_number: n });
            if (!text) warnings.push(`Page ${n} has no selectable text.`);
            page.cleanup();
          }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void task.destroy().catch(() => {});
            reject(
              new LocalError(
                'parse_timeout',
                'This PDF takes too long to process. Split it into smaller files.',
              ),
            );
          }, 45000);
        }),
      ]);
    } catch (error) {
      if (error instanceof LocalError) throw error;
      if (error instanceof Error && error.name === 'PasswordException')
        throw new LocalError(
          'encrypted_pdf',
          'This PDF is password protected. Remove its password locally before importing.',
        );
      throw new LocalError(
        'invalid_pdf',
        'This PDF could not be read. Re-export it and try again.',
      );
    } finally {
      clearTimeout(timer);
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        task.destroy().catch(() => {}),
        new Promise((resolve) => {
          cleanupTimer = setTimeout(resolve, 1000);
        }),
      ]);
      clearTimeout(cleanupTimer);
      GlobalWorkerOptions.workerPort = null;
      port.terminate();
    }
  } else pages.push({ text: decodeText(data), page_number: null });
  validatePages(pages);
  const note: StoredNote = {
    id,
    filename,
    type,
    byte_size,
    page_count: pages.length,
    chunk_count: 0,
    character_count: pages.reduce((sum, p) => sum + p.text.length, 0),
    pages,
    warnings,
    created_at: new Date().toISOString(),
  };
  note.chunk_count = chunksFor(note).length;
  return note;
}
