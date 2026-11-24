import { fail } from "./core.mjs";

// IDs are scoped to one request. Every offered excerpt is an unchanged source slice.
export function quizEvidence(sources) {
  const evidence = [];
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  for (const source of sources) {
    const sentences = [];
    for (const part of segmenter.segment(source.text)) {
      const previous = sentences.at(-1);
      // PDF line endings are layout boundaries, not necessarily sentence endings.
      if (
        previous &&
        !/[.!?。！？]["'’”)\]]*$/u.test(previous.segment.trimEnd())
      )
        previous.segment += part.segment;
      else sentences.push({ index: part.index, segment: part.segment });
    }
    for (const sentence of sentences) {
      let start = sentence.index;
      const stop = start + sentence.segment.length;
      while (start < stop) {
        let end = Math.min(start + 350, stop);
        if (end < stop) {
          const boundary = Math.max(
            source.text.lastIndexOf(" ", end),
            source.text.lastIndexOf("\n", end),
          );
          if (boundary > start + 175) end = boundary;
          // Do not split a UTF-16 surrogate pair; citation offsets use JS string indices.
          if (/[\uD800-\uDBFF]/u.test(source.text[end - 1])) end--;
        }
        const raw = source.text.slice(start, end),
          quote = raw.trim();
        if (quote.length >= 10) {
          const offset = start + raw.indexOf(quote);
          evidence.push({
            evidence_id: `E${evidence.length + 1}`,
            source_id: source.source_id,
            document_id: source.document_id,
            filename: source.filename,
            page_number: source.page_number,
            start_char: source.start_char + offset,
            end_char: source.start_char + offset + quote.length,
            quote,
          });
        }
        if (end === stop) break;
        // Overlap long sentence windows so a short answer phrase need not straddle them.
        start = Math.max(start + 1, end - 40);
        if (/[\uDC00-\uDFFF]/u.test(source.text[start])) start--;
      }
    }
  }
  return evidence;
}

export function resolveEvidence(ids, evidence) {
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > 2 ||
    new Set(ids).size !== ids.length
  )
    fail("invalid_evidence_reference");
  return ids.map((id) => {
    const found = evidence.find((item) => item.evidence_id === id);
    if (!found) fail("invalid_evidence_reference");
    const { evidence_id, ...citation } = found;
    return citation;
  });
}
