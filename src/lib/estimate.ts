import type { LyricLine, LyricWord, Lyrics } from './lyric-types';

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/;
const SMALL_KANA = /[ぁぃぅぇぉゃゅょゎゕゖァィゥェォャュョヮヵヶーッっ]/;
const PUNCT_ONLY = /^[\s\p{P}\p{S}]+$/u;

/** Words of a line. Chinese and Japanese have no spaces, so every character counts as a word there. */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/\s+/).filter(Boolean)) {
    if (!CJK.test(chunk)) {
      out.push(chunk);
      continue;
    }
    let buffer = '';
    for (const char of Array.from(chunk)) {
      if (CJK.test(char) && !SMALL_KANA.test(char) && buffer) {
        out.push(buffer);
        buffer = char;
      } else {
        buffer += char;
      }
    }
    if (buffer) out.push(buffer);
  }
  return out;
}

const weight = (token: string) => (PUNCT_ONLY.test(token) ? 0.2 : Math.max(1, Array.from(token.replace(/[\p{P}\p{S}]/gu, '')).length));

function estimateLine(line: LyricLine): LyricLine {
  if (line.words.length || line.backing) return line;
  const parts = tokens(line.text);
  if (!parts.length) return line;
  const weights = parts.map(weight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const available = Math.max(0.2, line.end - line.start);
  // A line that waits for a long instrumental gap is not sung the whole time.
  const sung = Math.min(available, total * 0.17 + 1.1);
  let at = line.start;
  const words: LyricWord[] = parts.map((part, index) => {
    const start = at;
    at += (sung * weights[index]!) / total;
    const spaced = index < parts.length - 1 && !(CJK.test(part) && CJK.test(parts[index + 1]!));
    return { text: spaced ? `${part} ` : part, start, end: index === parts.length - 1 ? line.start + sung : at };
  });
  return { ...line, words };
}

/**
 * Spreads each line's words across the line so line-timed lyrics highlight word by word. The result is a
 * guess from word length, not from the recording, so it is marked as estimated.
 */
export function withEstimatedWords(lyrics: Lyrics): Lyrics {
  if (lyrics.mode !== 'line') return lyrics;
  return { ...lyrics, mode: 'word', estimated: true, lines: lyrics.lines.map(estimateLine) };
}
