import { nativeControls } from './media-controls';

type WakeLockLike = { release(): Promise<void> };

let sentinel: WakeLockLike | null = null;
let requesting = false;
let wanted = false;

async function acquire() {
  const api = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } }).wakeLock;
  if (!api || sentinel || requesting || !wanted) return;
  requesting = true;
  try {
    const lock = await api.request('screen');
    if (wanted) {
      sentinel = lock;
    } else {
      await lock.release();
    }
  } catch {
    sentinel = null;
  } finally {
    requesting = false;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wanted) void acquire();
    if (document.visibilityState === 'hidden') sentinel = null;
  });
}

/** Keeps the screen from sleeping: the window flag in the app, the Screen Wake Lock API in a browser. */
export function setKeepAwake(on: boolean) {
  wanted = on;
  if (nativeControls) {
    void nativeControls.setKeepAwake({ enabled: on }).catch(() => undefined);
    return;
  }
  if (on) {
    void acquire();
  } else if (sentinel) {
    const held = sentinel;
    sentinel = null;
    void held.release().catch(() => undefined);
  }
}
