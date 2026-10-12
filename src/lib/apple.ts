import { parseTtml, type XmlParser } from './amll';
import { HttpError, textFetcher, type TextFetch } from './http';
import type { Lyrics, LyricsQuery } from './lyric-types';
import { lookupCandidates } from './titles';

const ENDPOINT = 'https://lyrics-api.boidu.dev/getLyrics';

export const defaultFetch: TextFetch = textFetcher();

/** The service allows only a handful of lookups in a short while, so after a refusal it is left alone for a bit. */
const COOLDOWN_MS = 90_000;
let pausedUntil = 0;

export const applePaused = () => Date.now() < pausedUntil;
export const resetApplePause = () => {
  pausedUntil = 0;
};

/**
 * Looks the track up in a community service that serves Apple Music's word-timed TTML (with backing vocals,
 * duets and, for Korean, Japanese and Chinese, a reading of every line). Returns null when it has nothing
 * and throws only when the service could not be reached.
 */
export async function findApple(
  query: LyricsQuery,
  signal?: AbortSignal,
  get: TextFetch = defaultFetch,
  parse?: XmlParser,
): Promise<{ id: string; lyrics: Lyrics } | null> {
  if (applePaused()) throw new HttpError(429, 'Apple Music lookups are paused for a moment');
  const candidates = lookupCandidates(query.title, query.artist)
    .filter((item) => item.artist)
    .slice(0, 2);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.title}|${candidate.artist}`.toLowerCase();
    if (tried.has(key)) continue;
    tried.add(key);
    // The album tag is left out on purpose: the service answers from a cache keyed on song and artist, and an
    // album it does not know makes it treat the song as new and refuse.
    const ask = async (withLength: boolean): Promise<string | null> => {
      const params = new URLSearchParams({ s: candidate.title, a: candidate.artist });
      if (withLength && query.duration > 0) params.set('d', String(Math.round(query.duration)));
      try {
        return await get(`${ENDPOINT}?${params}`, signal);
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          pausedUntil = Date.now() + COOLDOWN_MS;
          throw error;
        }
        // Without an API key the service only answers for songs it already has, and says 401 for the rest.
        if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return '';
        throw error;
      }
    };
    // A 404 with a length means it knows the song but only in a version of a different length. The length of
    // whatever comes back is checked below.
    let body = await ask(true);
    if (body === null && query.duration > 0) body = await ask(false);
    if (!body) continue;
    let ttml: string | undefined;
    try {
      ttml = (JSON.parse(body) as { ttml?: string }).ttml;
    } catch {
      continue;
    }
    if (!ttml) continue;
    const lyrics = parseTtml(ttml, parse);
    if (!lyrics || lyrics.mode !== 'word') continue;
    const lastEnd = lyrics.lines[lyrics.lines.length - 1]!.end;
    if (query.duration > 0 && lastEnd > query.duration + 8) continue;
    return { id: `apple:${key}`, lyrics: { ...lyrics, source: 'apple' } };
  }
  return null;
}
