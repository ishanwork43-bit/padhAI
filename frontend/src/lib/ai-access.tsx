import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { APIError } from './api';
export interface AIStatus {
  enabled: boolean;
  authenticated: boolean;
  csrf?: string;
  model: string;
  expires_at?: string;
  quota?: {
    remaining: number;
    token_budget_remaining: number;
    next_request_at: number;
    resets_at: string;
  };
}
async function accessRequest<T = AIStatus>(
  action: string,
  method = 'GET',
  body?: unknown,
  csrf?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/ai?action=${action}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-PadhAI-CSRF': csrf } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new APIError(
      0,
      'ai_network',
      'AI could not be reached. Your local search still works.',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new APIError(
      response.status,
      data?.error?.code ?? 'ai_unavailable',
      data?.error?.message ?? 'AI is unavailable.',
      data?.error?.retry_after,
    );
  return data;
}
function solveProof(challenge: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ai-proof.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: string, solution?: string) => {
      clearTimeout(timer); worker.terminate();
      if (error) reject(new Error(error)); else resolve(solution!);
    };
    const timer = setTimeout(() => finish('The browser check timed out. Retry the AI connection.'), 22000);
    worker.onmessage = (event) => finish(event.data.error, event.data.solution);
    worker.onerror = () => finish('The browser check could not run. Retry the AI connection.');
    worker.postMessage(challenge);
  });
}
interface Access {
  status: AIStatus | null;
  busy: boolean;
  error: string;
  cooldown: number;
  refresh: () => Promise<void>;
  reportError: (message: string) => void;
}
const initial: Access = {
  status: null,
  busy: false,
  error: '',
  cooldown: 0,
  refresh: async () => {},
  reportError: () => {},
};
const Context = createContext<Access>(initial);
export const useAI = () => useContext(Context);
export function AIProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AIStatus | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tick, setTick] = useState(Date.now());
  const { pathname } = useLocation();
  const inFlight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    setBusy(true); setError('');
    const pending = (async () => {
      try {
        let value: AIStatus;
        try { value = await accessRequest('status'); }
        catch (reason) {
          if (!(reason instanceof APIError) || reason.status !== 401) throw reason;
          const proof = await accessRequest<{ challenge: string; bits: number }>('challenge', 'POST');
          if (proof.bits !== 16) throw new Error('This browser check is not supported.');
          const solution = await solveProof(proof.challenge);
          value = await accessRequest('session', 'POST', { challenge: proof.challenge, solution });
        }
        setStatus(value); setTick(Date.now());
      } catch (reason) {
        setStatus(null);
        setError(reason instanceof Error ? reason.message : 'AI is unavailable.');
      } finally { setBusy(false); inFlight.current = null; }
    })();
    inFlight.current = pending;
    return pending;
  }, []);
  useEffect(() => {
    if (['/ask', '/summary', '/quiz', '/settings'].includes(pathname)) void refresh();
  }, [pathname, refresh]);
  const next = status?.quota?.next_request_at ?? 0;
  useEffect(() => {
    if (next <= Date.now()) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [next]);
  return (
    <Context.Provider
      value={{
        status,
        busy,
        error,
        cooldown: Math.max(0, Math.ceil((next - Math.max(tick, Date.now())) / 1000)),
        refresh,
        reportError: setError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
