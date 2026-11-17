import { hueFromName } from './format';
import type { Track } from '../types';

/** A song from a YouTube Music guest search. `videoId` is what playback and downloads ask for. */
export type YtSong = {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  thumbnail: string;
  trackNumber: number | null;
  year: number | null;
};

/** An album page. `browseId` is the YouTube Music album id (it starts with MPRE). */
export type YtAlbum = {
  browseId: string;
  title: string;
  artist: string;
  thumbnail: string;
  year: number | null;
};

export type YtSearch = { songs: YtSong[]; albums: YtAlbum[] };

export type StreamChoice = { url: string; mimeType: string };

const IMPORTS_KEY = 'blank.youtube-imports';
const thumbs = new Map<string, string>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function rememberThumb(videoId: string, url: string): void {
  if (videoId && url) thumbs.set(videoId, url);
}

export function thumbFor(fileId: string): string | null {
  if (!fileId.startsWith('yt:')) return null;
  return thumbs.get(fileId.slice(3)) ?? null;
}

/** "3:47" or "1:02:03" as milliseconds. Anything else is 0. */
export function durationMs(text: string): number {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return 0;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part >= 60 && parts.length === 3 && part !== numbers[0])) return 0;
  if (parts.length === 2) return (numbers[0]! * 60 + numbers[1]!) * 1000;
  return (numbers[0]! * 3600 + numbers[1]! * 60 + numbers[2]!) * 1000;
}

function runs(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const list = value.runs;
  if (!Array.isArray(list)) return [];
  return list.flatMap((run) => (isRecord(run) && typeof run.text === 'string' ? [run.text] : []));
}

function columnRuns(row: Record<string, unknown>): string[][] {
  const columns = row.flexColumns;
  if (!Array.isArray(columns)) return [];
  return columns.map((column) => {
    if (!isRecord(column)) return [];
    const flex = column.musicResponsiveListItemFlexColumnRenderer;
    if (!isRecord(flex) || !isRecord(flex.text)) return [];
    return runs(flex.text);
  });
}

function fixedDuration(row: Record<string, unknown>): string {
  const columns = row.fixedColumns;
  if (!Array.isArray(columns)) return '';
  for (const column of columns) {
    if (!isRecord(column)) continue;
    const flex = column.musicResponsiveListItemFixedColumnRenderer;
    if (!isRecord(flex) || !isRecord(flex.text)) continue;
    const text = runs(flex.text).find((part) => /^\d+:\d{2}/.test(part.trim()));
    if (text) return text.trim();
  }
  return '';
}

function bulletGroups(parts: string[]): string[] {
  const groups: string[][] = [[]];
  for (const part of parts) {
    if (part.trim() === '•') groups.push([]);
    else groups[groups.length - 1]!.push(part);
  }
  return groups.map((group) => group.join('').trim()).filter(Boolean);
}

/** Splits "Artist • Album • 6:10" into those three pieces. */
export function splitMeta(parts: string[]): { artist: string; album: string; duration: string } {
  const texts = bulletGroups(parts);
  const duration = texts.find((text) => /^\d+:\d{2}/.test(text)) ?? '';
  const rest = texts.filter((text) => text !== duration);
  return { artist: rest[0] ?? '', album: rest[1] ?? '', duration };
}

const RELEASE_KINDS = new Set(['Album', 'Single', 'EP', 'Playlist']);

function bestThumbnail(node: unknown): string {
  let best = '';
  let width = -1;
  const walk = (value: unknown) => {
    if (!isRecord(value)) {
      if (Array.isArray(value)) value.forEach(walk);
      return;
    }
    const list = value.thumbnails;
    if (Array.isArray(list)) {
      for (const thumb of list) {
        if (!isRecord(thumb) || typeof thumb.url !== 'string') continue;
        const size = typeof thumb.width === 'number' ? thumb.width : 0;
        if (size >= width) {
          width = size;
          best = thumb.url;
        }
      }
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(node);
  return best;
}

function videoIdOf(row: Record<string, unknown>): string | null {
  let found: string | null = null;
  const walk = (value: unknown) => {
    if (found || !isRecord(value)) {
      if (!found && Array.isArray(value)) value.forEach(walk);
      return;
    }
    if (typeof value.videoId === 'string' && /^[\w-]{11}$/.test(value.videoId)) found = value.videoId;
    else for (const child of Object.values(value)) walk(child);
  };
  walk(row);
  return found;
}

function albumBrowseId(row: Record<string, unknown>): string | null {
  let found: string | null = null;
  const walk = (value: unknown) => {
    if (!isRecord(value)) {
      if (Array.isArray(value)) value.forEach(walk);
      return;
    }
    const page = isRecord(value.browseEndpointContextSupportedConfigs)
      ? value.browseEndpointContextSupportedConfigs
      : null;
    const config = page && isRecord(page.browseEndpointContextMusicConfig) ? page.browseEndpointContextMusicConfig : null;
    const pageType = config && typeof config.pageType === 'string' ? config.pageType : '';
    if (typeof value.browseId === 'string' && (value.browseId.startsWith('MPRE') || pageType === 'MUSIC_PAGE_TYPE_ALBUM')) {
      found = value.browseId;
    }
    for (const child of Object.values(value)) walk(child);
  };
  walk(row);
  return found;
}

function yearIn(value: unknown): number | null {
  let year: number | null = null;
  const walk = (node: unknown) => {
    if (year !== null) return;
    if (typeof node === 'string') {
      const match = node.match(/\b(?:19|20)\d{2}\b/);
      if (match) year = Number(match[0]);
      return;
    }
    if (Array.isArray(node)) node.forEach(walk);
    else if (isRecord(node)) Object.values(node).forEach(walk);
  };
  walk(value);
  return year;
}

function songFromRow(row: Record<string, unknown>, trackNumber: number | null, year: number | null): YtSong | null {
  const videoId = videoIdOf(row);
  if (!videoId) return null;
  const columns = columnRuns(row);
  const title = (columns[0] ?? []).join('').trim();
  if (!title) return null;
  const meta = splitMeta(columns[1] ?? []);
  const duration =
    meta.duration ||
    columns.slice(2).map((column) => splitMeta(column).duration).find(Boolean) ||
    fixedDuration(row);
  const thumbnail = bestThumbnail(row.thumbnail);
  if (thumbnail) rememberThumb(videoId, thumbnail);
  return {
    videoId,
    title,
    artist: meta.artist,
    album: meta.album,
    durationMs: durationMs(duration),
    thumbnail,
    trackNumber,
    year,
  };
}

function albumFromRow(row: Record<string, unknown>): YtAlbum | null {
  if (videoIdOf(row)) return null;
  const browseId = albumBrowseId(row);
  if (!browseId) return null;
  const columns = columnRuns(row);
  const title = (columns[0] ?? []).join('').trim();
  if (!title) return null;
  const groups = bulletGroups(columns[1] ?? []);
  const artist = RELEASE_KINDS.has(groups[0] ?? '') ? (groups[1] ?? '') : (groups[0] ?? '');
  const yearText = groups.find((group) => /^(?:19|20)\d{2}$/.test(group));
  return {
    browseId,
    title,
    artist,
    thumbnail: bestThumbnail(row.thumbnail),
    year: yearText ? Number(yearText) : yearIn(columns),
  };
}

function listRows(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) listRows(item, out);
    return out;
  }
  if (!isRecord(node)) return out;
  const row = node.musicResponsiveListItemRenderer;
  if (isRecord(row)) out.push(row);
  else for (const value of Object.values(node)) listRows(value, out);
  return out;
}

/** Songs and albums from a YouTube Music search response. */
export function parseSearch(data: unknown): YtSearch {
  const songs: YtSong[] = [];
  const albums: YtAlbum[] = [];
  const seenSongs = new Set<string>();
  const seenAlbums = new Set<string>();
  for (const row of listRows(data)) {
    const song = songFromRow(row, null, null);
    if (song) {
      if (!seenSongs.has(song.videoId)) {
        seenSongs.add(song.videoId);
        songs.push(song);
      }
      continue;
    }
    const album = albumFromRow(row);
    if (album && !seenAlbums.has(album.browseId)) {
      seenAlbums.add(album.browseId);
      albums.push(album);
    }
  }
  return { songs, albums };
}

function headerOf(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = headerOf(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  const header = node.musicResponsiveHeaderRenderer;
  if (isRecord(header)) return header;
  for (const value of Object.values(node)) {
    const found = headerOf(value);
    if (found) return found;
  }
  return null;
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';
  return runs(value).join('').trim();
}

function firstShelf(node: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = firstShelf(item);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  const shelf = node.musicShelfRenderer;
  if (isRecord(shelf) && Array.isArray(shelf.contents)) {
    return shelf.contents.flatMap((item) => (isRecord(item) && isRecord(item.musicResponsiveListItemRenderer) ? [item.musicResponsiveListItemRenderer] : []));
  }
  for (const value of Object.values(node)) {
    const found = firstShelf(value);
    if (found) return found;
  }
  return null;
}

export type YtAlbumPage = { album: YtAlbum; tracks: YtSong[] };

/** The album header and its track list. Other carousels on the page are ignored. */
export function parseAlbum(data: unknown, fallback: YtAlbum): YtAlbumPage {
  const header = headerOf(data);
  const title = textOf(header?.title) || fallback.title;
  const artist = textOf(header?.straplineTextOne) || fallback.artist;
  const thumbnail = (header && bestThumbnail(header.thumbnail)) || fallback.thumbnail;
  const year = (header && yearIn(header)) ?? fallback.year;
  const album: YtAlbum = { browseId: fallback.browseId, title, artist, thumbnail, year };
  const tracks: YtSong[] = [];
  for (const [index, row] of (firstShelf(data) ?? []).entries()) {
    const song = songFromRow(row, index + 1, year);
    if (!song) continue;
    tracks.push({ ...song, album: song.album || title, artist: song.artist || artist, year: song.year ?? year });
  }
  return { album, tracks };
}

type RawFormat = { mimeType: string; url: string; bitrate: number };

function formatsOf(value: unknown): RawFormat[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      {
        mimeType: typeof item.mimeType === 'string' ? item.mimeType : '',
        url: typeof item.url === 'string' ? item.url : '',
        bitrate: typeof item.bitrate === 'number' ? item.bitrate : 0,
      },
    ];
  });
}

/**
 * Picks a direct audio URL from a player response.
 * Audio-only mp4 is preferred, then any audio-only stream, then a progressive file that includes audio.
 * Cipher-only streams are skipped: this app does not decipher them.
 */
export function streamFromPlayer(data: unknown): StreamChoice | { error: string } {
  if (!isRecord(data)) return { error: 'YouTube did not answer' };
  const playability = isRecord(data.playabilityStatus) ? data.playabilityStatus : null;
  const status = playability && typeof playability.status === 'string' ? playability.status : '';
  const reason = playability && typeof playability.reason === 'string' ? playability.reason : '';
  const streaming = isRecord(data.streamingData) ? data.streamingData : null;
  const adaptive = formatsOf(streaming?.adaptiveFormats).filter((format) => format.url && format.mimeType.startsWith('audio/'));
  const mp4 = adaptive.filter((format) => format.mimeType.includes('mp4') || format.mimeType.includes('m4a'));
  const audio = (mp4.length ? mp4 : adaptive).sort((a, b) => b.bitrate! - a.bitrate!);
  const chosen = audio[0];
  if (chosen?.url) return { url: chosen.url, mimeType: chosen.mimeType || 'audio/mp4' };
  const progressive = formatsOf(streaming?.formats).filter((format) => format.url);
  const file = progressive.sort((a, b) => b.bitrate! - a.bitrate!)[0];
  if (file?.url) return { url: file.url, mimeType: file.mimeType || 'video/mp4' };
  if (status === 'LOGIN_REQUIRED') return { error: reason || 'YouTube asked for a sign-in before it would play this' };
  if (reason) return { error: reason };
  if (status && status !== 'OK') return { error: 'YouTube would not play this song' };
  return { error: 'YouTube did not provide a playable stream' };
}

/** A queue entry that streams until the song is saved into the library. */
export function trackFromYoutube(song: YtSong): Track {
  if (song.thumbnail) rememberThumb(song.videoId, song.thumbnail);
  return {
    id: `yt:${song.videoId}`,
    createdAt: new Date(0).toISOString(),
    title: song.title,
    artist: song.artist,
    albumId: null,
    audioFileId: `yt:${song.videoId}`,
    coverFileId: song.thumbnail ? `yt:${song.videoId}` : null,
    durationMs: song.durationMs,
    trackNumber: song.trackNumber,
    year: song.year,
    hue: hueFromName(song.title),
    waveform: null,
  };
}

function readImports(): Record<string, string> {
  try {
    const raw = localStorage.getItem(IMPORTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return {};
  }
}

export function importedTrackId(videoId: string): string | null {
  return readImports()[videoId] ?? null;
}

export function rememberImport(videoId: string, trackId: string): void {
  const next = readImports();
  next[videoId] = trackId;
  localStorage.setItem(IMPORTS_KEY, JSON.stringify(next));
}

export function forgetImport(trackId: string): void {
  const next = readImports();
  let changed = false;
  for (const [videoId, id] of Object.entries(next)) {
    if (id === trackId) {
      delete next[videoId];
      changed = true;
    }
  }
  if (changed) localStorage.setItem(IMPORTS_KEY, JSON.stringify(next));
}
