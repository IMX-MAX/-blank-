/**
 * Artist and album grouping for the artist and album pages, and the search behind the library picker. Pure
 * functions over the library, so they can be tested without React.
 */
import type { Album, Track } from '../types';

/** Lower-case and squash spaces, so "The  Harbour" and "the harbour" are the same artist. */
export const artistKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

// "A feat. B", "A ft. B", "A featuring B", "A (feat. B)", "A with B" (only in brackets), "A, B", "A & B", "A; B", "A / B", "A x B".
const FEAT = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+/i;
const SEPARATORS = /\s*(?:,|;|\s&\s|\s\/\s|\s+x\s+|\s+and\s+)\s*/i;

/**
 * The separate artists credited in one artist string. A name that is itself a known artist (an album artist in
 * the library, say "Simon & Garfunkel") is kept whole; the main artist always comes first.
 */
export function splitArtists(raw: string, known?: ReadonlySet<string>): string[] {
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text) return [];
  if (known?.has(artistKey(text))) return [text];
  const out: string[] = [];
  const add = (name: string) => {
    const clean = name.trim().replace(/^[([]|[)\]]$/g, '').trim();
    if (clean && !out.some((item) => artistKey(item) === artistKey(clean))) out.push(clean);
  };
  const splitMain = (part: string) => {
    if (known?.has(artistKey(part))) return add(part);
    // " and " only splits when the pieces are artists we know, as "Earth, Wind and Fire" is one band.
    for (const piece of part.split(/\s*(?:,|;|\s&\s|\s\/\s|\s+x\s+)\s*/i)) {
      if (!piece) continue;
      const ands = piece.split(/\s+and\s+/i);
      if (ands.length > 1 && known && ands.every((item) => known.has(artistKey(item)))) ands.forEach(add);
      else add(piece);
    }
  };
  const match = FEAT.exec(text);
  if (!match) {
    splitMain(text);
    return out;
  }
  splitMain(text.slice(0, match.index));
  const rest = match[1] ?? text.slice(match.index + match[0].length);
  for (const piece of rest.split(SEPARATORS)) if (piece) add(piece);
  return out;
}

/** Album artists in the library, so names like "Simon & Garfunkel" are never split. */
export function knownArtists(albums: readonly Album[], tracks: readonly Track[] = []): Set<string> {
  const known = new Set<string>();
  for (const album of albums) if (album.kind === 'album' && album.artist.trim()) known.add(artistKey(album.artist));
  // A song whose whole artist string matches a single-artist song elsewhere is kept whole too.
  for (const track of tracks) {
    const name = track.artist.trim();
    if (name && !/[,;&/]|\s(?:feat\.?|ft\.?|featuring|x)\s/i.test(name)) known.add(artistKey(name));
  }
  return known;
}

export type ArtistPage = {
  /** The name as it is usually written in the library. */
  name: string;
  /** Their albums: ones credited to them, newest first. */
  albums: Album[];
  /** Albums by others with songs of theirs on them. */
  appearsOn: Album[];
  /** Every song of theirs, newest album first, then in track order. */
  tracks: Track[];
};

const yearOf = (album: Album, tracks: readonly Track[]) => albumYear(tracks.filter((track) => track.albumId === album.id));

/** Everything by one artist: songs where they are credited (main or featured) and albums credited to them. */
export function artistPage(name: string, albums: readonly Album[], tracks: readonly Track[]): ArtistPage {
  const key = artistKey(name);
  const known = knownArtists(albums, tracks);
  const byId = new Map(albums.map((album) => [album.id, album]));
  const credited = (raw: string) => splitArtists(raw, known).some((item) => artistKey(item) === key);
  let display = name.trim();
  const own = albums.filter((album) => album.kind === 'album' && credited(album.artist));
  const ownIds = new Set(own.map((album) => album.id));
  const songs = tracks.filter((track) => {
    if (credited(track.artist)) return true;
    const album = track.albumId ? byId.get(track.albumId) : undefined;
    // Untagged songs on their album count as theirs.
    return Boolean(album && ownIds.has(album.id) && !track.artist.trim());
  });
  for (const track of songs) {
    const exact = splitArtists(track.artist, known).find((item) => artistKey(item) === key);
    if (exact) {
      display = exact;
      break;
    }
  }
  const appearsIds = new Set(songs.map((track) => track.albumId).filter((id): id is string => Boolean(id) && !ownIds.has(id!)));
  const appearsOn = albums.filter((album) => album.kind === 'album' && appearsIds.has(album.id));
  const newestFirst = (a: Album, b: Album) => (yearOf(b, tracks) ?? 0) - (yearOf(a, tracks) ?? 0) || a.name.localeCompare(b.name);
  own.sort(newestFirst);
  appearsOn.sort(newestFirst);
  const albumOrder = new Map([...own, ...appearsOn].map((album, index) => [album.id, index]));
  const ordered = [...songs].sort((a, b) => {
    const ai = a.albumId ? (albumOrder.get(a.albumId) ?? 999) : 999;
    const bi = b.albumId ? (albumOrder.get(b.albumId) ?? 999) : 999;
    return ai - bi || (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) || a.title.localeCompare(b.title);
  });
  return { name: display, albums: own, appearsOn, tracks: ordered };
}

/** The album's release year: the year most of its songs are tagged with, or null. */
export function albumYear(tracks: readonly Track[]): number | null {
  const counts = new Map<number, number>();
  for (const track of tracks) if (track.year) counts.set(track.year, (counts.get(track.year) ?? 0) + 1);
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

/** The cover ids to use for an artist's picture: their own albums first, then ones they appear on. */
export function artistCovers(page: ArtistPage, tracks: readonly Track[] = page.tracks): string[] {
  const out: string[] = [];
  for (const album of [...page.albums, ...page.appearsOn]) if (album.coverFileId && !out.includes(album.coverFileId)) out.push(album.coverFileId);
  for (const track of tracks) if (track.coverFileId && !out.includes(track.coverFileId)) out.push(track.coverFileId);
  return out;
}

export type PickerRow = { track: Track; album?: Album; added: boolean };

/**
 * The library picker's rows: every song, filtered by a search over title, artist and album (every word has to
 * match somewhere), songs already in the playlist marked. Best matches first: title starts with the search, then
 * artist, then the rest in library order (artist, album, track number).
 */
export function pickerRows(
  query: string,
  tracks: readonly Track[],
  albums: readonly Album[],
  alreadyIn: ReadonlySet<string>,
): PickerRow[] {
  const byId = new Map(albums.map((album) => [album.id, album]));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows: { row: PickerRow; score: number }[] = [];
  for (const track of tracks) {
    const album = track.albumId ? byId.get(track.albumId) : undefined;
    const title = track.title.toLowerCase();
    const artist = track.artist.toLowerCase();
    const albumName = album?.kind === 'album' ? album.name.toLowerCase() : '';
    const haystack = `${title} ${artist} ${albumName}`;
    if (!words.every((word) => haystack.includes(word))) continue;
    const needle = words.join(' ');
    const score = !needle ? 0 : title.startsWith(needle) ? 0 : title.includes(needle) ? 1 : artist.startsWith(needle) ? 2 : albumName.startsWith(needle) ? 3 : 4;
    rows.push({ row: { track, album, added: alreadyIn.has(track.id) }, score });
  }
  return rows
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.row.track.artist.localeCompare(b.row.track.artist) ||
        (a.row.album?.name ?? '').localeCompare(b.row.album?.name ?? '') ||
        (a.row.track.trackNumber ?? 9999) - (b.row.track.trackNumber ?? 9999) ||
        a.row.track.title.localeCompare(b.row.track.title),
    )
    .map((item) => item.row);
}
