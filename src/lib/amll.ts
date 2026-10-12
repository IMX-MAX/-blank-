import { LYRICS_VERSION, type LyricLine, type LyricWord, type Lyrics, type LyricsQuery } from './lyric-types';
import { lookupCandidates } from './titles';

const BASE = 'https://api.amll.dev/api/v1/lyrics';

export type XmlParser = (source: string) => Document;

const browserParser: XmlParser = (source) => new DOMParser().parseFromString(source, 'application/xml');

/** TTML clock values: `27.173`, `3:14.571`, `1:02:03.5`, `12.5s`, `250ms`. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  const offset = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(text);
  if (offset) {
    const amount = Number(offset[1]);
    return offset[2] === 'ms' ? amount / 1000 : offset[2] === 's' ? amount : offset[2] === 'm' ? amount * 60 : amount * 3600;
  }
  const parts = text.split(':');
  if (!parts.length || parts.length > 3) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return numbers.reduce((total, n) => total * 60 + n, 0);
}

const attr = (el: Element, local: string): string | null => {
  for (const item of Array.from(el.attributes)) {
    if ((item.localName ?? item.name.split(':').pop()) === local) return item.value;
  }
  return null;
};

const isElement = (node: Node): node is Element => node.nodeType === 1;
const SKIPPED_ROLES = new Set(['x-translation', 'x-roman', 'x-bg']);

type RawWord = { text: string; start: number; end: number; roman?: string };

function collectWords(parent: Element, out: RawWord[], fallbackStart: number, fallbackEnd: number) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? '';
      if (!text) continue;
      const last = out[out.length - 1];
      if (/^\s+$/.test(text)) {
        if (last && !/\s$/.test(last.text)) last.text += ' ';
      } else {
        out.push({ text, start: fallbackStart, end: fallbackEnd });
      }
      continue;
    }
    if (!isElement(node)) continue;
    const role = attr(node, 'role');
    if (role && SKIPPED_ROLES.has(role)) continue;
    const begin = parseClock(attr(node, 'begin')) ?? fallbackStart;
    const end = parseClock(attr(node, 'end')) ?? fallbackEnd;
    if (Array.from(node.childNodes).some(isElement)) {
      collectWords(node, out, begin, end);
    } else if ((node.textContent ?? '').trim()) {
      out.push({ text: node.textContent ?? '', start: begin, end, roman: attr(node, 'roman')?.trim() || undefined });
    }
  }
}

const roleOf = (el: Element) => attr(el, 'role') ?? '';

/** Whether a node sits inside a span with one of the roles, below the paragraph. */
function insideRole(node: Element, paragraph: Element, roles: Set<string>): boolean {
  for (let current: Node | null = node; current && current !== paragraph; current = current.parentNode) {
    if (isElement(current) && roles.has(roleOf(current))) return true;
  }
  return false;
}

function clockWords(words: RawWord[]): LyricWord[] {
  return words
    .filter((word) => word.text.trim())
    .map((word) => ({ text: word.text.replace(/\s+/g, ' '), start: word.start, end: Math.max(word.start, word.end) }));
}

/** Backing vocals come wrapped in brackets, which the design leaves out. */
function unbracket(words: LyricWord[]): LyricWord[] {
  const copy = words.map((word) => ({ ...word }));
  if (copy.length) {
    copy[0]!.text = copy[0]!.text.replace(/^\s*[(\uFF08]\s*/, '');
    const last = copy[copy.length - 1]!;
    last.text = last.text.replace(/\s*[)\uFF09]\s*$/, '');
  }
  return copy.filter((word) => word.text.trim());
}

const joinText = (words: Array<{ text: string }>) => words.map((word) => word.text).join('').replace(/\s+/g, ' ').trim();

/** Parses an Apple/AMLL style TTML document. Word timing is kept only when the file actually has it. */
export function parseTtml(source: string, parse: XmlParser = browserParser): Lyrics | null {
  let doc: Document;
  try {
    doc = parse(source);
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length) return null;

  const paragraphs = Array.from(doc.getElementsByTagName('p'));
  const agents: string[] = [];
  const raw: Array<LyricLine & { agent: string | null }> = [];
  let anyWords = false;

  for (const p of paragraphs) {
    const begin = parseClock(attr(p, 'begin'));
    const end = parseClock(attr(p, 'end'));
    const agent = attr(p, 'agent');
    const words: RawWord[] = [];
    collectWords(p, words, begin ?? 0, end ?? begin ?? 0);

    const spans = Array.from(p.getElementsByTagName('span'));
    const hasTimedChild = spans.some((span) => !insideRole(span, p, SKIPPED_ROLES) && attr(span, 'begin') !== null);

    const backWords: RawWord[] = [];
    for (const span of spans.filter((item) => roleOf(item) === 'x-bg')) {
      const from = parseClock(attr(span, 'begin')) ?? begin ?? 0;
      const to = parseClock(attr(span, 'end')) ?? end ?? from;
      collectWords(span, backWords, from, to);
    }
    let backing = unbracket(clockWords(backWords));
    const roman = spans
      .filter((span) => roleOf(span) === 'x-roman')
      .map((span) => (span.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');

    let text = joinText(words);
    if (!text && !backing.length) continue;
    let mainWords = words;
    let backingOnly = false;
    if (!text) {
      backingOnly = true;
      text = joinText(backing);
      mainWords = backing.map((word) => ({ ...word }));
      backing = [];
    }

    const lineStart = begin ?? mainWords[0]?.start;
    if (lineStart === undefined) continue;
    const timed: LyricWord[] = hasTimedChild || backingOnly ? clockWords(mainWords) : [];
    if (timed.length) {
      anyWords = true;
      const last = timed[timed.length - 1]!;
      last.text = last.text.trimEnd();
    }
    const kept = mainWords.filter((word) => word.text.trim());
    const romanGroups =
      timed.length && !backingOnly && kept.some((word) => word.roman)
        ? kept.map((word, index) => ({ from: index, to: index + 1, text: word.roman ?? '' }))
        : undefined;
    const lineEnd = Math.max(lineStart + 0.1, end ?? 0, ...timed.map((word) => word.end));
    if (agent && !agents.includes(agent)) agents.push(agent);
    const line: LyricLine & { agent: string | null } = { text, start: lineStart, end: lineEnd, words: timed, agent };
    if (backingOnly) line.backing = true;
    if (backing.length) {
      anyWords = true;
      const backEnd = Math.max(...backing.map((word) => word.end));
      line.bg = { text: joinText(backing), start: backing[0]!.start, end: Math.max(backing[0]!.start + 0.1, backEnd), words: backing };
      if (line.bg.words.length) line.bg.words[line.bg.words.length - 1]!.text = line.bg.words[line.bg.words.length - 1]!.text.trimEnd();
    }
    if (roman && !romanGroups) line.roman = roman;
    if (romanGroups) line.romanGroups = romanGroups;
    raw.push(line);
  }

  if (!raw.length) return null;
  raw.sort((a, b) => a.start - b.start);
  const duet = agents.length > 1;
  const lines: LyricLine[] = raw.map(({ agent, ...line }) => ({
    ...line,
    ...(duet && agent && agent !== agents[0] ? { align: 'right' as const } : {}),
  }));
  return { v: LYRICS_VERSION, mode: anyWords ? 'word' : 'line', source: 'amll', lines };
}

type SearchItem = {
  id: number | string;
  musicNames?: string[];
  artistNames?: string[];
};

export const norm = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function artistTokens(value: string): string[] {
  return value
    .split(/\s*(?:,|&|\/|;|\bfeat\.?|\bft\.?|\bx\b|\band\b|\bwith\b)\s*/i)
    .map(norm)
    .filter(Boolean);
}

/** Higher is better; negative means this is a different song. */
export function scoreItem(item: SearchItem, title: string, artist: string): number {
  const wanted = norm(title);
  const titles = (item.musicNames ?? []).map(norm);
  let score = -1;
  if (titles.includes(wanted)) score = 10;
  else if (titles.some((name) => name && (name.startsWith(`${wanted} `) || wanted.startsWith(`${name} `)))) score = 4;
  if (score < 0) return -1;

  const asked = artistTokens(artist);
  if (!asked.length) return score;
  const have = (item.artistNames ?? []).flatMap(artistTokens);
  const overlap = asked.filter((name) => have.some((other) => other === name || other.includes(name) || name.includes(other)));
  return overlap.length ? score + 5 + overlap.length : -1;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`AMLL lookup failed (${response.status})`);
  return ((await response.json()) as { data?: T }).data ?? null;
}

/**
 * Looks the track up in the AMLL TTML lyrics database. Returns null when there is no matching entry,
 * and throws only when the service itself could not be reached.
 */
export async function findAmll(
  query: LyricsQuery,
  signal?: AbortSignal,
  parse: XmlParser = browserParser,
): Promise<{ id: string; lyrics: Lyrics } | null> {
  const candidates = lookupCandidates(query.title, query.artist).slice(0, 3);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    const key = norm(candidate.title);
    if (!key || tried.has(key)) continue;
    tried.add(key);

    const search = await getJson<{ items?: SearchItem[] }>(
      `${BASE}/search?${new URLSearchParams({ musicName: candidate.title })}`,
      signal,
    );
    const ranked = (search?.items ?? [])
      .map((item) => ({ item, score: scoreItem(item, candidate.title, candidate.artist) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    for (const { item } of ranked) {
      const entry = await getJson<{ lyrics?: string; format?: string }>(`${BASE}/get?${new URLSearchParams({ id: String(item.id) })}`, signal);
      if (!entry?.lyrics) continue;
      const lyrics = parseTtml(entry.lyrics, parse);
      if (!lyrics) continue;
      const lastEnd = lyrics.lines[lyrics.lines.length - 1]!.end;
      // A transcription that runs well past the file is a different recording.
      if (query.duration > 0 && lastEnd > query.duration + 8) continue;
      return { id: String(item.id), lyrics };
    }
  }
  return null;
}
