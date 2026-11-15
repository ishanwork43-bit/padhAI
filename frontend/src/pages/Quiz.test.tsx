import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Quiz } from './Quiz';
import { request, jsonRequest } from '../lib/api';
import type { Quiz as QuizData } from '../lib/types';
const { study } = vi.hoisted(() => ({
  study: {
    workspace: {
      id: 'owner',
      revision: 1,
      documents: [{ id: 'note' }],
      quizzes: [],
      capabilities: { ai_available: false, ai_requests_remaining: 0 },
      settings: { ai_consent: false },
    },
    job: undefined,
    startJob: vi.fn(),
    refresh: vi.fn(),
  },
}));
vi.mock('../lib/study', () => ({ useStudy: () => study }));
vi.mock('../lib/api', () => ({
  request: vi.fn(),
  jsonRequest: vi.fn(),
  errorMessage: (error: Error) => error.message,
}));
vi.mock('../components/SourceSheet', () => ({ SourceSheet: () => null }));
const draft: QuizData = {
  id: 'quiz',
  count: 2,
  difficulty: 'easy',
  created_at: '2026-11-14T00:00:00Z',
  attempt_number: 1,
  submitted: false,
  score: null,
  answers: null,
  can_retake: false,
  questions: [
    { question: 'Which concept reduces redundancy?', options: ['Normalization', 'Latency'] },
    { question: 'Which service supplies virtual machines?', options: ['IaaS', 'DNS'] },
  ],
};
function mount(url = '/quiz?id=quiz') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[url]}>
        <Quiz />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(request).mockResolvedValue(structuredClone(draft));
});
it('shows honest availability and prevents generation without configured AI', async () => {
  mount('/quiz');
  expect(
    screen.getByRole('heading', { name: 'AI quizzes are currently off.' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Create my quiz/ })).toBeDisabled();
  expect(study.startJob).not.toHaveBeenCalled();
});
it('submits choices to the server and reveals only returned grades and explanations', async () => {
  const user = userEvent.setup();
  const completed: QuizData = {
    ...draft,
    submitted: true,
    can_retake: true,
    answers: [0, 1],
    score: { correct: 1, total: 2, unanswered: 0, percentage: 50, correctness: [true, false] },
    questions: draft.questions.map((q, i) => ({
      ...q,
      correct_index: 0,
      explanation: `Source explanation ${i + 1}`,
      citations: [],
    })),
  };
  vi.mocked(jsonRequest).mockResolvedValue(completed);
  mount();
  await screen.findByText('Which concept reduces redundancy?');
  expect(screen.queryByText('Why this answer?')).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: /Normalization/ }));
  await user.click(screen.getByRole('radio', { name: /DNS/ }));
  await user.click(screen.getByRole('button', { name: 'Submit quiz' }));
  await waitFor(() =>
    expect(jsonRequest).toHaveBeenCalledWith('/quizzes/quiz/submit', 'POST', {
      attempt_number: 1,
      answers: [0, 1],
    }),
  );
  expect(await screen.findByText('1 out of 2 correct.')).toBeInTheDocument();
  expect(screen.getByText('Source explanation 1')).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Normalization/ })).toBeDisabled();
});
it('requires a concrete confirmation before counting unanswered questions as incorrect', async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByText('Which concept reduces redundancy?');
  await user.click(screen.getByRole('button', { name: 'Submit quiz' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('2 questions are unanswered');
  expect(jsonRequest).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Keep practicing' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps choices available after a failed submission', async () => {
  const user = userEvent.setup();
  vi.mocked(jsonRequest).mockRejectedValue(new Error('Please retry.'));
  mount();
  await screen.findByText('Which concept reduces redundancy?');
  await user.click(screen.getByRole('radio', { name: /Normalization/ }));
  await user.click(screen.getByRole('radio', { name: /IaaS/ }));
  await user.click(screen.getByRole('button', { name: 'Submit quiz' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry.');
  expect(screen.getByRole('radio', { name: /Normalization/ })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Submit quiz' })).toBeEnabled();
});
