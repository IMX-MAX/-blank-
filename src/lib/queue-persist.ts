import type { QueueState } from './queue-order';

/**
 * The queue as it is kept between launches: song ids rather than songs (the library has the songs), both orders,
 * the shuffle, and where in the song playback was.
 */
export type SavedQueue = {
  v: 1;
  /** Song ids in the order the queue was given. */
  ordered: string[];
  /** Play order, as positions in `ordered` (see queue-order.ts). */
  slots: number[];
  index: number;
  shuffle: boolean;
  /** Seconds into the song playing. */
  position: number;
  /** The song playing, to check the rest against. */
  trackId: string;
  savedAt: number;
};

export const QUEUE_KEY = 'blank.queue';

export function serialiseQueue<T extends { id: string }>(state: QueueState<T>, shuffle: boolean, position: number, now = Date.now()): SavedQueue | null {
  const current = state.ordered[state.slots[state.index] ?? -1];
  if (!current) return null;
  return {
    v: 1,
    ordered: state.ordered.map((item) => item.id),
    slots: [...state.slots],
    index: state.index,
    shuffle,
    position: Number.isFinite(position) && position > 0 ? Math.round(position * 10) / 10 : 0,
    trackId: current.id,
    savedAt: now,
  };
}

const isIndex = (value: unknown, length: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length;

export type RestoredQueue<T> = { state: QueueState<T>; shuffle: boolean; position: number };

/**
 * Turns a saved queue back into one, with the songs that are still in the library. Songs deleted since are
 * dropped from both orders; if the song that was playing is gone, the next one that is left plays from the start
 * (or the one before, at the end of the queue). Anything that does not hold together gives null, never a throw.
 */
export function restoreQueue<T extends { id: string }>(raw: unknown, library: T[]): RestoredQueue<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const saved = raw as Partial<SavedQueue>;
  if (saved.v !== 1 || !Array.isArray(saved.ordered) || !Array.isArray(saved.slots)) return null;
  const ids = saved.ordered;
  if (!ids.length || ids.some((id) => typeof id !== 'string')) return null;
  const byId = new Map(library.map((item) => [item.id, item]));

  // Old position in `ordered` → new position, or -1 when the song is gone.
  const remap: number[] = [];
  const ordered: T[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    remap.push(item ? ordered.length : -1);
    if (item) ordered.push(item);
  }
  if (!ordered.length) return null;

  const slotsValid =
    saved.slots.length === ids.length &&
    saved.slots.every((slot) => isIndex(slot, ids.length)) &&
    new Set(saved.slots).size === ids.length;
  let oldSlots = slotsValid ? (saved.slots as number[]) : ids.map((_, at) => at);
  let oldIndex = isIndex(saved.index, oldSlots.length) ? saved.index : -1;
  if (!slotsValid || oldIndex < 0 || ids[oldSlots[oldIndex]!] !== saved.trackId) {
    // The play order is unusable: fall back to the given order, from the song that was playing if it is known.
    oldSlots = ids.map((_, at) => at);
    oldIndex = typeof saved.trackId === 'string' ? ids.indexOf(saved.trackId) : -1;
    if (oldIndex < 0) oldIndex = 0;
  }

  let index = -1;
  let keptCurrent = false;
  const slots: number[] = [];
  oldSlots.forEach((slot, at) => {
    const next = remap[slot]!;
    if (next < 0) return;
    if (at === oldIndex) keptCurrent = true;
    if (at >= oldIndex && index < 0) index = slots.length;
    slots.push(next);
  });
  if (index < 0) index = slots.length - 1;
  const position = keptCurrent && typeof saved.position === 'number' && Number.isFinite(saved.position) && saved.position > 0 ? saved.position : 0;
  return { state: { ordered, slots, index }, shuffle: saved.shuffle === true, position };
}

/** Reads the saved queue; null when there is none or it cannot be read. */
export function readSavedQueue(storage: Pick<Storage, 'getItem'> = localStorage): unknown {
  try {
    const raw = storage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeSavedQueue(saved: SavedQueue | null, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (saved) storage.setItem(QUEUE_KEY, JSON.stringify(saved));
    else storage.removeItem(QUEUE_KEY);
  } catch {
    /* storage full or unavailable: the queue is just not remembered */
  }
}

/**
 * Songs played recently, oldest first, kept apart from the queue so that starting a new album or clearing the
 * queue does not forget them. For showing what was played above what is coming up.
 */
export const HISTORY_KEY = 'blank.history';
export const HISTORY_LIMIT = 100;

/** Adds a song to the end of the history; playing the same song twice in a row is kept once. */
export function pushHistory(history: readonly string[], id: string, limit = HISTORY_LIMIT): string[] {
  if (history[history.length - 1] === id) return history as string[];
  const next = [...history, id];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The saved history as song ids, with anything that is not one left out. */
export function readHistory(storage: Pick<Storage, 'getItem'> = localStorage): string[] {
  try {
    const raw = JSON.parse(storage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(-HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function writeHistory(history: readonly string[], storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): void {
  try {
    if (history.length) storage.setItem(HISTORY_KEY, JSON.stringify(history));
    else storage.removeItem(HISTORY_KEY);
  } catch {
    /* not remembered */
  }
}

/** History ids → songs still in the library, oldest first. */
export function historyTracks<T extends { id: string }>(history: readonly string[], byId: ReadonlyMap<string, T>): T[] {
  const out: T[] = [];
  for (const id of history) {
    const item = byId.get(id);
    if (item) out.push(item);
  }
  return out;
}
