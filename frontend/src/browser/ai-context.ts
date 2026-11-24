import { LocalError } from './constants';
import { chunksFor } from './text';
import type { LocalData } from './store';
import type { Citation, Passage, Quiz, AICoverage } from '../lib/types';
const encoder = new TextEncoder();
export interface PreparedContext {
  sources: Passage[];
  coverage: AICoverage;
}
export function prepareContext(
  state: LocalData,
  task: string,
  body: Record<string, unknown>,
): PreparedContext {
  let candidates: Passage[], total: Passage[];
  if (task === 'answer') {
    if (!state.index || state.index.revision !== state.revision)
      throw new LocalError('index_required', 'Build your current search index first.', 409);
    if (
      !Array.isArray(body.passage_ids) ||
      !body.passage_ids.length ||
      body.passage_ids.length > 10
    )
      throw new LocalError('sources_required', 'Search your notes before generating an answer.');
    candidates = body.passage_ids
      .map((id) => state.index!.passages.find((p) => p.chunk_id === id))
      .filter((p): p is Passage & { vector: Float32Array } => !!p);
    if (candidates.length !== body.passage_ids.length)
      throw new LocalError('sources_changed', 'Search your current notes again.', 409);
    total = candidates;
  } else {
    if (
      !Array.isArray(body.document_ids) ||
      !body.document_ids.length ||
      body.document_ids.length > 20 ||
      new Set(body.document_ids).size !== body.document_ids.length
    )
      throw new LocalError('notes_required', 'Choose at least one note.');
    const selected = state.documents.filter((n) => (body.document_ids as unknown[]).includes(n.id));
    if (selected.length !== body.document_ids.length)
      throw new LocalError(
        'notes_changed',
        'One of the selected notes was deleted. Select your notes again.',
        409,
      );
    const perNote = selected.map(chunksFor);
    total = perNote.flat();
    candidates = [];
    // Sample across pages and documents. Show incomplete coverage before sending.
    for (let round = 0; round < 8; round++)
      for (const chunks of perNote) {
        const slots = Math.min(8, chunks.length);
        if (round < slots)
          candidates.push(
            chunks[slots === 1 ? 0 : Math.floor((round * (chunks.length - 1)) / (slots - 1))],
          );
      }
  }
  const sources: Passage[] = [];
  let remaining = 4400;
  for (const candidate of candidates) {
    if (sources.length >= 8 || remaining < 20) break;
    if (sources.some((p) => p.chunk_id === candidate.chunk_id)) continue;
    let text = candidate.text;
    if (encoder.encode(text).length > remaining) {
      text = '';
      let bytes = 0;
      for (const char of candidate.text) {
        const n = encoder.encode(char).length;
        if (bytes + n > remaining) break;
        text += char;
        bytes += n;
      }
      text = text.trimEnd();
    }
    if (text.length < 10) continue;
    const { chunk_id, document_id, filename, page_number, start_char, similarity } = candidate;
    sources.push({
      chunk_id,
      document_id,
      filename,
      page_number,
      start_char,
      end_char: start_char + text.length,
      text,
      similarity,
    });
    remaining -= encoder.encode(text).length;
  }
  if (!sources.length)
    throw new LocalError('no_evidence', 'The selected notes do not have enough readable evidence.');
  return {
    sources,
    coverage: {
      passages: sources.length,
      total_passages: total.length,
      characters: sources.reduce((n, p) => n + p.text.length, 0),
      total_characters: total.reduce((n, p) => n + p.text.length, 0),
      filenames: [...new Set(sources.map((p) => p.filename))],
      sampled:
        sources.length < total.length ||
        sources.some(
          (p) => p.text.length < (total.find((t) => t.chunk_id === p.chunk_id)?.text.length ?? 0),
        ),
    },
  };
}
export function verifyLocalCitations(citations: Citation[], sources: Passage[]) {
  if (!Array.isArray(citations) || !citations.length || citations.length > 2)
    throw new LocalError(
      'invalid_evidence',
      'The generated evidence could not be checked against your local notes.',
    );
  for (const c of citations) {
    if (
      !sources.some(
        (s) =>
          c.document_id === s.document_id &&
          c.filename === s.filename &&
          c.page_number === s.page_number &&
          c.start_char >= s.start_char &&
          c.end_char <= s.end_char &&
          c.end_char === c.start_char + c.quote.length &&
          c.quote.length >= 10 &&
          s.text.slice(c.start_char - s.start_char, c.end_char - s.start_char) === c.quote,
      )
    )
      throw new LocalError(
        'invalid_evidence',
        'The returned source does not match your saved notes. Nothing was saved.',
      );
  }
}
export function publicQuiz(quiz: Quiz): Quiz {
  return quiz.submitted
    ? quiz
    : {
        ...quiz,
        questions: quiz.questions.map(({ question, options }) => ({ question, options })),
      };
}
export function submitQuiz(quiz: Quiz, answers: unknown) {
  if (quiz.submitted)
    throw new LocalError(
      'already_submitted',
      'This attempt is already submitted. Start a retake.',
      409,
    );
  if (
    !Array.isArray(answers) ||
    answers.length !== quiz.count ||
    answers.some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 3))
  )
    throw new LocalError('answers', 'Choose a valid option for each answered question.');
  const correctness = quiz.questions.map((q, i) => answers[i] === q.correct_index),
    correct = correctness.filter(Boolean).length;
  quiz.answers = answers;
  quiz.submitted = true;
  quiz.score = {
    total: quiz.count,
    correct,
    unanswered: answers.filter((a) => a === null).length,
    percentage: (correct / quiz.count) * 100,
    correctness,
  };
  return publicQuiz(quiz);
}
