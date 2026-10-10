import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';

type SettingsValue = {
  theme: ThemeChoice;
  resolvedTheme: 'dark' | 'light';
  setTheme: (theme: ThemeChoice) => void;
  /** Show a song's own cover instead of its album's in the playback bar and the player. */
  songCovers: boolean;
  setSongCovers: (on: boolean) => void;
};

const SettingsContext = createContext<SettingsValue | null>(null);

const THEME_KEY = 'blank.theme';
const COVERS_KEY = 'blank.songCovers';

function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === 'light' || stored === 'system' ? stored : 'dark';
}

function systemTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readTheme);
  const [system, setSystem] = useState<'dark' | 'light'>(systemTheme);
  const [songCovers, setSongCoversState] = useState(() => localStorage.getItem(COVERS_KEY) === '1');
  const resolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: light)');
    const update = () => setSystem(query.matches ? 'light' : 'dark');
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'light' ? '#f3f3f5' : '#151515');
  }, [resolvedTheme]);

  const setTheme = useCallback((next: ThemeChoice) => {
    localStorage.setItem(THEME_KEY, next);
    setThemeState(next);
  }, []);

  const setSongCovers = useCallback((on: boolean) => {
    localStorage.setItem(COVERS_KEY, on ? '1' : '0');
    setSongCoversState(on);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, songCovers, setSongCovers }),
    [theme, resolvedTheme, setTheme, songCovers, setSongCovers],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
