import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { HapticGate, type HapticKind } from './haptics-core';

export const HAPTICS_KEY = 'blank.haptics';

const available = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Haptics');

function send(kind: HapticKind) {
  if (!available()) return;
  const done = (promise: Promise<void>) => void promise.catch(() => undefined);
  switch (kind) {
    case 'tap':
      return done(Haptics.impact({ style: ImpactStyle.Light }));
    case 'tick':
      return done(Haptics.selectionChanged());
    case 'press':
    case 'thud':
      return done(Haptics.impact({ style: ImpactStyle.Medium }));
    case 'success':
      return done(Haptics.notification({ type: NotificationType.Success }));
    case 'warning':
      return done(Haptics.notification({ type: NotificationType.Warning }));
  }
}

function storedEnabled(): boolean {
  try {
    return localStorage.getItem(HAPTICS_KEY) !== '0';
  } catch {
    return true;
  }
}

/** The one place every haptic in the app goes through; it does nothing on the web. */
export const haptics = new HapticGate(send, { enabled: typeof localStorage === 'undefined' ? true : storedEnabled() });

export const setHapticsEnabled = (on: boolean) => {
  haptics.enabled = on;
};

/** A light tap, for buttons and picking up a row to drag. */
export const tapHaptic = () => void haptics.fire('tap');
/** A tick, for slider steps and a dragged row passing another. */
export const tickHaptic = () => void haptics.fire('tick');
/** A long press. */
export const pressHaptic = () => void haptics.fire('press');
/** A firmer tap, as when a swipe goes far enough to remove. */
export const thudHaptic = () => void haptics.fire('thud');
/** Something was added: to a playlist, to the queue. */
export const successHaptic = () => void haptics.fire('success');
/** Confirming something destructive. */
export const warningHaptic = () => void haptics.fire('warning');
