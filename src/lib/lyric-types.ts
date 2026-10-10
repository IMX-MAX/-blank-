export type LyricWord = { text: string; start: number; end: number };

export type LyricLine = {
  text: string;
  start: number;
  end: number;
  /** Real per-word timings from the source. Empty when the source only times whole lines. */
  words: LyricWord[];
  /** Second singer in duets. */
  align?: 'right';
};

export type LyricSource = 'amll' | 'lrclib';

export type Lyrics = {
  /** word: the source timed every word; line: whole-line timing only; plain: unsynced text */
  mode: 'word' | 'line' | 'plain';
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
