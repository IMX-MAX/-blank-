import { lookupCandidates } from './titles';

/** One song (or video) yt-dlp found, reduced to what the app needs. */
export type YtEntry = {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  durationMs: number;
  thumbnail: string | null;
};

export type YtListing = {
  /** Name of the playlist or album when the link was one. */
  title: string | null;
  entries: YtEntry[];
};

export type Classified =
  | { kind: 'search'; target: string }
  | { kind: 'video' | 'playlist'; target: string }
  | { kind: 'invalid'; reason: string };

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const SEARCH_RESULTS = 8;

export function isYoutubeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && YOUTUBE_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * What the user typed: a YouTube / YouTube Music link, or words to search for. Only YouTube addresses are ever handed
 * to yt-dlp, so it is never pointed at some other site or a local address.
 */
export function classify(input: string): Classified {
  const text = input.trim();
  if (!text) return { kind: 'invalid', reason: 'Paste a YouTube Music link or type a song name' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (!isYoutubeUrl(text)) return { kind: 'invalid', reason: 'Only YouTube and YouTube Music links work here' };
    const url = new URL(text);
    const playlistPage = url.pathname === '/playlist' || url.pathname === '/browse' || url.pathname.startsWith('/browse/');
    if (playlistPage && url.searchParams.get('list')) return { kind: 'playlist', target: `https://music.youtube.com/playlist?list=${url.searchParams.get('list')}` };
    return { kind: 'video', target: url.toString() };
  }
  if (text.length > 200) return { kind: 'invalid', reason: 'That is too long to search for' };
  return { kind: 'search', target: `ytsearch${SEARCH_RESULTS}:${text}` };
}

/** yt-dlp options that print one JSON document describing the target and download nothing. */
export function infoArgs(kind: 'search' | 'video' | 'playlist'): string[] {
  const common = ['-J', '--no-warnings', '--skip-download'];
  return kind === 'video' ? [...common, '--no-playlist'] : [...common, '--flat-playlist'];
}

/** yt-dlp options that save the audio, its cover picture and its description as `<id>.*` files. */
export function downloadArgs(outputTemplate: string): string[] {
  return [
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '--no-playlist',
    '--no-part',
    '--no-warnings',
    '--newline',
    '--write-thumbnail',
    '--write-info-json',
    '-o', outputTemplate,
  ];
}

/** 0 to 1 from a `[download]  42.0% of ...` line, or null for any other line. */
export function progressFrom(line: string): number | null {
  const match = /\[download\]\s+([\d.]+)%/.exec(line);
  if (!match) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) ? Math.min(1, Math.max(0, percent / 100)) : null;
}

const IMAGE = /\.(jpe?g|png|webp)$/i;

/** Which of the files yt-dlp wrote is the song, its picture and its info. */
export function sortFiles(names: string[]): { audio: string | null; cover: string | null; info: string | null } {
  const info = names.find((name) => name.endsWith('.info.json')) ?? null;
  const cover = names.find((name) => IMAGE.test(name)) ?? null;
  const audio = names.find((name) => name !== info && name !== cover && !name.endsWith('.json') && !name.endsWith('.part') && !name.endsWith('.ytdl')) ?? null;
  return { audio, cover, info };
}

type Raw = Record<string, unknown>;

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

function bestThumbnail(raw: Raw): string | null {
  const list = Array.isArray(raw.thumbnails) ? (raw.thumbnails as Raw[]) : [];
  const sized = list
    .filter((item) => typeof item.url === 'string')
    .sort((a, b) => num(b.width) * num(b.height) - num(a.width) * num(a.height));
  const url = text(raw.thumbnail) || text(sized[0]?.url);
  return url.startsWith('https://') ? url : null;
}

function artistOf(raw: Raw): string {
  const listed = Array.isArray(raw.artists) ? (raw.artists as unknown[]).map(text).filter(Boolean) : [];
  if (listed.length) return listed.join(', ');
  const direct = text(raw.artist) || text(raw.creator);
  if (direct) return direct;
  return text(raw.uploader) || text(raw.channel);
}

function entryOf(raw: Raw): YtEntry | null {
  const id = text(raw.id);
  if (!id) return null;
  const track = text(raw.track);
  const artist = artistOf(raw);
  // Videos have names like `Artist - Song (Official Video)`; songs from YouTube Music already carry clean tags.
  const guess = lookupCandidates(text(raw.title) || id, artist).find((item) => item.title) ?? { title: text(raw.title) || id, artist };
  const rawUrl = text(raw.webpage_url) || text(raw.url);
  const url = isYoutubeUrl(rawUrl) ? rawUrl : `https://www.youtube.com/watch?v=${id}`;
  const year = num(raw.release_year) || Number(text(raw.upload_date).slice(0, 4)) || null;
  return {
    id,
    url,
    title: track || guess.title,
    artist: (track && artist ? artist : guess.artist || artist).replace(/\s*-\s*topic$/i, '').trim() || 'Unknown',
    album: text(raw.album) || null,
    year,
    durationMs: Math.round(num(raw.duration) * 1000),
    thumbnail: bestThumbnail(raw),
  };
}

/** Reads the document `yt-dlp -J` printed: one video, or a playlist / search with `entries`. */
export function parseListing(json: string): YtListing {
  let raw: Raw;
  try {
    raw = JSON.parse(json) as Raw;
  } catch {
    throw new Error('yt-dlp gave an answer the app cannot read');
  }
  if (!raw || typeof raw !== 'object') throw new Error('yt-dlp found nothing');
  if (Array.isArray(raw.entries)) {
    const entries = (raw.entries as Array<Raw | null>).flatMap((item) => {
      const entry = item ? entryOf(item) : null;
      return entry ? [entry] : [];
    });
    const isSearch = /search/i.test(text(raw.extractor_key) || text(raw.extractor));
    return { title: isSearch ? null : text(raw.title) || null, entries };
  }
  const entry = entryOf(raw);
  return { title: null, entries: entry ? [entry] : [] };
}

/** The one video described by a saved `<id>.info.json`. */
export function parseInfoFile(json: string): YtEntry | null {
  return parseListing(json).entries[0] ?? null;
}

/** A file name that keeps its extension and drops what file systems do not allow. */
export function safeName(title: string, extension: string): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'track';
  return `${base}.${extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'm4a'}`;
}
