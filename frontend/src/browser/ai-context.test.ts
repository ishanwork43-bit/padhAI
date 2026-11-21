import { expect, it } from 'vitest';
import { freshData } from './store';
import { prepareContext, publicQuiz, submitQuiz, verifyLocalCitations } from './ai-context';
import type { Quiz } from '../lib/types';
it('samples bounded excerpts across selected notes and reports incomplete coverage', () => {
  const state = freshData();
  state.documents = ['a', 'b'].map((id) => ({
    id: id.repeat(64),
    filename: id + '.txt',
    type: 'txt',
    byte_size: 10000,
    character_count: 10000,
    chunk_count: 20,
    created_at: '',
    page_count: 1,
    warnings: [],
    pages: [{ page_number: null, text: 'A long study passage with useful evidence. '.repeat(250) }],
  }));
  const context = prepareContext(state, 'summary', {
    document_ids: state.documents.map((n) => n.id),
  });
  expect(context.sources.length).toBeLessThanOrEqual(8);
  expect(
    context.sources.reduce((n, s) => n + new TextEncoder().encode(s.text).length, 0),
  ).toBeLessThanOrEqual(4400);
  expect(context.coverage.filenames).toHaveLength(2);
  expect(context.coverage.sampled).toBe(true);
  expect(() => prepareContext(state, 'summary', { document_ids: ['deleted'] })).toThrow('deleted');
});
it('requires citations to match exact locally retained page text and offsets', () => {
  const source = {
    chunk_id: 'chunk',
    document_id: 'a'.repeat(64),
    filename: 'notes.pdf',
    page_number: 2,
    start_char: 20,
    end_char: 45,
    text: 'Normalization saves space',
    similarity: 1,
  };
  const citation = {
    source_id: 'S1',
    document_id: source.document_id,
    filename: source.filename,
    page_number: 2,
    start_char: 20,
    end_char: 45,
    quote: source.text,
  };
  expect(() => verifyLocalCitations([citation], [source])).not.toThrow();
  expect(() => verifyLocalCitations([{ ...citation, page_number: 1 }], [source])).toThrow();
  expect(() =>
    verifyLocalCitations([{ ...citation, quote: 'A fabricated source quote' }], [source]),
  ).toThrow();
});
it('hides draft solutions, scores locally, and rejects invalid or repeated submissions', () => {
  const quiz: Quiz = {
    id: 'q',
    count: 2,
    difficulty: 'easy',
    created_at: '',
    attempt_number: 1,
    submitted: false,
    score: null,
    answers: null,
    can_retake: true,
    questions: [
      {
        question: 'First question',
        options: ['a', 'b', 'c', 'd'],
        correct_index: 1,
        explanation: 'Evidence explanation',
      },
      { question: 'Second question', options: ['a', 'b', 'c', 'd'], correct_index: 2 },
    ],
  };
  expect(publicQuiz(quiz).questions[0].correct_index).toBeUndefined();
  expect(() => submitQuiz(quiz, [7, null])).toThrow();
  const result = submitQuiz(quiz, [1, null]);
  expect(result.score).toMatchObject({ correct: 1, total: 2, unanswered: 1, percentage: 50 });
  expect(result.questions[0].explanation).toBe('Evidence explanation');
  expect(() => submitQuiz(quiz, [1, 2])).toThrow('submitted');
});
