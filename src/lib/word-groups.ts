/**
 * Word-synced lyrics often time a word in pieces ("o" + "pen ", "switch" + "ing "). Pieces with no space between
 * them are one word on screen: it wraps as a whole and rises as a whole, while each piece still fills by its own
 * timestamps. A group is the half-open range of word indexes [from, to).
 */
export type WordGroup = { from: number; to: number };

/** Scripts written without spaces: every character is its own word, so a line can still wrap anywhere. */
const UNSPACED = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u0e00-\u0e7f]/u;

/** Past this many pieces or characters it is not one word but a source that forgot its spaces. */
const MAX_PIECES = 8;
const MAX_CHARS = 24;

export function groupWords(words: ReadonlyArray<{ text: string }>): WordGroup[] {
  const groups: WordGroup[] = [];
  let from = 0;
  let chars = 0;
  for (let index = 0; index < words.length; index += 1) {
    const text = words[index]!.text;
    if (index > from) {
      const prev = words[index - 1]!.text;
      const joined =
        !/\s$/.test(prev) &&
        !/^\s/.test(text) &&
        !UNSPACED.test(prev.slice(-1)) &&
        !UNSPACED.test(text.charAt(0)) &&
        index - from < MAX_PIECES &&
        chars + text.trim().length <= MAX_CHARS;
      if (!joined) {
        groups.push({ from, to: index });
        from = index;
        chars = 0;
      }
    }
    chars += text.trim().length;
  }
  if (words.length) groups.push({ from, to: words.length });
  return groups;
}

/** How far through a whole word the singing is, 0 to 1: from its first piece's start to its last piece's end. */
export function groupProgress(words: ReadonlyArray<{ start: number; end: number }>, group: WordGroup, time: number): number {
  const start = words[group.from]!.start;
  const end = Math.max(start + 0.05, words[group.to - 1]!.end);
  return Math.min(1, Math.max(0, (time - start) / (end - start)));
}
