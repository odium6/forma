import { useEffect } from 'react';
import type { Settings, ThemeMode } from '@/domain/types';

const THEME_COLORS = { light: '#f3f5f0', dark: '#0b100d' } as const;

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
}

function prefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Applies the theme to <html> (used by tokens and by Glisse) and mirrors it for the pre-paint script. */
export function applyTheme(mode: ThemeMode, glass: Settings['glass']) {
  const root = document.documentElement;
  const resolved = resolveTheme(mode, prefersDark());
  root.dataset.theme = resolved;
  root.dataset.glass = glass;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved]);
  try {
    localStorage.setItem('forma-theme', mode);
    localStorage.setItem('forma-glass', glass);
  } catch {
    /* private mode: theme still applies for this session */
  }
}

export function useThemeSync(mode: ThemeMode, glass: Settings['glass']) {
  useEffect(() => {
    applyTheme(mode, glass);
    if (mode !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme(mode, glass);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [mode, glass]);
}
