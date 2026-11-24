import { APIError } from '../lib/errors';
import type { Note } from '../lib/types';
let worker: Worker | undefined;
// ONNX Runtime retains a rejected initialization promise after some load failures.
// A fresh worker gives an explicit retry a clean runtime without touching IndexedDB.
let modelFailed = false;
let serial = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function restartWorker() {
  worker?.terminate();
  worker = undefined;
  modelFailed = false;
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(
      new APIError(
        409,
        'engine_restarted',
        'Local processing restarted. Please retry. Your saved notes are unchanged.',
      ),
    );
  }
  pending.clear();
}
function getWorker() {
  if (!worker) {
    if (!window.isSecureContext || typeof Worker === 'undefined')
      throw new APIError(
        400,
        'unsupported_browser',
        'Open PadhAI over HTTPS in a browser with Web Worker support.',
      );
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), {
      type: 'module',
      name: 'padhai-study-engine',
    });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      clearTimeout(request.timer);
      if (
        data.error?.code === 'model_unavailable' ||
        data.result?.error?.code === 'model_unavailable' ||
        data.result?.index?.error_code === 'model_unavailable'
      )
        modelFailed = true;
      if (data.error)
        request.reject(new APIError(data.error.status, data.error.code, data.error.message));
      else request.resolve(data.result);
    };
    worker.onerror = () => {
      restartWorker();
    };
    worker.onmessageerror = () => {
      restartWorker();
    };
  }
  return worker;
}
function send<T>(
  path: string,
  method: string,
  body?: unknown,
  transfer: Transferable[] = [],
): Promise<T> {
  const target = getWorker();
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(
      () => {
        restartWorker();
      },
      path.startsWith('/jobs/') ? 30000 : 180000,
    );
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    try {
      target.postMessage({ id, path, method, body }, transfer);
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(
        new APIError(
          500,
          'worker_message',
          'This document could not be sent to local processing. Please retry.',
        ),
      );
    }
  });
}
export function localRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (path === '/index' && options.method === 'DELETE') {
    return send<T>(path, 'DELETE').then((result) => {
      restartWorker();
      return result;
    });
  }
  if (modelFailed && options.method === 'POST' && ['/index', '/search'].includes(path))
    restartWorker();
  const body = typeof options.body === 'string' ? JSON.parse(options.body) : undefined;
  return send(path, options.method ?? 'GET', body);
}
export async function importFile(
  file: File,
): Promise<{ status: 'added' | 'duplicate'; document: Note }> {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new APIError(400, 'file_size', 'Choose a nonempty document no larger than 10 MiB.');
  const bytes = await file.arrayBuffer();
  return send('/documents', 'POST', { filename: file.name, bytes }, [bytes]);
}
