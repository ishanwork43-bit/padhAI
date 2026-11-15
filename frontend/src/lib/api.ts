import { BROWSER_MODE } from './mode';
import * as http from './http-api';
import type { Workspace, Note } from './types';
export { APIError, errorMessage } from './http-api';
const local = () => import('../browser/client');
export function resetSession() {
  if (BROWSER_MODE) void local().then((engine) => engine.restartWorker());
  else http.resetSession();
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  handleAuth = true,
): Promise<T> {
  if (!BROWSER_MODE) return http.request<T>(path, options, handleAuth);
  return (await local()).localRequest<T>(path, options);
}
export async function loadWorkspace(): Promise<Workspace> {
  return BROWSER_MODE ? request<Workspace>('/workspace') : http.loadWorkspace();
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
  return BROWSER_MODE ? (await local()).importFile(file) : http.uploadFile(file);
}
