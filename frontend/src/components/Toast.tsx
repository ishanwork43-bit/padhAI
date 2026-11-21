import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
interface Toast {
  id: number;
  text: string;
  error: boolean;
}
const ToastContext = createContext<(text: string, error?: boolean) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const next = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const notify = useCallback((text: string, error = false) => {
    const id = ++next.current;
    setToasts((items) => [...items.slice(-2), { id, text, error }]);
    timers.current.push(
      setTimeout(() => setToasts((items) => items.filter((t) => t.id !== id)), 7000),
    );
  }, []);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast ${toast.error ? 'toast-error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >
            {toast.error ? <AlertCircle size={19} /> : <CheckCircle2 size={19} />}
            <span>{toast.text}</span>
            <button
              className="icon-button"
              onClick={() => setToasts((items) => items.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
