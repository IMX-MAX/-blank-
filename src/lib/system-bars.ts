import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

/** Whether the player's background is dark in each theme: it fades to near-black in dark mode, near-white in light. */
export const PLAYER_DARK = { dark: true, light: false } as const;

/** Whether what sits under the status and navigation bars is dark: the theme, or the player while it is open. */
export function surfaceIsDark(theme: 'dark' | 'light', playerOpen: boolean): boolean {
  return playerOpen ? PLAYER_DARK[theme] : theme === 'dark';
}

let current: boolean | null = null;

/**
 * Light status and navigation bar icons on dark surfaces, dark icons on light ones. Capacitor 8's SystemBars (in
 * @capacitor/core) keeps the bars transparent over the edge-to-edge web view; only the icon colour changes here.
 */
export function syncSystemBars(dark: boolean): void {
  if (current === dark || !Capacitor.isNativePlatform()) return;
  current = dark;
  void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {
    current = null;
  });
}
