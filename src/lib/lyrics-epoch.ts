/**
 * Two counters that keep lyrics lookups honest after the user clears or replaces lyrics.
 *
 * - `generation` goes up the moment a clear starts. A lookup that began before it must not write what it
 *   found into any cache afterwards, or the old lyrics would come straight back.
 * - `version` goes up once a clear or replacement has finished, and tells everything that shows lyrics (the
 *   lyrics screen, the Glyph Matrix feed) to load them again.
 */
let generation = 0;
let version = 0;
let fresh = false;
const listeners = new Set<() => void>();

export const lyricsGeneration = (): number => generation;
export const lyricsVersion = (): number => version;

/** Lookups that started before this call must not write to any cache. */
export function invalidateLyricsWrites(): void {
  generation += 1;
}

/** Tells every listener the lyrics changed, so they load them again. */
export function announceLyricsChange(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

export function onLyricsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** After a clear the browser's own HTTP cache must not hand back an old answer either. */
export function markLyricsHttpStale(): void {
  fresh = true;
}

/** Extra `fetch` options for the lyrics services. */
export const lyricsFetchInit = (): { cache?: RequestCache } => (fresh ? { cache: 'reload' } : {});
