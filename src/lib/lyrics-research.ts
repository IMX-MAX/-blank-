import { findAmll } from './amll';
import { findApple, resetApplePause } from './apple';
import { findNcm } from './ncm';
import type { LyricsHit, LyricsQuery, LyricsResult, MatchInfo } from './lyric-types';
import { findLrclibAll } from './lyrics';

export type ResearchSourceId = 'amll' | 'apple' | 'ncm' | 'lrclib';

/** What one source answered: lyrics files (best first), or an instrumental flag. */
export type SourceAnswer = { hits: LyricsHit[]; instrumental?: boolean };

export type ResearchSource = {
  id: ResearchSourceId;
  name: string;
  find: (query: LyricsQuery, signal: AbortSignal) => Promise<SourceAnswer>;
};

const one = (hit: LyricsHit | null): SourceAnswer => ({ hits: hit ? [hit] : [] });

/** Every lyrics provider the app can read, in the order they are listed. */
export const RESEARCH_SOURCES: ResearchSource[] = [
  { id: 'amll', name: 'AMLL', find: async (query, signal) => one(await findAmll(query, signal)) },
  { id: 'apple', name: 'Apple Music', find: async (query, signal) => one(await findApple(query, signal)) },
  { id: 'ncm', name: 'NetEase', find: async (query, signal) => one(await findNcm(query, signal)) },
  {
    id: 'lrclib',
    name: 'LRCLIB',
    find: async (query, signal) => {
      const all = await findLrclibAll(query, signal);
      return {
        hits: all.filter((item): item is LyricsHit => 'lyrics' in item),
        instrumental: all.some((item) => 'instrumental' in item),
      };
    },
  },
];

export type ResearchRow = {
  /** Unique within one search. */
  key: string;
  source: ResearchSourceId;
  name: string;
  /** `none` covers both "nothing matched" and "the source could not be reached". */
  status: 'found' | 'instrumental' | 'none';
  /** Set for `found`: what saving this row stores. */
  result?: Extract<LyricsResult, { status: 'found' }>;
  matched?: MatchInfo;
  /** Why a source has nothing, when it failed rather than simply not knowing the song. */
  error?: string;
};

export const SOURCE_TIMEOUT_MS = 20_000;

function rowsFor(source: ResearchSource, answer: SourceAnswer): ResearchRow[] {
  const rows: ResearchRow[] = answer.hits
    .filter((hit) => hit.lyrics.lines.length > 0)
    .map((hit, index) => ({
      key: `${source.id}:${index}:${hit.id}`,
      source: source.id,
      name: source.name,
      status: 'found' as const,
      result: { status: 'found' as const, id: hit.id, lyrics: hit.lyrics },
      matched: hit.meta,
    }));
  if (!rows.length && answer.instrumental) return [{ key: `${source.id}:instrumental`, source: source.id, name: source.name, status: 'instrumental' }];
  if (!rows.length) return [{ key: `${source.id}:none`, source: source.id, name: source.name, status: 'none' }];
  return rows;
}

function failureRow(source: ResearchSource, error: unknown): ResearchRow {
  const message = error instanceof Error && error.message ? error.message : 'Could not be reached';
  return { key: `${source.id}:none`, source: source.id, name: source.name, status: 'none', error: message };
}

/**
 * Asks every source about the song at the same time. A source that fails, times out or has nothing becomes a
 * "no result" row and never holds up the others. `onSource` is called as each one finishes, so a list can
 * fill in while the slower ones are still working. Resolves with all rows, in source order.
 */
export async function researchLyrics(
  query: LyricsQuery,
  options: {
    signal?: AbortSignal;
    sources?: ResearchSource[];
    timeoutMs?: number;
    onSource?: (source: ResearchSource, rows: ResearchRow[]) => void;
  } = {},
): Promise<ResearchRow[]> {
  const sources = options.sources ?? RESEARCH_SOURCES;
  const timeoutMs = options.timeoutMs ?? SOURCE_TIMEOUT_MS;
  // The user asked for this search, so a source that was resting after a refusal gets one more try.
  resetApplePause();

  const ask = async (source: ResearchSource): Promise<ResearchRow[]> => {
    const controller = new AbortController();
    const stop = () => controller.abort();
    options.signal?.addEventListener('abort', stop);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Took too long'));
        }, timeoutMs);
      });
      const answer = await Promise.race([source.find(query, controller.signal), timeout]);
      return rowsFor(source, answer);
    } catch (error) {
      return [failureRow(source, error)];
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
    }
  };

  const all = await Promise.all(
    sources.map(async (source) => {
      const rows = await ask(source);
      if (!options.signal?.aborted) options.onSource?.(source, rows);
      return rows;
    }),
  );
  return all.flat();
}

/** The first few sung lines, for the picker. */
export function previewLines(lyrics: { lines: Array<{ text: string }> }, count = 3): string[] {
  return lyrics.lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .slice(0, count);
}

export const SYNC_LABEL = { word: 'Word-synced', line: 'Line-synced', plain: 'Plain' } as const;
