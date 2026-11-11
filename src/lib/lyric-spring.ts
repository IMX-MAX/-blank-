/**
 * The glide of the lyric rows when the sung line moves on. The list jumps to its new scroll position at once and
 * each row is drawn offset by how far it jumped, then the offsets run down to zero, rows further down starting a
 * little later so the lyrics unroll. Everything is a transform, driven from one requestAnimationFrame loop, so a
 * new line arriving mid-glide picks up from where each row is drawn now instead of snapping.
 */

export const GLIDE_MS = 760;
export const STAGGER_MS = 45;
export const MAX_STAGGER = 7;

/** 0 → 1 with a slight overshoot (about 3%), settled by the end. */
export function glide(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return 1 - Math.exp(-6.5 * progress) * Math.cos(5 * progress);
}

type Motion = { from: number; start: number; delay: number };

export class RowGlide<K> {
  private moving = new Map<K, Motion>();

  /** Where a row is drawn at `now`, in pixels from its laid-out place. */
  offset(key: K, now: number): number {
    const motion = this.moving.get(key);
    if (!motion) return 0;
    const progress = (now - motion.start - motion.delay) / GLIDE_MS;
    return motion.from * (1 - glide(progress));
  }

  /** The list moved by `delta` pixels under these rows: keep each where it is drawn, then let it glide home. */
  shift(rows: Array<{ key: K; delay: number }>, delta: number, now: number): void {
    for (const { key, delay } of rows) {
      const from = this.offset(key, now) + delta;
      this.moving.set(key, { from, start: now, delay });
    }
  }

  get active(): boolean {
    return this.moving.size > 0;
  }

  /** The offset of every moving row at `now`; rows that have settled come back as 0 once and are then forgotten. */
  frame(now: number): Array<[K, number]> {
    const out: Array<[K, number]> = [];
    for (const [key, motion] of this.moving) {
      if (now - motion.start - motion.delay >= GLIDE_MS) {
        this.moving.delete(key);
        out.push([key, 0]);
      } else {
        out.push([key, this.offset(key, now)]);
      }
    }
    return out;
  }

  /** Stops every glide; returns the rows that were moving so their transforms can be cleared. */
  clear(): K[] {
    const keys = [...this.moving.keys()];
    this.moving.clear();
    return keys;
  }
}

/** How much later a row `rowsBelow` rows under the new line starts to move. Rows above move with it. */
export const staggerFor = (rowsBelow: number) => Math.min(Math.max(0, rowsBelow), MAX_STAGGER) * STAGGER_MS;
