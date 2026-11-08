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
  /** Translation of the backing vocals, in `Lyrics.translation.lang`. */
  translation?: string;
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
  /** The line in another language, in `Lyrics.translation.lang`. Shown under the pronunciation. */
  translation?: string;
  /** Backing vocals sung with this line. */
  bg?: BackingLine;
  /** The whole line is an ad-lib, so it is drawn small. */
  backing?: boolean;
  /** Second singer in duets. */
  align?: 'right';
};

export type LyricSource = 'amll' | 'lrclib' | 'ncm' | 'apple';

/**
 * What the `translation` of the lines is. `source`: written by the lyrics service; `machine`: Google Translate;
 * `none`: Google Translate was asked and the lyrics are already in `lang`, so there is nothing to translate.
 */
export type TranslationInfo = { lang: string; by: 'source' | 'machine' | 'none' };

/**
 * Bumped when lookups improve enough that older saved copies are worth refreshing: 2 added backing vocals and
 * pronunciation to AMLL files, 3 added word timing from NetEase for songs AMLL does not have, 4 fixed the
 * Apple Music lookup, which missed songs whose album tag differs from the one it knows, 5 added the translations
 * that AMLL, Apple Music and NetEase write.
 */
export const LYRICS_VERSION = 5;

export type Lyrics = {
  /** Parser version of the file this came from. */
  v?: number;
  /** word: the source timed every word; line: whole-line timing only; plain: unsynced text */
  mode: 'word' | 'line' | 'plain';
  /** Word timings were spread across a line-timed source rather than read from it. */
  estimated?: boolean;
  /** Picked by hand from the re-search list, so a newer lookup never replaces it on its own. */
  chosen?: boolean;
  source: LyricSource;
  lines: LyricLine[];
  /** Set when lines carry a `translation`, or when the lyrics were found to need none. */
  translation?: TranslationInfo;
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

/** What a source says it matched, when it says anything. Duration is in seconds. */
export type MatchInfo = { title?: string; artist?: string; duration?: number };

/** One lyrics file found by one source. */
export type LyricsHit = { id: string; lyrics: Lyrics; meta?: MatchInfo };
