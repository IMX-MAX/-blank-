import { artistTokens, norm } from './amll';
import { textFetcher, type TextFetch } from './http';
import { LYRICS_VERSION, type BackingLine, type LyricLine, type LyricWord, type Lyrics, type LyricsQuery } from './lyric-types';
import { lookupCandidates } from './titles';

const SEARCH = 'https://music.163.com/api/search/get';
const LYRIC = 'https://music.163.com/api/song/lyric';

export const defaultFetch: TextFetch = textFetcher({ Referer: 'https://music.163.com' });

const WORD = /\((\d+),(\d+),-?\d+\)([^]*?)(?=\(\d+,\d+,-?\d+\)|$)/g;
const CREDIT =
  /^\s*(作词|作曲|编曲|制作人?|混音|母带|录音|监制|和声|吉他|贝斯|鼓|词|曲|lyrics?|words?|music|composer|composed|arranger|arranged|producer|produced|mixed|mastering|mastered|engineer|vocals?)\s*[:：]/i;

/** NetEase's `yrc` format: `[lineStart,lineMs](wordStart,wordMs,0)text(...)`, times in milliseconds. */
export function parseYrc(source: string): Lyrics | null {
  const lines: LyricLine[] = [];
  for (const row of source.split(/\r?\n/)) {
    const head = /^\[(\d+),(\d+)\]/.exec(row);
    if (!head) continue;
    const words: LyricWord[] = [];
    for (const match of row.slice(head[0].length).matchAll(WORD)) {
      const text = match[3]!;
      if (!text) continue;
      const start = Number(match[1]) / 1000;
      words.push({ text, start, end: start + Number(match[2]) / 1000 });
    }
    if (!words.length) continue;
    const text = words.map((word) => word.text).join('').trim();
    if (!text || (lines.length < 10 && CREDIT.test(text))) continue;
    const start = Number(head[1]) / 1000;
    const end = Math.max(words[words.length - 1]!.end, start + Number(head[2]) / 1000);
    lines.push(splitBacking({ text, start: Math.min(start, words[0]!.start), end, words }));
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a.start - b.start);
  return { v: LYRICS_VERSION, mode: 'word', source: 'ncm', lines };
}

const OPEN = /^\s*[(（]/;
const CLOSE = /[)）]\s*$/;
const STRIP_OPEN = /^\s*[(（]\s*/;
const STRIP_CLOSE = /\s*[)）]\s*$/;
const joined = (words: LyricWord[]) => words.map((word) => word.text).join('').trim();

/** NetEase writes ad-libs in brackets at the end of a line, or as a line of their own. */
function splitBacking(line: LyricLine): LyricLine {
  const { words } = line;
  if (!CLOSE.test(words[words.length - 1]!.text)) return line;
  let from = -1;
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (OPEN.test(words[i]!.text)) {
      from = i;
      break;
    }
    if (i < words.length - 1 && CLOSE.test(words[i]!.text)) return line;
  }
  if (from < 0) return line;

  const inner = words
    .slice(from)
    .map((word, index, all) => {
      let text = word.text;
      if (index === 0) text = text.replace(STRIP_OPEN, '');
      if (index === all.length - 1) text = text.replace(STRIP_CLOSE, '');
      return { ...word, text };
    })
    .filter((word) => word.text.trim());
  if (!inner.length) return line;
  const backing: BackingLine = { text: joined(inner), start: inner[0]!.start, end: inner[inner.length - 1]!.end, words: inner };
  if (from === 0) return { ...line, text: backing.text, words: inner, backing: true };

  const main = words.slice(0, from).map((word, index, all) => (index === all.length - 1 ? { ...word, text: word.text.trimEnd() } : word));
  return { ...line, text: joined(main), words: main, bg: backing };
}

const LRC_ROW = /^\[(\d+):(\d+)(?:[.:](\d+))?\](.*)$/;

/** Line-timed readings (`romalrc`) keyed by start time in seconds. */
export function parseReadings(source: string | undefined): Array<{ start: number; text: string }> {
  if (!source) return [];
  const out: Array<{ start: number; text: string }> = [];
  for (const row of source.split(/\r?\n/)) {
    const match = LRC_ROW.exec(row.trim());
    if (!match) continue;
    const text = match[4]!.trim();
    if (!text) continue;
    out.push({ start: Number(match[1]) * 60 + Number(match[2]) + (match[3] ? Number(`0.${match[3]}`) : 0), text });
  }
  return out;
}

/**
 * NetEase's word list sometimes runs words together (`howto`) where the plain lyric has a space. When a line
 * lines up character for character with the plain lyric, the spaces it has are added back.
 */
export function restoreSpaces(lyrics: Lyrics, plain: Array<{ start: number; text: string }>): Lyrics {
  if (!plain.length) return lyrics;
  const lines = lyrics.lines.map((line) => {
    if (line.backing) return line;
    const match = plain.find((row) => Math.abs(row.start - line.start) <= 1);
    if (!match) return line;
    const wanted = Array.from(match.text.normalize('NFKC').replace(/\s+/g, ' ').trim());
    let at = 0;
    const words: LyricWord[] = [];
    for (const [index, word] of line.words.entries()) {
      for (const char of Array.from(word.text.normalize('NFKC').trim())) {
        if (wanted[at] === ' ') at += 1;
        if (wanted[at]?.toLowerCase() !== char.toLowerCase()) return line;
        at += 1;
      }
      const space = wanted[at] === ' ' && index < line.words.length - 1;
      words.push(space && !/\s$/.test(word.text) ? { ...word, text: `${word.text} ` } : word);
    }
    return { ...line, words, text: joined(words) };
  });
  return { ...lyrics, lines };
}

/** Attaches a reading to the line that starts closest to it, when it is close enough to be the same line. */
export function attachReadings(lyrics: Lyrics, readings: Array<{ start: number; text: string }>): Lyrics {
  if (!readings.length) return lyrics;
  const lines = lyrics.lines.map((line) => {
    let best: { start: number; text: string } | null = null;
    for (const reading of readings) {
      if (Math.abs(reading.start - line.start) <= 0.8 && (!best || Math.abs(reading.start - line.start) < Math.abs(best.start - line.start))) best = reading;
    }
    return best ? { ...line, roman: best.text } : line;
  });
  return { ...lyrics, lines };
}

type NcmSong = {
  id: number;
  name?: string;
  duration?: number;
  artists?: Array<{ name?: string }>;
  alias?: string[];
};

/** Higher is better; negative means this is a different recording. */
export function scoreSong(song: NcmSong, title: string, artist: string, duration: number): number {
  const wanted = norm(title);
  const names = [song.name ?? '', ...(song.alias ?? [])].map(norm);
  let score = -1;
  if (names.includes(wanted)) score = 10;
  else if (names.some((name) => name && (name.startsWith(`${wanted} `) || wanted.startsWith(`${name} `)))) score = 4;
  if (score < 0) return -1;

  if (duration > 0 && song.duration) {
    const gap = Math.abs(song.duration / 1000 - duration);
    if (gap > 12) return -1;
    score += gap <= 1.5 ? 4 : gap <= 3.5 ? 2 : gap <= 6 ? 1 : 0;
  }
  const asked = artistTokens(artist);
  if (!asked.length) return score;
  const have = (song.artists ?? []).flatMap((item) => artistTokens(item.name ?? ''));
  const overlap = asked.filter((name) => have.some((other) => other === name || other.includes(name) || name.includes(other)));
  return overlap.length ? score + 5 + overlap.length : -1;
}

const json = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

/**
 * Looks the track up on NetEase Cloud Music, which times most songs word by word. Returns null when nothing
 * matches or the song has only line timing, and throws only when the service could not be reached.
 */
export async function findNcm(
  query: LyricsQuery,
  signal?: AbortSignal,
  get: TextFetch = defaultFetch,
): Promise<{ id: string; lyrics: Lyrics } | null> {
  const candidates = lookupCandidates(query.title, query.artist).slice(0, 2);
  const tried = new Set<number>();
  for (const candidate of candidates) {
    const search = json<{ result?: { songs?: NcmSong[] } }>(
      await get(`${SEARCH}?${new URLSearchParams({ s: `${candidate.title} ${candidate.artist}`.trim(), type: '1', limit: '12', offset: '0' })}`, signal),
    );
    const ranked = (search?.result?.songs ?? [])
      .map((song) => ({ song, score: scoreSong(song, candidate.title, candidate.artist, query.duration) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { song } of ranked) {
      if (tried.has(song.id)) continue;
      tried.add(song.id);
      const entry = json<{ yrc?: { lyric?: string }; lrc?: { lyric?: string }; romalrc?: { lyric?: string } }>(
        await get(`${LYRIC}?${new URLSearchParams({ id: String(song.id), lv: '1', yv: '1', rv: '1' })}`, signal),
      );
      const parsed = entry?.yrc?.lyric ? parseYrc(entry.yrc.lyric) : null;
      if (!parsed) continue;
      const lastEnd = parsed.lines[parsed.lines.length - 1]!.end;
      if (query.duration > 0 && lastEnd > query.duration + 8) continue;
      const spaced = restoreSpaces(parsed, parseReadings(entry?.lrc?.lyric));
      return { id: `ncm:${song.id}`, lyrics: attachReadings(spaced, parseReadings(entry?.romalrc?.lyric)) };
    }
  }
  return null;
}
