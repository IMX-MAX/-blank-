/**
 * Artist and album grouping for the artist and album pages, and the search behind the library picker. Pure
 * functions over the library, so they can be tested without React.
 *
 * Tags in a real library are messy: the same artist written with different case, spacing, accents or quote
 * marks; featured artists in the artist field; compilations credited to "Various Artists"; and songs with no
 * artist tag, which the importer credits to your own name. All of that is handled here.
 */
import type { Album, Track } from '../types';

/**
 * A key that is the same for every way one artist is written: case, spacing, accents, curly quotes, dashes,
 * "and" for "&", and a leading "The" do not matter.
 */
export function artistKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019\u02bc\u0060\u00b4]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2000-\u200b\u3000]/g, ' ')
    .toLowerCase()
    .replace(/\s+and\s+/g, ' & ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the\s+/, '')
    .replace(/[.!?]+$/, '');
}

/** Names that are not really an artist: compilations and missing tags. */
const NOT_ARTISTS = new Set(
  ['various artists', 'various', 'va', 'v.a.', 'v/a', 'unknown', 'unknown artist', '<unknown>', 'artist', 'no artist', 'untitled', '[unknown]', 'n/a', 'none', '-'].map((name) => artistKey(name)),
);

let fallbackNames = new Set<string>([artistKey('Unknown')]);

/** The name the importer gives songs with no artist tag (your own name), so it is not treated as an artist. */
export function setFallbackArtist(name: string | null | undefined): void {
  fallbackNames = new Set([artistKey('Unknown'), ...(name?.trim() ? [artistKey(name)] : [])]);
}

/** True for "Various Artists", "Unknown" and the stand-in name for untagged songs. */
export function isPlaceholderArtist(name: string, fallback: ReadonlySet<string> = fallbackNames): boolean {
  const key = artistKey(name);
  return !key || NOT_ARTISTS.has(key) || fallback.has(key);
}

/** Bands whose names look like several artists. */
const BANDS = new Set(
  [
    'Tyler, The Creator', 'Earth, Wind & Fire', 'Crosby, Stills, Nash & Young', 'Crosby, Stills & Nash', 'Emerson, Lake & Palmer',
    'Simon & Garfunkel', 'Hall & Oates', 'Daryl Hall & John Oates', 'Mumford & Sons', 'Florence + The Machine', 'Chase & Status',
    'Years & Years', 'Above & Beyond', 'Iron & Wine', 'She & Him', 'Peter, Bjorn and John', 'Blood, Sweat & Tears',
    'Kool & The Gang', 'Sly & The Family Stone', 'Echo & The Bunnymen', 'Bob Marley & The Wailers', 'Tom Petty and the Heartbreakers',
    'Of Monsters and Men', 'Marina and the Diamonds', 'Florence and the Machine', 'Prince & The Revolution', 'Ike & Tina Turner',
    'Sam & Dave', 'Brooks & Dunn', 'Big & Rich', 'Dan + Shay', 'Maddie & Tae', 'Love and Rockets', 'Rodrigo y Gabriela',
    'Belle & Sebastian', 'Marina & The Diamonds', 'Huey Lewis & The News', 'Hootie & The Blowfish', 'Derek & The Dominos',
    'Tears for Fears', 'Coheed and Cambria', 'Angus & Julia Stone', 'Macklemore & Ryan Lewis', 'The Mamas & The Papas',
    'AC/DC', 'Tones and I', 'Bell X1', 'Sleeping at Last', 'Twenty One Pilots', 'Panic! at the Disco',
  ].map((name) => artistKey(name)),
);

// "A feat. B", "A ft B", "A featuring B", "A (feat. B)", "A [with B]".
const FEAT = /\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\s+(?:feat\.?|ft\.?|featuring)\s+/i;
// Joins between several main artists.
const JOINS = /\s*(?:,|;|\s&\s|\s\+\s|\s\/\s|\s+x\s+|\s+vs\.?\s+|\s+×\s+)\s*/i;

/**
 * The separate artists credited in one artist string, the main artist first. A name that is a band, or an artist
 * already known in the library (as an album artist, say), stays whole; so do names like "X & the Y".
 */
export function splitArtists(raw: string, known?: ReadonlySet<string>): string[] {
  const text = raw.normalize('NFC').replace(/[\u00a0\u3000]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!text) return [];
  const whole = (name: string) => {
    const key = artistKey(name);
    return BANDS.has(key) || Boolean(known?.has(key)) || /\s(?:&|\+|and)\s+the\s/i.test(name);
  };
  if (whole(text)) return [text];
  const out: string[] = [];
  const add = (name: string) => {
    const clean = name.trim().replace(/^[([]+|[)\]]+$/g, '').trim();
    if (clean && !out.some((item) => artistKey(item) === artistKey(clean))) out.push(clean);
  };
  const splitPart = (part: string) => {
    if (whole(part)) return add(part);
    for (const piece of part.split(JOINS)) {
      if (!piece) continue;
      // " and " only splits when both sides are artists we know, as "Of Monsters and Men" is one band.
      const ands = piece.split(/\s+and\s+/i);
      if (ands.length > 1 && known && ands.every((item) => known.has(artistKey(item)))) ands.forEach(add);
      else add(piece);
    }
  };
  const match = FEAT.exec(text);
  if (!match) {
    splitPart(text);
    return out;
  }
  splitPart(text.slice(0, match.index));
  const rest = match[1] ?? text.slice(match.index + match[0].length);
  // Anything after the closing bracket ("A (feat. B) - Remix") is not an artist.
  splitPart(rest.replace(/[)\]].*$/, ''));
  return out;
}

/** Artist names already known in the library: album artists and songs credited to one artist. */
export function knownArtists(albums: readonly Album[], tracks: readonly Track[] = []): Set<string> {
  const known = new Set<string>();
  for (const album of albums) {
    if (album.kind === 'album' && album.artist.trim() && !isPlaceholderArtist(album.artist)) known.add(artistKey(album.artist));
  }
  for (const track of tracks) {
    const name = track.artist.trim();
    if (name && !isPlaceholderArtist(name) && !/[,;&/+×]|\s(?:feat\.?|ft\.?|featuring|x|vs\.?)\s|\((?:feat|ft|with)/i.test(name)) known.add(artistKey(name));
  }
  return known;
}

/** The real artists credited on a song: its artist field split up, leaving out placeholders. */
export function trackArtists(track: Track, known?: ReadonlySet<string>): string[] {
  return splitArtists(track.artist, known).filter((name) => !isPlaceholderArtist(name));
}

/** The real artists an album is credited to, or none for a compilation or an untagged album. */
export function albumArtists(album: Album, known?: ReadonlySet<string>): string[] {
  if (album.kind !== 'album') return [];
  return splitArtists(album.artist, known).filter((name) => !isPlaceholderArtist(name));
}

export type ArtistPage = {
  key: string;
  /** The name as it is most often written in the library. */
  name: string;
  /** Their albums: ones credited to them, newest first. */
  albums: Album[];
  /** Albums by others (or compilations) with songs of theirs on them. */
  appearsOn: Album[];
  /** Every song of theirs: newest album first, then in track order; loose songs last, by title. */
  tracks: Track[];
};

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

/** The spelling to show: the most used one, preferring capitals and accents over all lower-case on a tie. */
function bestSpelling(spellings: Map<string, number>, fallback: string): string {
  let best = fallback.trim();
  let bestScore = -1;
  for (const [name, count] of spellings) {
    const score = count * 10 + (name !== name.toLowerCase() ? 2 : 0) + (/[^\u0000-\u007f]/.test(name) ? 1 : 0);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }
  return best;
}

/** Everything by one artist: songs where they are credited (main or featured) and albums credited to them. */
export function artistPage(name: string, albums: readonly Album[], tracks: readonly Track[]): ArtistPage {
  const key = artistKey(name);
  const known = knownArtists(albums, tracks);
  const spellings = new Map<string, number>();
  const credited = (names: string[]) => {
    const hit = names.find((item) => artistKey(item) === key);
    if (hit) spellings.set(hit, (spellings.get(hit) ?? 0) + 1);
    return Boolean(hit);
  };
  if (!key || isPlaceholderArtist(name)) return { key, name: name.trim(), albums: [], appearsOn: [], tracks: [] };

  const own = albums.filter((album) => credited(albumArtists(album, known)));
  const ownIds = new Set(own.map((album) => album.id));
  const songs = tracks.filter((track) => {
    if (credited(trackArtists(track, known))) return true;
    // A song on their album with no artist of its own (untagged, or the stand-in name) is theirs too.
    return Boolean(track.albumId && ownIds.has(track.albumId) && !trackArtists(track, known).length);
  });
  // Their albums with none of the songs by them (a compilation they curated, say) still count as theirs.
  const albumById = new Map(albums.map((album) => [album.id, album]));
  const songsByAlbum = new Map<string, Track[]>();
  for (const track of tracks) if (track.albumId) songsByAlbum.set(track.albumId, [...(songsByAlbum.get(track.albumId) ?? []), track]);
  const yearOf = (album: Album) => albumYear(songsByAlbum.get(album.id) ?? []) ?? 0;

  const appearsIds = new Set<string>();
  for (const track of songs) {
    const album = track.albumId ? albumById.get(track.albumId) : undefined;
    if (album?.kind === 'album' && !ownIds.has(album.id)) appearsIds.add(album.id);
  }
  const appearsOn = albums.filter((album) => appearsIds.has(album.id));
  const newestFirst = (a: Album, b: Album) => yearOf(b) - yearOf(a) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  own.sort(newestFirst);
  appearsOn.sort(newestFirst);
  const albumOrder = new Map([...own, ...appearsOn].map((album, index) => [album.id, index]));
  const ordered = [...songs].sort((a, b) => {
    const ai = a.albumId ? (albumOrder.get(a.albumId) ?? 999) : 999;
    const bi = b.albumId ? (albumOrder.get(b.albumId) ?? 999) : 999;
    return (
      ai - bi ||
      (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id)
    );
  });
  return { key, name: bestSpelling(spellings, name), albums: own, appearsOn, tracks: ordered };
}

/** The cover ids to use for an artist's picture: their own albums first, then ones they appear on. */
export function artistCovers(page: ArtistPage, tracks: readonly Track[] = page.tracks): string[] {
  const out: string[] = [];
  for (const album of [...page.albums, ...page.appearsOn]) if (album.coverFileId && !out.includes(album.coverFileId)) out.push(album.coverFileId);
  for (const track of tracks) if (track.coverFileId && !out.includes(track.coverFileId)) out.push(track.coverFileId);
  return out;
}

/** One or two letters for an artist picture with no cover to use. */
export function artistInitials(name: string): string {
  const words = name.replace(/^the\s+/i, '').split(/[\s\-_.]+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word.replace(/[^\p{L}\p{N}]/gu, '')][0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

export type ArtistSections = { mostPlayed: boolean; albums: boolean; appearsOn: boolean; songsLimit: number };

/**
 * Which sections an artist page shows, so a few songs do not fill the page with the same songs twice: "Most
 * played" only when there are enough songs for it to say something the full list does not, and the full list
 * folded at ten when it is long.
 */
export function artistSections(page: ArtistPage, playedCount: number): ArtistSections {
  const songs = page.tracks.length;
  return {
    mostPlayed: songs > 6 && playedCount >= 3,
    albums: page.albums.length > 0,
    appearsOn: page.appearsOn.length > 0,
    songsLimit: songs > 12 ? 10 : songs,
  };
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
