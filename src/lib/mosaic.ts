/**
 * Covers for a smart playlist made from its songs: the first four different album covers, laid out like Apple
 * Music's playlist art.
 */
export const MOSAIC_MAX = 4;

export type MosaicLayout = 'none' | 'single' | 'pair' | 'trio' | 'grid';

/**
 * The cover ids to show, in playlist order, each once. A song without art is skipped; songs from the same album
 * (or with the same cover) count once.
 */
export function mosaicCovers<T>(tracks: readonly T[], coverOf: (track: T) => string | null | undefined, max = MOSAIC_MAX): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const track of tracks) {
    const id = coverOf(track);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** 0: the placeholder; 1: one cover filling the square; 2: side by side; 3: one big on the left, two stacked; 4: two by two. */
export function mosaicLayout(count: number): MosaicLayout {
  if (count <= 0) return 'none';
  if (count === 1) return 'single';
  if (count === 2) return 'pair';
  if (count === 3) return 'trio';
  return 'grid';
}

/** A key that changes only when the covers shown change, so the mosaic is not redrawn as plays are counted. */
export const mosaicKey = (covers: readonly string[]) => covers.join('|');
