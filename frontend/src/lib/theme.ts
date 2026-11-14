import { useEffect, useState } from 'react';
export type Theme = 'light' | 'dark' | 'system';
const valid = (value: unknown): Theme => (value === 'light' || value === 'dark' ? value : 'system');
function stored() {
  try {
    return valid(localStorage.getItem('padhai-theme'));
  } catch {
    return 'system' as const;
  }
}
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme;
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
}
export function initTheme() {
  applyTheme(stored());
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => applyTheme(stored()));
  window.addEventListener('storage', (event) => {
    if (event.key === 'padhai-theme') applyTheme(stored());
  });
}
export function useTheme() {
  const [theme, set] = useState<Theme>(stored);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === 'padhai-theme') set(stored());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return [
    theme,
    (value: Theme) => {
      try {
        localStorage.setItem('padhai-theme', value);
      } catch {
        /* Appearance can still change for this page. */
      }
      set(value);
      applyTheme(value);
    },
  ] as const;
}
