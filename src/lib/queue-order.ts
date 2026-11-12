/**
 * The play queue and its shuffle, kept as pure functions so the logic can be tested without audio.
 *
 * `ordered` is the queue in the order it was given (an album, a playlist, plus anything added). `slots` is the
 * order it plays in: `slots[i]` is the position in `ordered` of the song played i-th. Without shuffle `slots` is
 * 0, 1, 2, …; with shuffle it is a Fisher-Yates permutation with the song that was playing first. Keeping positions
 * rather than songs means a song that is in the queue twice is still told apart when shuffle is turned off.
 */
export type QueueState<T> = { ordered: T[]; slots: number[]; index: number };

export type Random = () => number;

export const emptyQueue = <T,>(): QueueState<T> => ({ ordered: [], slots: [], index: 0 });

/** The songs in the order they play. */
export const playOrder = <T,>(state: QueueState<T>): T[] => state.slots.map((slot) => state.ordered[slot]!);

const identity = (length: number) => Array.from({ length }, (_, index) => index);

/** Fisher-Yates: every order equally likely. */
export function fisherYates<T>(items: T[], random: Random = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** `first`, then every other slot of a queue of `length` in random order. */
function shuffledFrom(length: number, first: number, random: Random): number[] {
  return [first, ...fisherYates(identity(length).filter((slot) => slot !== first), random)];
}

/**
 * A new queue. With shuffle on, `start` plays first and the rest follow shuffled; when no start is given the
 * first song is picked at random too, as a shuffled album should not always open with track one.
 */
export function startQueue<T>(list: T[], start: number | undefined, shuffle: boolean, random: Random = Math.random): QueueState<T> {
  if (!list.length) return emptyQueue();
  const first = start === undefined ? (shuffle ? Math.floor(random() * list.length) : 0) : Math.min(Math.max(start, 0), list.length - 1);
  if (!shuffle) return { ordered: [...list], slots: identity(list.length), index: first };
  return { ordered: [...list], slots: shuffledFrom(list.length, first, random), index: 0 };
}

/**
 * Turns shuffle on (the song playing stays playing and moves to the front, everything else is shuffled after it,
 * songs before it included, so none is left out) or off (back to the order given, carrying on from the song
 * playing).
 */
export function setShuffle<T>(state: QueueState<T>, on: boolean, random: Random = Math.random): QueueState<T> {
  if (!state.slots.length) return state;
  const current = state.slots[state.index]!;
  if (on) return { ...state, slots: shuffledFrom(state.ordered.length, current, random), index: 0 };
  return { ...state, slots: identity(state.ordered.length), index: current };
}

export type Repeat = 'off' | 'all' | 'one';

/**
 * Where "next" goes: the following song in play order. At the end, repeat-all starts again from the top; with
 * shuffle on it plays the queue in a fresh shuffled order, never opening with the song that just finished. Returns
 * null when playback should stop. Repeat-one is handled by the player (it restarts the song) and is treated as
 * off here, so skipping still moves on.
 */
export function advance<T>(state: QueueState<T>, repeat: Repeat, shuffle: boolean, random: Random = Math.random): QueueState<T> | null {
  const length = state.slots.length;
  if (!length) return null;
  if (state.index < length - 1) return { ...state, index: state.index + 1 };
  if (repeat !== 'all') return null;
  if (!shuffle || length < 2) return { ...state, index: 0 };
  const last = state.slots[state.index]!;
  const first = Math.floor(random() * (length - 1));
  const pick = first >= last ? first + 1 : first;
  return { ...state, slots: shuffledFrom(length, pick, random), index: 0 };
}

/** Where "previous" goes: back through what has played, in play order. Null at the first song. */
export function retreat<T>(state: QueueState<T>): QueueState<T> | null {
  return state.index > 0 ? { ...state, index: state.index - 1 } : null;
}

/** Jumps to a position in play order. */
export function jump<T>(state: QueueState<T>, index: number): QueueState<T> {
  if (!state.slots.length) return state;
  return { ...state, index: Math.min(Math.max(index, 0), state.slots.length - 1) };
}

/**
 * "Play next": the song plays straight after the current one, whatever the shuffle, and in the original order it
 * sits right after the current song too, so turning shuffle off keeps it next.
 */
export function insertNext<T>(state: QueueState<T>, item: T): QueueState<T> {
  if (!state.slots.length) return { ordered: [item], slots: [0], index: 0 };
  const at = state.slots[state.index]! + 1;
  const ordered = [...state.ordered.slice(0, at), item, ...state.ordered.slice(at)];
  const slots = state.slots.map((slot) => (slot >= at ? slot + 1 : slot));
  slots.splice(state.index + 1, 0, at);
  return { ordered, slots, index: state.index };
}

/** Takes the song at a play-order position out of both orders. The song playing cannot be removed. */
export function removeAt<T>(state: QueueState<T>, position: number): QueueState<T> {
  if (position < 0 || position >= state.slots.length || position === state.index) return state;
  const gone = state.slots[position]!;
  const ordered = state.ordered.filter((_, slot) => slot !== gone);
  const slots = state.slots.filter((_, at) => at !== position).map((slot) => (slot > gone ? slot - 1 : slot));
  return { ordered, slots, index: position < state.index ? state.index - 1 : state.index };
}

/** Swaps songs for newer copies of themselves (retagged, new cover) without touching the order. */
export function mapQueue<T>(state: QueueState<T>, update: (item: T) => T): QueueState<T> {
  return { ...state, ordered: state.ordered.map(update) };
}

const isIdentity = (slots: readonly number[]) => slots.every((slot, at) => slot === at);

/**
 * Drags a song that is coming up from one play-order position to another (both after the song playing). Without
 * shuffle the given order changes too, so it stays the order played; with shuffle only the play order changes, and
 * turning shuffle off goes back to the order the queue was given.
 */
export function moveUpcoming<T>(state: QueueState<T>, from: number, to: number): QueueState<T> {
  const length = state.slots.length;
  if (from === to || from <= state.index || to <= state.index || from >= length || to >= length) return state;
  if (isIdentity(state.slots)) {
    const ordered = [...state.ordered];
    const [item] = ordered.splice(from, 1);
    ordered.splice(to, 0, item!);
    return { ...state, ordered };
  }
  const slots = [...state.slots];
  const [slot] = slots.splice(from, 1);
  slots.splice(to, 0, slot!);
  return { ...state, slots };
}

/** What `removeWithUndo` took out, enough to put it back where it was. */
export type Removed<T> = { item: T; position: number; slot: number };

/** `removeAt`, also returning what it takes out so `reinsert` can undo it. Null when nothing could be removed. */
export function removeWithUndo<T>(state: QueueState<T>, position: number): { state: QueueState<T>; removed: Removed<T> } | null {
  if (position < 0 || position >= state.slots.length || position === state.index) return null;
  const slot = state.slots[position]!;
  return { state: removeAt(state, position), removed: { item: state.ordered[slot]!, position, slot } };
}

/**
 * Puts a removed song back at the same place in both orders. If playback has since moved past that place, it goes
 * straight after the song playing instead, so an undo never puts a song in what has already played.
 */
export function reinsert<T>(state: QueueState<T>, removed: Removed<T>): QueueState<T> {
  if (!state.slots.length) return { ordered: [removed.item], slots: [0], index: 0 };
  const slot = Math.min(Math.max(removed.slot, 0), state.ordered.length);
  const ordered = [...state.ordered.slice(0, slot), removed.item, ...state.ordered.slice(slot)];
  const slots = state.slots.map((value) => (value >= slot ? value + 1 : value));
  const wasPlayed = removed.position < state.index;
  const position = wasPlayed ? removed.position : Math.min(Math.max(removed.position, state.index + 1), slots.length);
  slots.splice(position, 0, slot);
  return { ordered, slots, index: wasPlayed ? state.index + 1 : state.index };
}
