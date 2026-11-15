let csrf = '';
let initializing: Promise<Workspace> | null = null;
import type { Workspace } from './types';

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export function resetSession() {
  csrf = '';
  initializing = null;
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  handleAuth = true,
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (method !== 'GET') {
    headers.set('X-Requested-With', 'padhai');
    if (csrf) headers.set('X-PadhAI-CSRF', csrf);
    if (typeof options.body === 'string') headers.set('Content-Type', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal ?? AbortSignal.timeout(35000),
    });
  } catch {
    throw new APIError(
      0,
      'network',
      'We could not reach your study service. Check your connection and try again.',
    );
  }
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const code = body?.error?.code ?? 'service_unavailable';
    if (handleAuth && (response.status === 401 || code === 'session_changed')) {
      resetSession();
      window.dispatchEvent(new Event('padhai:session-expired'));
    }
    throw new APIError(
      response.status,
      code,
      body?.error?.message ??
        'The study service could not complete this request. Please try again.',
      body?.error?.retry_after,
    );
  }
  if (response.status !== 204 && body === null)
    throw new APIError(
      502,
      'invalid_response',
      'The study service is not responding correctly. Please try again.',
    );
  return body as T;
}

export async function loadWorkspace(): Promise<Workspace> {
  if (csrf) return request<Workspace>('/workspace');
  if (!initializing)
    initializing = (async () => {
      let session: { workspace: Workspace; csrf_token: string };
      try {
        session = await request('/session', {}, false);
      } catch (error) {
        if (!(error instanceof APIError) || error.status !== 401) throw error;
        session = await request('/session', { method: 'POST' }, false);
      }
      csrf = session.csrf_token;
      return session.workspace;
    })().finally(() => {
      initializing = null;
    });
  return initializing;
}

export function jsonRequest<T>(path: string, method: string, data?: unknown) {
  return request<T>(path, {
    method,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
export function uploadFile(file: File) {
  return request<{ status: 'added' | 'duplicate'; document: import('./types').Note }>(
    '/documents',
    {
      method: 'POST',
      body: file,
      headers: {
        'X-File-Name': encodeURIComponent(file.name),
        'Content-Type': 'application/octet-stream',
      },
    },
  );
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
