// A pinned Apache-2.0 MiniLM model; artifacts are SHA256-checked at build time.
export const MODEL_NAME = 'minilm-751bff37-q8';
export const MODEL_ID = `${MODEL_NAME}:weighted-windows-v1`;
export const LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  workspaceBytes: 50 * 1024 * 1024,
  documents: 20,
  characters: 500_000,
  chunks: 1200,
  pages: 200,
};
export class LocalError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function safeError(error: unknown) {
  if (error instanceof LocalError)
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.retryAfter ? { retry_after: error.retryAfter } : {}),
    };
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return {
      code: 'storage_full',
      status: 507,
      message:
        'Browser storage is full. Delete some notes or free device storage, then retry. Existing notes were kept.',
    };
  }
  return {
    code: 'local_failure',
    status: 500,
    message:
      'Your browser could not finish this operation. Retry, or reopen PadhAI. Keep your original files.',
  };
}
