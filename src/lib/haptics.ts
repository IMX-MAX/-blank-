import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics');

/** A light tap, as when picking up a row to drag. Does nothing where there is no haptics. */
export function tapHaptic(): void {
  if (available()) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

/** A tick, as when a dragged row passes another. */
export function tickHaptic(): void {
  if (available()) void Haptics.selectionChanged().catch(() => undefined);
}

/** A firmer tap, as when a swipe goes far enough to remove. */
export function thudHaptic(): void {
  if (available()) void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined);
}
