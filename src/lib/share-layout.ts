/**
 * Text layout for the lyric share card: wrapping, balancing and sizing, given a way to measure text. Kept apart
 * from the canvas so it can be tested.
 */

/** Width of `text` at font size `size`. */
export type Measure = (text: string, size: number) => number;

/** The most lyric lines that can be shared at once. */
export const SHARE_MAX_LINES = 3;

/** Greedy wrap of one lyric line into rows no wider than `width`. A word wider than the row stays on its own row. */
export function wrap(text: string, width: number, size: number, measure: Measure): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const rows: string[] = [];
  let row = words[0]!;
  for (const word of words.slice(1)) {
    const next = `${row} ${word}`;
    if (measure(next, size) <= width) row = next;
    else {
      rows.push(row);
      row = word;
    }
  }
  rows.push(row);
  return rows;
}

/**
 * Wrap so the rows come out even rather than one long row and a short last word: the narrowest width that still
 * needs no more rows than the full width does.
 */
export function balancedWrap(text: string, width: number, size: number, measure: Measure): string[] {
  const greedy = wrap(text, width, size, measure);
  if (greedy.length < 2) return greedy;
  let low = width * 0.5;
  let high = width;
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    if (wrap(text, mid, size, measure).length <= greedy.length) high = mid;
    else low = mid;
  }
  return wrap(text, high, size, measure);
}

export type FittedLyrics = {
  size: number;
  lineHeight: number;
  /** The rows of each lyric line, in order. */
  blocks: string[][];
  /** The gap between lyric lines, on top of the line height. */
  gap: number;
  height: number;
};

/**
 * The biggest type size (from `max` down to `min`) at which every selected line, wrapped and balanced, fits in the
 * box. Short selections come out big, long ones smaller.
 */
export function fitLyrics(
  lines: readonly string[],
  box: { width: number; height: number },
  measure: Measure,
  options: { max: number; min: number; lineHeight?: number; gap?: number } = { max: 96, min: 40 },
): FittedLyrics {
  const ratio = options.lineHeight ?? 1.16;
  const gapRatio = options.gap ?? 0.42;
  const layout = (size: number): FittedLyrics => {
    const blocks = lines.map((line) => balancedWrap(line, box.width, size, measure)).filter((block) => block.length);
    const lineHeight = Math.round(size * ratio);
    const gap = Math.round(size * gapRatio);
    const rows = blocks.reduce((sum, block) => sum + block.length, 0);
    const height = rows * lineHeight + Math.max(0, blocks.length - 1) * gap;
    return { size, lineHeight, blocks, gap, height };
  };
  for (let size = options.max; size > options.min; size -= 2) {
    const fit = layout(size);
    const widest = Math.max(0, ...fit.blocks.flat().map((row) => measure(row, size)));
    if (fit.height <= box.height && widest <= box.width) return fit;
  }
  return layout(options.min);
}

/** The lines as text to paste: each lyric line, then the song. */
export function lyricsText(lines: readonly string[], title: string, artist: string): string {
  const body = lines.map((line) => line.trim()).filter(Boolean).join('\n');
  const credit = artist.trim() ? `${title} — ${artist}` : title;
  return `${body}\n\n${credit}`;
}

/** Toggling a line in select mode: selection stays in song order and never goes past the cap. */
export function toggleSelection(selected: readonly number[], index: number, max = SHARE_MAX_LINES): { next: number[]; capped: boolean } {
  if (selected.includes(index)) return { next: selected.filter((item) => item !== index), capped: false };
  if (selected.length >= max) return { next: [...selected], capped: true };
  return { next: [...selected, index].sort((a, b) => a - b), capped: false };
}
