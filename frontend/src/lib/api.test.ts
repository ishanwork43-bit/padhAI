import { beforeEach, expect, it, vi } from 'vitest';
import { loadWorkspace, uploadFile, jsonRequest } from './api';
import { localRequest, importFile } from '../browser/client';
vi.mock('../browser/client', () => ({
  localRequest: vi.fn(),
  importFile: vi.fn(),
  restartWorker: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());
it('loads the local workspace through the worker', async () => {
  vi.mocked(localRequest).mockResolvedValue({ id: 'local' });
  expect(await loadWorkspace()).toEqual({ id: 'local' });
  expect(localRequest).toHaveBeenCalledWith('/workspace', {});
});
it('passes file bytes only to the local importer', async () => {
  const file = new File(['private notes'], 'notes.txt');
  vi.mocked(importFile).mockResolvedValue({ status: 'duplicate', document: {} as never });
  await uploadFile(file);
  expect(importFile).toHaveBeenCalledWith(file);
  expect(localRequest).not.toHaveBeenCalled();
});
it('sends quiz scoring to the local engine', async () => {
  await jsonRequest('/quizzes/q/submit', 'POST', { answers: [0, null], attempt_number: 1 });
  expect(localRequest).toHaveBeenCalledWith('/quizzes/q/submit', {
    method: 'POST',
    body: JSON.stringify({ answers: [0, null], attempt_number: 1 }),
  });
});
