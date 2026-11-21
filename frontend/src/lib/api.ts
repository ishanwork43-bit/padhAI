import type { Workspace, Note } from './types';
export { APIError, errorMessage } from './errors';
const local = () => import('../browser/client');
export function resetSession() {
  void local().then((engine) => engine.restartWorker());
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await local()).localRequest<T>(path, options);
}
export function loadWorkspace(): Promise<Workspace> {
  return request('/workspace');
}
export function jsonRequest<T>(path: string, method: string, data?: unknown) {
  return request<T>(path, {
    method,
    ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  });
}
export async function uploadFile(
  file: File,
): Promise<{ status: 'added' | 'duplicate'; document: Note }> {
  return (await local()).importFile(file);
}
