import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
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
const marker = 'padhai-private-ai-session';
async function accessRequest(
  action: string,
  method = 'GET',
  body?: unknown,
  csrf?: string,
): Promise<AIStatus> {
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
      'Private AI could not be reached. Your local search still works.',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new APIError(
      response.status,
      data?.error?.code ?? 'ai_unavailable',
      data?.error?.message ?? 'Private AI is unavailable.',
      data?.error?.retry_after,
    );
  return data;
}
function remembered() {
  try {
    return localStorage.getItem(marker) === 'yes';
  } catch {
    return false;
  }
}
function remember(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(marker, 'yes');
    else localStorage.removeItem(marker);
  } catch {
    /* A session still works without the optional marker. */
  }
}
interface Access {
  status: AIStatus | null;
  busy: boolean;
  error: string;
  cooldown: number;
  unlock: (code: string) => Promise<void>;
  lock: () => Promise<void>;
  refresh: () => Promise<void>;
  reportError: (message: string) => void;
}
const initial: Access = {
  status: null,
  busy: false,
  error: '',
  cooldown: 0,
  unlock: async () => {},
  lock: async () => {},
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
  const refresh = useCallback(async () => {
    if (!remembered()) return;
    try {
      const value = await accessRequest('status');
      setStatus(value);
      if (!value.authenticated) remember(false);
    } catch (reason) {
      if (reason instanceof APIError && reason.status === 401) {
        remember(false);
        setStatus(null);
      } else setError(reason instanceof Error ? reason.message : 'AI status is unavailable.');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const listener = (e: StorageEvent) => {
      if (e.key === marker) {
        if (!remembered()) setStatus(null);
        else void refresh();
      }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [refresh]);
  const next = status?.quota?.next_request_at ?? 0;
  useEffect(() => {
    if (next <= Date.now()) return;
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [next]);
  const unlock = async (code: string) => {
    setBusy(true);
    setError('');
    try {
      setStatus(await accessRequest('session', 'POST', { access_code: code }));
      remember(true);
      setTick(Date.now());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unlock failed.');
      throw reason;
    } finally {
      setBusy(false);
    }
  };
  const lock = async () => {
    setBusy(true);
    setError('');
    try {
      await accessRequest('session', 'DELETE', undefined, status?.csrf);
      remember(false);
      setStatus(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign out failed.');
      throw reason;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={{
        status,
        busy,
        error,
        cooldown: Math.max(0, Math.ceil((next - Math.max(tick, Date.now())) / 1000)),
        unlock,
        lock,
        refresh,
        reportError: setError,
      }}
    >
      {children}
    </Context.Provider>
  );
}
