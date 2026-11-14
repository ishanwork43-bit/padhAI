import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, jsonRequest, loadWorkspace, request, resetSession, uploadFile } from './api';
const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  resetSession();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
describe('same-origin API client', () => {
  it('deduplicates session bootstrap and keeps the CSRF token out of storage', async () => {
    fetchMock
      .mockResolvedValueOnce(reply({ error: { code: 'no_workspace' } }, 401))
      .mockResolvedValueOnce(
        reply({ workspace: { id: 'workspace-one' }, csrf_token: 'csrf-memory-only' }),
      );
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    const [one, two] = await Promise.all([loadWorkspace(), loadWorkspace()]);
    expect(one).toEqual(two);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(storage).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(reply({ ok: true }));
    await jsonRequest('/search', 'POST', { question: 'private study question' });
    const [url, options] = fetchMock.mock.calls[2];
    expect(url).toBe('/api/search');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers.get('X-PadhAI-CSRF')).toBe('csrf-memory-only');
    expect(options.headers.get('X-Requested-With')).toBe('padhai');
    storage.mockRestore();
  });
  it('uploads raw bytes with an encoded filename instead of a multipart wrapper', async () => {
    fetchMock.mockResolvedValue(reply({ status: 'added' }));
    const file = new File(['private note'], 'study #1.txt');
    await uploadFile(file);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe(file);
    expect(options.headers.get('X-File-Name')).toBe('study%20%231.txt');
  });
  it('does not create a workspace for a service failure', async () => {
    fetchMock.mockResolvedValue(reply({ error: { code: 'busy', message: 'Retry shortly.' } }, 503));
    await expect(loadWorkspace()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('discards auth state and notifies the UI when a workspace expires', async () => {
    const listener = vi.fn();
    window.addEventListener('padhai:session-expired', listener);
    fetchMock.mockResolvedValue(
      reply({ error: { code: 'workspace_expired', message: 'Start again.' } }, 401),
    );
    await expect(request('/workspace')).rejects.toBeInstanceOf(APIError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener('padhai:session-expired', listener);
  });
  it('rejects invalid proxy responses without rendering HTML diagnostics', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>private proxy diagnostics</html>', { status: 502 }),
    );
    await expect(request('/workspace')).rejects.toMatchObject({ code: 'service_unavailable' });
  });
  it('turns network errors into a recoverable message', async () => {
    fetchMock.mockRejectedValue(new TypeError('private internal URL'));
    await expect(request('/workspace')).rejects.toMatchObject({
      code: 'network',
      message: expect.not.stringContaining('internal URL'),
    });
  });
});
