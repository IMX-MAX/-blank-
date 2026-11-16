import type { Album, Track } from '../types';

/** The album's release year: the year most of its songs are tagged with, or null. */
export function albumYear(tracks: readonly Track[]): number | null {
  const counts = new Map<number, number>();
  for (const track of tracks) if (track.year && track.year > 1000) counts.set(track.year, (counts.get(track.year) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [year, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && year < best)) {
      best = year;
      bestCount = count;
    }
  }
  return best;
}

export type PickerRow = { track: Track; album?: Album; added: boolean };

const fold = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * The library picker's rows: every song, filtered by a search over title, artist and album (every word has to
 * match somewhere, ignoring case and accents), songs already in the target marked. Best matches first: title
 * starts with the search, then artist, then the rest in library order (artist, album, track number).
 */
export function pickerRows(
  query: string,
  tracks: readonly Track[],
  albums: readonly Album[],
  alreadyIn: ReadonlySet<string>,
): PickerRow[] {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  const needle = words.join(' ');
  const rows: { row: PickerRow; score: number }[] = [];
  for (const track of tracks) {
    const album = track.albumId ? byId.get(track.albumId) : undefined;
    const title = fold(track.title);
    const artist = fold(track.artist);
    const albumName = album?.kind === 'album' ? fold(album.name) : '';
    const haystack = `${title} ${artist} ${albumName}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const score = !needle ? 0 : title.startsWith(needle) ? 0 : title.includes(needle) ? 1 : artist.startsWith(needle) ? 2 : albumName.startsWith(needle) ? 3 : 4;
    rows.push({ row: { track, album, added: alreadyIn.has(track.id) }, score });
  }
  const cmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
  return rows
    .sort(
      (a, b) =>
        a.score - b.score ||
        cmp(a.row.track.artist, b.row.track.artist) ||
        cmp(a.row.album?.name ?? '', b.row.album?.name ?? '') ||
        (a.row.track.trackNumber ?? 9999) - (b.row.track.trackNumber ?? 9999) ||
        cmp(a.row.track.title, b.row.track.title),
    )
    .map((item) => item.row);
}
