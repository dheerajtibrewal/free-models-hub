'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';

// Deliberately NOT renamed alongside the product. This key is invisible to
// users, and changing it would silently discard the theme preference of
// everyone who has already visited — a real regression in exchange for tidiness
// nobody can see.
const STORAGE_KEY = 'free-llm:theme';

/**
 * Dark-first with an explicit light option.
 *
 * The preference is a per-viewer convenience, so localStorage is the right home
 * for it -- but every access is guarded: private windows and blocked site data
 * make the accessor itself throw in some browsers.
 */
export function ThemeToggle() {
  const [theme, setTheme] = React.useState<'dark' | 'light'>('dark');

  React.useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* site data blocked; dark stays the default */
    }
    if (stored === 'light' || stored === 'dark') {
      setTheme(stored);
      document.documentElement.dataset.theme = stored;
    }
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* preference simply will not persist */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="grid h-11 w-11 cursor-pointer place-items-center rounded-md text-muted-fg transition-colors duration-200 hover:bg-[var(--muted)] hover:text-fg"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
    >
      {theme === 'dark' ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
