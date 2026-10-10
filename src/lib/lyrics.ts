import { parse as parseYaml } from 'yaml';

import { findAmll } from './amll';
import type { LyricLine, LyricWord, Lyrics, LyricsQuery, LyricsResult } from './lyric-types';
import { clean, lookupCandidates } from './titles';

export type { LyricLine, LyricSource, LyricWord, Lyrics, LyricsQuery, LyricsResult } from './lyric-types';
export { lookupCandidates };

type LrclibRecord = {
  id: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  hasWordSync?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  lyricsfile?: string | null;
};

const BASE = 'https://lrclib.net/api';
const CACHE_PREFIX = 'blank.lyrics.v2:';
const CACHE_INDEX = 'blank.lyrics.v2.index';
const CACHE_LIMIT = 60;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

const memory = new Map<string, LyricsResult>();

function cacheKey(q: LyricsQuery): string {
  return `${clean(q.artist).toLowerCase()}|${clean(q.title).toLowerCase()}|${Math.round(q.duration)}`;
}

function readCache(key: string): LyricsResult | null {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at: number; result: LyricsResult };
    if (entry.result.status === 'none' && Date.now() - entry.at > MISS_TTL_MS) return null;
    memory.set(key, entry.result);
    return entry.result;
  } catch {
    return null;
  }
}

function writeCache(key: string, result: LyricsResult) {
  memory.set(key, result);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ at: Date.now(), result }));
    const index: string[] = JSON.parse(localStorage.getItem(CACHE_INDEX) ?? '[]');
    const next = [key, ...index.filter((item) => item !== key)];
    for (const old of next.splice(CACHE_LIMIT)) localStorage.removeItem(CACHE_PREFIX + old);
    localStorage.setItem(CACHE_INDEX, JSON.stringify(next));
  } catch {
    /* storage full or unavailable: the in-memory copy still works */
  }
}

function closeLines(lines: Array<{ text: string; start: number; end?: number; words?: LyricWord[] }>): LyricLine[] {
  return lines.map((line, index) => {
    const nextStart = lines[index + 1]?.start;
    const lastWordEnd = line.words?.length ? line.words[line.words.length - 1]!.end : undefined;
    const end = Math.max(
      line.start + 0.1,
      line.end ?? lastWordEnd ?? (nextStart !== undefined ? nextStart : line.start + 4),
    );
    return { text: line.text, start: line.start, end, words: line.words ?? [] };
  });
}

function finishWords(words: Array<{ text: string; start: number; end?: number }>, lineEnd: number): LyricWord[] {
  return words.map((word, index) => ({
    text: word.text,
    start: word.start,
    end: Math.max(word.start, word.end ?? words[index + 1]?.start ?? lineEnd),
  }));
}

const TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;

function toSeconds(min: string, sec: string, frac?: string): number {
  const fraction = frac ? Number(`0.${frac}`) : 0;
  return Number(min) * 60 + Number(sec) + fraction;
}

/** Parses LRC, including the enhanced `<mm:ss.xx>` per-word tags. */
export function parseLrc(source: string): Lyrics | null {
  const raw: Array<{ text: string; start: number; words?: LyricWord[] }> = [];
  for (const row of source.split(/\r?\n/)) {
    const stamps = [...row.matchAll(TIME)];
    if (!stamps.length) continue;
    const body = row.replace(TIME, '').trim();
    if (!body) continue;
    const taggedWords = parseEnhancedWords(body);
    const text = taggedWords ? taggedWords.map((word) => word.text).join('').trim() : body;
    for (const stamp of stamps) {
      raw.push({
        text,
        start: toSeconds(stamp[1]!, stamp[2]!, stamp[3]),
        words: taggedWords ?? undefined,
      });
    }
  }
  if (!raw.length) return null;
  raw.sort((a, b) => a.start - b.start);
  return { mode: raw.some((line) => line.words?.length) ? 'word' : 'line', source: 'lrclib', lines: closeLines(raw) };
}

function parseEnhancedWords(body: string): LyricWord[] | null {
  const marks = [...body.matchAll(WORD_TIME)];
  if (!marks.length) return null;
  const words: Array<{ text: string; start: number }> = [];
  marks.forEach((mark, index) => {
    const from = (mark.index ?? 0) + mark[0].length;
    const to = marks[index + 1]?.index ?? body.length;
    const text = body.slice(from, to);
    if (text.trim()) words.push({ text, start: toSeconds(mark[1]!, mark[2]!, mark[3]) });
  });
  if (!words.length) return null;
  const lastStart = words[words.length - 1]!.start;
  return finishWords(words, lastStart + 0.6);
}

type YamlLine = {
  text?: unknown;
  start_ms?: unknown;
  end_ms?: unknown;
  words?: Array<{ text?: unknown; start_ms?: unknown; end_ms?: unknown }>;
};

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Parses a Lyricsfile (the YAML document LRCLIB stores for every record). */
export function parseLyricsfile(source: string): Lyrics | null {
  let doc: { lines?: YamlLine[]; plain?: unknown };
  try {
    doc = parseYaml(source) as typeof doc;
  } catch {
    return null;
  }
  const rawLines = Array.isArray(doc?.lines) ? doc.lines : [];
  const parsed: Array<{ text: string; start: number; end?: number; words?: LyricWord[] }> = [];
  let anyWords = false;
  for (const line of rawLines) {
    if (typeof line?.text !== 'string' || !isNum(line.start_ms)) continue;
    const start = line.start_ms / 1000;
    const end = isNum(line.end_ms) ? line.end_ms / 1000 : undefined;
    const rawWords = (line.words ?? [])
      .filter((word) => typeof word?.text === 'string' && isNum(word.start_ms))
      .map((word) => ({
        text: word.text as string,
        start: (word.start_ms as number) / 1000,
        end: isNum(word.end_ms) ? word.end_ms / 1000 : undefined,
      }));
    if (rawWords.length) anyWords = true;
    parsed.push({
      text: line.text,
      start,
      end,
      words: rawWords.length ? finishWords(rawWords, end ?? rawWords[rawWords.length - 1]!.start + 0.6) : undefined,
    });
  }
  if (parsed.length) {
    parsed.sort((a, b) => a.start - b.start);
    return { mode: anyWords ? 'word' : 'line', source: 'lrclib', lines: closeLines(parsed) };
  }
  if (typeof doc?.plain === 'string' && doc.plain.trim()) return parsePlain(doc.plain);
  return null;
}

export function parsePlain(source: string): Lyrics | null {
  const lines = source
    .split(/\r?\n/)
    .map((text) => text.trimEnd())
    .map((text) => ({ text, start: 0, end: 0, words: [] as LyricWord[] }));
  while (lines.length && !lines[0]!.text) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.text) lines.pop();
  return lines.length ? { mode: 'plain', source: 'lrclib', lines } : null;
}

export function lyricsFromRecord(record: LrclibRecord): LyricsResult {
  if (record.instrumental) return { status: 'instrumental' };
  const fromFile = record.lyricsfile ? parseLyricsfile(record.lyricsfile) : null;
  const synced = record.syncedLyrics ? parseLrc(record.syncedLyrics) : null;
  const best =
    fromFile && fromFile.mode !== 'plain' ? fromFile : (synced ?? fromFile ?? (record.plainLyrics ? parsePlain(record.plainLyrics) : null));
  return best ? { status: 'found', id: record.id, lyrics: best } : { status: 'none' };
}

class LookupError extends Error {}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
    if (response.status === 404) return null;
    if (response.ok) return (await response.json()) as T;
    if (response.status >= 500 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      continue;
    }
    throw new LookupError(`Lyrics lookup failed (${response.status})`);
  }
}

function rank(record: LrclibRecord, duration: number): number {
  let score = 0;
  if (record.instrumental) score -= 100;
  if (record.hasWordSync) score += 40;
  if (record.syncedLyrics) score += 20;
  if (record.plainLyrics) score += 5;
  if (duration > 0 && record.duration) {
    const gap = Math.abs(record.duration - duration);
    score += gap <= 2 ? 15 : gap <= 5 ? 8 : gap <= 10 ? 0 : -50;
  }
  return score;
}

async function findLrclib(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsResult> {
  const usable = (item: LrclibRecord | null): item is LrclibRecord =>
    !!item && !!(item.instrumental || item.syncedLyrics || item.lyricsfile || item.plainLyrics);
  let failed = false;
  let record: LrclibRecord | null = null;

  const attempt = async (work: () => Promise<LrclibRecord | null>) => {
    try {
      record = await work();
    } catch (err) {
      if (signal?.aborted) throw err;
      failed = true;
    }
  };

  const candidates = lookupCandidates(query.title, query.artist).slice(0, 4);
  for (const [index, candidate] of candidates.entries()) {
    const params = new URLSearchParams({ track_name: candidate.title });
    if (candidate.artist) params.set('artist_name', candidate.artist);

    if (candidate.artist) {
      const exact = new URLSearchParams(params);
      if (query.album && index === candidates.length - 1) exact.set('album_name', query.album);
      if (query.duration > 0) exact.set('duration', String(Math.round(query.duration)));
      await attempt(async () => {
        const found = await getJson<LrclibRecord>(`${BASE}/get?${exact}`, signal);
        return usable(found) ? found : null;
      });
      if (record) break;
    }

    await attempt(async () => {
      const results = (await getJson<LrclibRecord[]>(`${BASE}/search?${params}`, signal)) ?? [];
      const top = results.filter(usable).sort((a, b) => rank(b, query.duration) - rank(a, query.duration))[0];
      return top && rank(top, query.duration) > -40 ? top : null;
    });
    if (record) break;
  }

  if (!record) {
    const free = candidates[0]?.title;
    if (free) {
      await attempt(async () => {
        const results = (await getJson<LrclibRecord[]>(`${BASE}/search?${new URLSearchParams({ q: free })}`, signal)) ?? [];
        const top = results.filter(usable).sort((a, b) => rank(b, query.duration) - rank(a, query.duration))[0];
        return top && rank(top, query.duration) > -40 ? top : null;
      });
    }
  }

  if (!record && failed) throw new LookupError('LRCLIB is not responding');
  return record ? lyricsFromRecord(record) : { status: 'none' };
}

const MODE_RANK: Record<Lyrics['mode'], number> = { word: 3, line: 2, plain: 1 };

/**
 * AMLL first, since its TTML files carry real word timings. LRCLIB covers everything else, and only
 * ever gives word timing when its own record has it. Songs without it are highlighted line by line.
 */
export async function findLyrics(query: LyricsQuery, signal?: AbortSignal): Promise<LyricsResult> {
  const key = cacheKey(query);
  const cached = readCache(key);
  if (cached) return cached;

  let amll: Awaited<ReturnType<typeof findAmll>> = null;
  let amllFailed = false;
  try {
    amll = await findAmll(query, signal);
  } catch (err) {
    if (signal?.aborted) throw err;
    amllFailed = true;
  }

  let result: LyricsResult;
  if (amll?.lyrics.mode === 'word') {
    result = { status: 'found', id: amll.id, lyrics: amll.lyrics };
  } else {
    let lrclib: LyricsResult | null = null;
    try {
      lrclib = await findLrclib(query, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!amll) throw err;
    }
    const amllResult: LyricsResult | null = amll ? { status: 'found', id: amll.id, lyrics: amll.lyrics } : null;
    if (lrclib?.status === 'found' && amllResult?.status === 'found') {
      result = MODE_RANK[amllResult.lyrics.mode] > MODE_RANK[lrclib.lyrics.mode] ? amllResult : lrclib;
    } else {
      result = amllResult ?? lrclib ?? { status: 'none' };
    }
  }

  // A transient AMLL failure should not pin a song to line timing for the cache lifetime.
  if (!(amllFailed && !(result.status === 'found' && result.lyrics.mode === 'word'))) writeCache(key, result);
  return result;
}

/** Index of the line being sung at `time`, or -1 before the first line. */
export function activeLineIndex(lines: LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (lines[mid]!.start <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
