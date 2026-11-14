import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StudyProvider, useStudy } from './study';
import { loadWorkspace, request } from './api';
import { ToastProvider } from '../components/Toast';
vi.mock('./api', () => ({
  loadWorkspace: vi.fn(),
  request: vi.fn(),
  resetSession: vi.fn(),
  jsonRequest: vi.fn(),
  errorMessage: () => 'Service unavailable',
  APIError: class extends Error {
    status = 0;
  },
}));
const workspace = {
  id: 'owner',
  revision: 1,
  active_job: { id: 'answer-job', kind: 'answer', status: 'running', phase: 'generating' },
};
const job = {
  id: 'answer-job',
  kind: 'answer',
  status: 'running',
  phase: 'generating',
  revision: 1,
  result: null,
  error: null,
};
function Harness() {
  const study = useStudy();
  return (
    <>
      <span data-testid="question">{study.search?.question ?? 'empty'}</span>
      <span data-testid="answer">{study.answer?.question ?? 'empty'}</span>
      <span data-testid="job">{study.job?.status}</span>
      <button
        onClick={() =>
          study.setSearch({
            question: 'A newer question',
            revision: 1,
            mode: 'no_evidence',
            passages: [],
          })
        }
      >
        New question
      </button>
    </>
  );
}
function mount(route: string, children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <StudyProvider>{children}</StudyProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadWorkspace).mockResolvedValue(workspace as never);
  vi.mocked(request).mockResolvedValue(job);
});
it('does not create anonymous storage for a landing-page visitor', async () => {
  mount('/', <p>Public landing</p>);
  expect(screen.getByText('Public landing')).toBeInTheDocument();
  await act(async () => {});
  expect(loadWorkspace).not.toHaveBeenCalled();
});
it('does not overwrite a newer search when an earlier AI job finishes', async () => {
  const client = mount('/ask', <Harness />);
  await waitFor(() => expect(screen.getByTestId('job')).toHaveTextContent('running'));
  await userEvent.setup().click(screen.getByText('New question'));
  await act(async () => {
    client.setQueryData(['job', 'answer-job'], {
      ...job,
      status: 'completed',
      result: {
        question: 'An earlier question',
        mode: 'grounded',
        message: 'Ready',
        passages: [],
        claims: [],
      },
    });
  });
  expect(screen.getByTestId('question')).toHaveTextContent('A newer question');
  expect(screen.getByTestId('answer')).toHaveTextContent('empty');
});
