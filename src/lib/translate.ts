import { textFetcher, type TextFetch } from './http';
import type { LyricLine, Lyrics, TranslationInfo } from './lyric-types';

/** The language translations are shown in: the phone's own. */
export function deviceLanguage(): string {
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  return lang || 'en';
}

/**
 * A language tag reduced to what matters for reading it: `en-GB` and `en-US` are both `en`, but Chinese keeps
 * its script, since someone who reads Traditional characters wants those and not Simplified.
 */
export function languageKey(tag: string): string {
  const parts = tag.trim().replace(/_/g, '-').toLowerCase().split('-').filter(Boolean);
  const base = parts[0] ?? '';
  if (base === 'zh' || base === 'cmn' || base === 'yue') {
    if (parts.includes('hant') || parts.some((part) => part === 'tw' || part === 'hk' || part === 'mo')) return 'zh-hant';
    return 'zh-hans';
  }
  if (base === 'iw') return 'he';
  if (base === 'in') return 'id';
  if (base === 'jw') return 'jv';
  if (base === 'nb' || base === 'nn' || base === 'no') return 'no';
  if (base === 'fil') return 'tl';
  return base;
}

export const sameLanguage = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && languageKey(a) === languageKey(b);

/** Whether the lines carry a translation that can be shown to someone who reads `target`. */
export function hasTranslationFor(lyrics: Pick<Lyrics, 'translation' | 'lines'>, target: string): boolean {
  const info = lyrics.translation;
  return !!info && info.by !== 'none' && sameLanguage(info.lang, target) && lyrics.lines.some((line) => line.translation);
}

/**
 * Whether Google Translate should be asked for this song: there is no translation in the reader's language yet,
 * and an earlier ask did not already find the lyrics to be in that language. Unsynced and empty lyrics are left alone.
 */
export function needsMachineTranslation(lyrics: Lyrics, target: string): boolean {
  if (!lyrics.lines.some((line) => line.text.trim())) return false;
  if (hasTranslationFor(lyrics, target)) return false;
  const info = lyrics.translation;
  if (info?.by === 'none' && sameLanguage(info.lang, target)) return false;
  return true;
}

/** Google's tag for the reader's language. It knows `zh-CN` and `zh-TW` but not `zh-Hans`. */
export function googleTarget(target: string): string {
  const key = languageKey(target);
  if (key === 'zh-hans') return 'zh-CN';
  if (key === 'zh-hant') return 'zh-TW';
  if (key === 'he') return 'iw';
  return key || 'en';
}

export type MachineLine = { text: string; lang?: string };

/**
 * Reads the answer of `clients5.google.com/translate_a/t` (client `dict-chrome-ex`), one entry per `q`: either
 * `[translation, detectedLanguage]` or, when the source language was given, just the translation.
 */
export function parseDictChrome(body: string, count: number): MachineLine[] | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  // A single `q` sometimes comes back unwrapped: `["text", "ko"]`.
  if (count === 1 && typeof data[0] === 'string') data = [data];
  const rows = data as unknown[];
  if (rows.length !== count) return null;
  const out: MachineLine[] = [];
  for (const row of rows) {
    if (typeof row === 'string') out.push({ text: row });
    else if (Array.isArray(row) && typeof row[0] === 'string') out.push({ text: row[0], lang: typeof row[1] === 'string' ? row[1] : undefined });
    else return null;
  }
  return out;
}

/**
 * Reads the answer of `translate.googleapis.com/translate_a/single` (client `gtx`, `dt=t`) for lines sent as one
 * text joined with newlines: the sentences are joined back and split on the newlines again.
 */
export function parseGtx(body: string, count: number): MachineLine[] | null {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) return null;
  const text = (data[0] as unknown[])
    .map((part) => (Array.isArray(part) && typeof part[0] === 'string' ? part[0] : ''))
    .join('');
  const lang = typeof data[2] === 'string' ? data[2] : undefined;
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length > count && !lines[lines.length - 1]!.trim()) lines.pop();
  if (lines.length !== count) return null;
  return lines.map((line) => ({ text: line.trim(), lang }));
}

const DICT_CHROME = 'https://clients5.google.com/translate_a/t';
const GTX = 'https://translate.googleapis.com/translate_a/single';
/** Keeps each request URL well inside what Google and the native HTTP client accept. */
const MAX_QUERY_CHARS = 4500;

export const defaultFetch: TextFetch = textFetcher();

/** Splits texts into runs whose encoded query stays under the limit. */
export function batches(texts: string[], limit = MAX_QUERY_CHARS): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const text of texts) {
    const cost = encodeURIComponent(text).length + 3;
    if (current.length && size + cost > limit) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(text);
    size += cost;
  }
  if (current.length) out.push(current);
  return out;
}

async function translateBatch(texts: string[], tl: string, get: TextFetch, signal?: AbortSignal): Promise<MachineLine[]> {
  const params = new URLSearchParams({ client: 'dict-chrome-ex', sl: 'auto', tl });
  for (const text of texts) params.append('q', text);
  try {
    const body = await get(`${DICT_CHROME}?${params}`, signal);
    const parsed = body ? parseDictChrome(body, texts.length) : null;
    if (parsed) return parsed;
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  const fallback = new URLSearchParams({ client: 'gtx', sl: 'auto', tl, dt: 't', q: texts.join('\n') });
  const body = await get(`${GTX}?${fallback}`, signal);
  const parsed = body ? parseGtx(body, texts.length) : null;
  if (!parsed) throw new Error('Google Translate gave an answer that could not be read');
  return parsed;
}

const comparable = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Puts machine translations on the lines. Lines Google says are already in the reader's language get none, and
 * when most of the song is, the lyrics are marked as needing no translation so Google is not asked again.
 */
export function applyMachineTranslations(lyrics: Lyrics, texts: string[], answers: MachineLine[], target: string): Lyrics {
  const byText = new Map<string, MachineLine>();
  texts.forEach((text, index) => byText.set(text, answers[index]!));
  const detected = lyrics.lines.map((line) => byText.get(line.text.trim())).filter((answer): answer is MachineLine => !!answer);
  const native = detected.filter((answer) => answer.lang && sameLanguage(answer.lang, target)).length;
  const strip = (line: LyricLine): LyricLine => {
    const { translation: _drop, ...rest } = line;
    if (!rest.bg?.translation) return rest;
    const { translation: _bg, ...bg } = rest.bg;
    return { ...rest, bg };
  };
  if (!detected.length || native / detected.length >= 0.6) {
    return { ...lyrics, lines: lyrics.lines.map(strip), translation: { lang: target, by: 'none' } };
  }
  const translate = (text: string): string | undefined => {
    const answer = byText.get(text.trim());
    if (!answer || !answer.text.trim()) return undefined;
    if (answer.lang && sameLanguage(answer.lang, target)) return undefined;
    if (comparable(answer.text) === comparable(text)) return undefined;
    return answer.text.trim();
  };
  const lines = lyrics.lines.map((line) => {
    const next = strip(line);
    const translation = line.text.trim() ? translate(line.text) : undefined;
    const bgTranslation = next.bg ? translate(next.bg.text) : undefined;
    return {
      ...next,
      ...(translation ? { translation } : {}),
      ...(next.bg && bgTranslation ? { bg: { ...next.bg, translation: bgTranslation } } : {}),
    };
  });
  const info: TranslationInfo = { lang: target, by: 'machine' };
  return { ...lyrics, lines, translation: info };
}

/** Translates every line (and backing vocal) into `target` with Google Translate, which needs no key. */
export async function machineTranslate(lyrics: Lyrics, target: string, get: TextFetch = defaultFetch, signal?: AbortSignal): Promise<Lyrics> {
  const texts = [
    ...new Set(lyrics.lines.flatMap((line) => [line.text, line.bg?.text ?? '']).map((text) => text.trim()).filter(Boolean)),
  ];
  if (!texts.length) return lyrics;
  const tl = googleTarget(target);
  const answers: MachineLine[] = [];
  for (const batch of batches(texts)) answers.push(...(await translateBatch(batch, tl, get, signal)));
  return applyMachineTranslations(lyrics, texts, answers, target);
}
