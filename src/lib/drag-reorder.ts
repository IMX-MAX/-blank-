/**
 * Arithmetic for dragging one row of a list of equal-height rows, kept apart from the DOM so it can be tested.
 */

/** Where a row picked up at `from` lands after moving `offset` pixels, in a list of `count` rows `rowHeight` apart. */
export function dropTarget(from: number, offset: number, rowHeight: number, count: number): number {
  if (count <= 0 || rowHeight <= 0) return from;
  return Math.min(count - 1, Math.max(0, from + Math.round(offset / rowHeight)));
}

/** How far the row at `at` moves aside while the row from `from` is held over `target`. */
export function shiftFor(at: number, from: number, target: number, rowHeight: number): number {
  if (at === from) return 0;
  if (from < target && at > from && at <= target) return -rowHeight;
  if (from > target && at < from && at >= target) return rowHeight;
  return 0;
}

/**
 * Scroll speed in pixels per frame when the pointer is within `edge` pixels of the top or bottom of a scrolling
 * area: faster the closer it is, negative upwards, zero away from the edges.
 */
export function edgeScrollSpeed(pointerY: number, top: number, bottom: number, edge = 56, max = 14): number {
  if (pointerY < top + edge) return -max * Math.min(1, (top + edge - pointerY) / edge);
  if (pointerY > bottom - edge) return max * Math.min(1, (pointerY - (bottom - edge)) / edge);
  return 0;
}

/** Whether a horizontal swipe has gone far enough, or fast enough, to remove the row. */
export function swipeRemoves(dx: number, width: number, velocity: number): boolean {
  return dx < -width * 0.35 || (dx < -40 && velocity < -0.6);
}

/** Stable keys for a list that may hold the same id more than once: the id plus which copy it is. */
export function occurrenceKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count ? `${id}#${count}` : id;
  });
}
