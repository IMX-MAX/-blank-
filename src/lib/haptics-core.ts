/**
 * Decides whether a haptic should fire: the Settings switch, and throttling so quick repeats do not turn into a
 * buzz. Kept apart from Capacitor so it can be tested.
 */
export type HapticKind = 'tap' | 'tick' | 'press' | 'thud' | 'success' | 'warning';

/** Shortest gap between two of the same kind, in ms. */
export const HAPTIC_GAPS: Record<HapticKind, number> = {
  tap: 70,
  tick: 45,
  press: 250,
  thud: 150,
  success: 400,
  warning: 400,
};
/** Light haptics this soon after any other are dropped, so a stronger one is not muddied by a tap behind it. */
export const LIGHT_AFTER_ANY = 90;
const LIGHT = new Set<HapticKind>(['tap', 'tick']);

export class HapticGate {
  enabled: boolean;
  private last = new Map<HapticKind, number>();
  private lastAny = -Infinity;
  private lastKind: HapticKind | null = null;

  constructor(
    private send: (kind: HapticKind) => void,
    options: { enabled?: boolean; now?: () => number } = {},
  ) {
    this.enabled = options.enabled ?? true;
    this.now = options.now ?? (() => Date.now());
  }

  private now: () => number;

  /** Fires `kind` unless switched off or throttled; returns whether it fired. */
  fire(kind: HapticKind): boolean {
    if (!this.enabled) return false;
    const now = this.now();
    if (now - (this.last.get(kind) ?? -Infinity) < HAPTIC_GAPS[kind]) return false;
    // A tap right after a different haptic (a warning on a confirm, a tick at the end of a drag) is dropped.
    if (LIGHT.has(kind) && this.lastKind !== kind && now - this.lastAny < LIGHT_AFTER_ANY) return false;
    this.last.set(kind, now);
    this.lastAny = now;
    this.lastKind = kind;
    this.send(kind);
    return true;
  }
}

/**
 * Detents for a continuous control (seek bar, slider): returns a function that says whether a new value has
 * crossed into a different step, so ticks come per step and not per pixel.
 */
export function detents(steps: number) {
  let last: number | null = null;
  return (ratio: number): boolean => {
    const step = Math.round(Math.min(1, Math.max(0, ratio)) * steps);
    if (step === last) return false;
    const first = last === null;
    last = step;
    return !first;
  };
}
