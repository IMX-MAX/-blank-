export type LyricWord = { text: string; start: number; end: number };

/** Words `from` up to (not including) `to` of a line that share one pronunciation. An empty text has none. */
export type RomanGroup = { from: number; to: number; text: string };

/** Ad-libs and other backing vocals that are sung alongside the main line. */
export type BackingLine = {
  text: string;
  start: number;
  end: number;
  words: LyricWord[];
  roman?: string;
};

export type LyricLine = {
  text: string;
  start: number;
  end: number;
  /** Real per-word timings from the source. Empty when the source only times whole lines. */
  words: LyricWord[];
  /** Pronunciation of the whole line, for lines without word groups. */
  roman?: string;
  /** Pronunciation under each group of words. Covers every word when present. */
  romanGroups?: RomanGroup[];
  /** Backing vocals sung with this line. */
  bg?: BackingLine;
  /** The whole line is an ad-lib, so it is drawn small. */
  backing?: boolean;
  /** Second singer in duets. */
  align?: 'right';
};

export type LyricSource = 'amll' | 'lrclib' | 'ncm';

/**
 * Bumped when lookups improve enough that older saved copies are worth refreshing: 2 added backing vocals and
 * pronunciation to AMLL files, 3 added word timing from NetEase for songs AMLL does not have.
 */
export const LYRICS_VERSION = 3;

export type Lyrics = {
  /** Parser version of the file this came from. */
  v?: number;
  /** word: the source timed every word; line: whole-line timing only; plain: unsynced text */
  mode: 'word' | 'line' | 'plain';
  /** Word timings were spread across a line-timed source rather than read from it. */
  estimated?: boolean;
  source: LyricSource;
  lines: LyricLine[];
};

export type LyricsResult =
  | { status: 'found'; id: number | string; lyrics: Lyrics }
  | { status: 'instrumental' }
  | { status: 'none' };

export type LyricsQuery = {
  title: string;
  artist: string;
  album?: string;
  duration: number;
};
