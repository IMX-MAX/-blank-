import { Capacitor } from '@capacitor/core';

/**
 * Lets the hosted web app open with no connection by keeping a copy of its own files.
 * The Android app already carries those files inside the APK, so it skips this.
 */
export function registerOfflineShell() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  if (isNativeApp()) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
