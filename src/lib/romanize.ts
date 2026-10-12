import type { BackingLine, LyricLine, LyricWord, Lyrics, RomanGroup } from './lyric-types';

const HANGUL = /[\uAC00-\uD7A3]/;
const KANA = /[\u3041-\u3096\u30A1-\u30FA\u30FC]/;
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

export const hasHangul = (text: string) => HANGUL.test(text);
export const hasKana = (text: string) => KANA.test(text);
export const hasHan = (text: string) => HAN.test(text);

/* ---------- Korean: Revised Romanization of how the words are pronounced ---------- */

const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const INITIAL_ROMAN: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's',
  ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
};
const VOWELS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const TAILS: string[][] = [
  [], ['ㄱ'], ['ㄲ'], ['ㄱ', 'ㅅ'], ['ㄴ'], ['ㄴ', 'ㅈ'], ['ㄴ', 'ㅎ'], ['ㄷ'], ['ㄹ'], ['ㄹ', 'ㄱ'], ['ㄹ', 'ㅁ'],
  ['ㄹ', 'ㅂ'], ['ㄹ', 'ㅅ'], ['ㄹ', 'ㅌ'], ['ㄹ', 'ㅍ'], ['ㄹ', 'ㅎ'], ['ㅁ'], ['ㅂ'], ['ㅂ', 'ㅅ'], ['ㅅ'], ['ㅆ'],
  ['ㅇ'], ['ㅈ'], ['ㅊ'], ['ㅋ'], ['ㅌ'], ['ㅍ'], ['ㅎ'],
];
const REPRESENTATIVE: Record<string, string> = {
  ㄱ: 'ㄱ', ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㄴ: 'ㄴ', ㄷ: 'ㄷ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ',
  ㄹ: 'ㄹ', ㅁ: 'ㅁ', ㅂ: 'ㅂ', ㅍ: 'ㅂ', ㅇ: 'ㅇ',
};
const FINAL_ROMAN: Record<string, string> = { ㄱ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅇ: 'ng' };
const ASPIRATED: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅈ: 'ㅊ', ㅂ: 'ㅍ' };
const NASALISED: Record<string, string> = { ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' };
const VOWEL_I = 20;

type Syllable = { initial: string; vowel: number; tail: string[]; lateral: boolean };

function syllableOf(char: string): Syllable {
  const code = char.charCodeAt(0) - 0xac00;
  return {
    initial: INITIALS[Math.floor(code / 588)]!,
    vowel: Math.floor((code % 588) / 28),
    tail: [...TAILS[code % 28]!],
    lateral: false,
  };
}

const CLUSTER_REPRESENTATIVE: Record<string, string> = {
  ㄱㅅ: 'ㄱ', ㄴㅈ: 'ㄴ', ㄹㄱ: 'ㄱ', ㄹㅁ: 'ㅁ', ㄹㅂ: 'ㄹ', ㄹㅅ: 'ㄹ', ㄹㅌ: 'ㄹ', ㄹㅍ: 'ㅂ', ㅂㅅ: 'ㅂ',
};

/** The sound changes where one syllable's final consonant meets the next syllable's first. */
function joinAt(current: Syllable, next: Syllable) {
  if (!current.tail.length) return;

  if (current.tail[current.tail.length - 1] === 'ㅎ') {
    current.tail.pop();
    if (next.initial !== 'ㅇ') {
      if (ASPIRATED[next.initial] && next.initial !== 'ㅂ') next.initial = ASPIRATED[next.initial]!;
      else if (!current.tail.length) current.tail = ['ㄷ'];
    }
    if (!current.tail.length) return;
  }

  if (next.initial === 'ㅇ') {
    if (current.tail.length === 1 && current.tail[0] === 'ㅇ') return;
    let moved = current.tail.length === 2 ? current.tail.pop()! : current.tail.shift()!;
    if (next.vowel === VOWEL_I && moved === 'ㄷ') moved = 'ㅈ';
    else if (next.vowel === VOWEL_I && moved === 'ㅌ') moved = 'ㅊ';
    next.initial = moved;
    return;
  }

  if (next.initial === 'ㅎ' && current.tail.length === 1 && ASPIRATED[current.tail[0]!]) {
    next.initial = ASPIRATED[current.tail[0]!]!;
    current.tail = [];
    return;
  }

  const rep = current.tail.length === 2 ? CLUSTER_REPRESENTATIVE[current.tail.join('')]! : REPRESENTATIVE[current.tail[0]!]!;
  current.tail = [rep];

  if (next.initial === 'ㄹ' && (rep === 'ㅁ' || rep === 'ㅇ')) next.initial = 'ㄴ';
  else if (next.initial === 'ㄹ' && NASALISED[rep]) {
    next.initial = 'ㄴ';
    current.tail = [NASALISED[rep]!];
  } else if (rep === 'ㄴ' && next.initial === 'ㄹ') {
    current.tail = ['ㄹ'];
    next.lateral = true;
  } else if (rep === 'ㄹ' && next.initial === 'ㄴ') {
    next.initial = 'ㄹ';
    next.lateral = true;
  } else if (rep === 'ㄹ' && next.initial === 'ㄹ') {
    next.lateral = true;
  } else if (NASALISED[rep] && (next.initial === 'ㄴ' || next.initial === 'ㅁ')) {
    current.tail = [NASALISED[rep]!];
  }
}

/** Romanises a run of Hangul syllables the way it is spoken, with the sound changes between syllables. */
function romanizeSyllables(chars: string[]): string {
  const syllables = chars.map(syllableOf);
  for (let i = 0; i < syllables.length - 1; i += 1) joinAt(syllables[i]!, syllables[i + 1]!);
  return syllables
    .map((syllable, index) => {
      const initial =
        syllable.initial === 'ㄹ' ? (syllable.lateral || (index > 0 && syllables[index - 1]!.tail.length) ? 'l' : 'r') : INITIAL_ROMAN[syllable.initial]!;
      const tail = syllable.tail.length ? (FINAL_ROMAN[syllable.tail[0]!] ?? '') : '';
      return initial + VOWELS[syllable.vowel] + tail;
    })
    .join('');
}

/** Revised Romanization of Korean text. Anything that is not Hangul is kept as it is. */
export function romanizeHangul(text: string): string {
  let out = '';
  let run: string[] = [];
  const flush = () => {
    if (run.length) out += romanizeSyllables(run);
    run = [];
  };
  for (const char of text) {
    if (HANGUL.test(char)) run.push(char);
    else {
      flush();
      out += char;
    }
  }
  flush();
  return out;
}

/* ---------- Japanese kana ---------- */

const KANA_TABLE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po', ゔ: 'vu',
};
const SMALL_VOWEL: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' };
const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' };

const toHiragana = (char: string) => {
  const code = char.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
};

export type KanaSlot = { roman: string; latin: boolean };

/**
 * Hepburn romaji for each character of the text: a small kana is merged into the character before it, so
 * its own slot is empty. Latin letters and spaces keep their place. Null when the text has kanji.
 */
export function kanaPerChar(text: string): KanaSlot[] | null {
  if (HAN.test(text)) return null;
  const chars = [...text];
  const out: KanaSlot[] = chars.map(() => ({ roman: '', latin: false }));
  const SOKUON = '\u0001';
  let previous = -1;
  chars.forEach((raw, index) => {
    const char = toHiragana(raw);
    const table = KANA_TABLE[char];
    if (table !== undefined) {
      out[index]!.roman = table;
      previous = index;
    } else if (SMALL_Y[char] && previous >= 0) {
      const base = out[previous]!.roman;
      const vowel = SMALL_Y[char]!;
      out[previous]!.roman = /(shi|chi|ji)$/.test(base) ? base.slice(0, -1) + vowel : `${base.slice(0, -1)}y${vowel}`;
    } else if (SMALL_VOWEL[char] && previous >= 0) {
      const base = out[previous]!.roman;
      out[previous]!.roman = base === 'u' ? `w${SMALL_VOWEL[char]}` : base.slice(0, -1) + SMALL_VOWEL[char];
    } else if (char === 'っ') {
      out[index]!.roman = SOKUON;
      previous = index;
    } else if (raw === 'ー') {
      let at = previous;
      while (at >= 0 && (out[at]!.roman === '' || out[at]!.roman === SOKUON)) at -= 1;
      out[index]!.roman = (at >= 0 ? /[aeiou]$/.exec(out[at]!.roman)?.[0] : undefined) ?? '';
    } else if (/[\p{L}\p{N}]/u.test(raw) || /\s/.test(raw)) {
      out[index] = { roman: raw, latin: true };
      previous = -1;
    }
  });
  for (let index = 0; index < out.length; index += 1) {
    if (out[index]!.roman !== SOKUON) continue;
    let next = index + 1;
    while (next < out.length && out[next]!.roman === '') next += 1;
    const following = out[next]?.latin ? '' : (out[next]?.roman ?? '');
    const head = /^(ch|sh|ts)/.test(following) ? (following.startsWith('ch') ? 't' : following[0]!) : (following[0] ?? '');
    out[index]!.roman = /^[bcdfghjklmnpqrstvwxyz]/.test(head) ? head : '';
  }
  return out;
}

/** Romaji for kana text, a space between each sound the way AMLL's own files write it. */
export function romanizeKanaLine(text: string): string | null {
  const slots = kanaPerChar(text);
  if (!slots) return null;
  const parts: string[] = [];
  let latin = '';
  for (const slot of slots) {
    if (slot.latin) {
      latin += slot.roman;
      continue;
    }
    if (latin.trim()) parts.push(latin.trim());
    latin = '';
    if (slot.roman) parts.push(slot.roman);
  }
  if (latin.trim()) parts.push(latin.trim());
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/* ---------- Chinese ---------- */

type PinyinFn = (text: string, options: { type: 'array'; toneType: 'symbol'; nonZh: 'consecutive' }) => string[];
let pinyinLoaded: Promise<PinyinFn | null> | null = null;

function loadPinyin(): Promise<PinyinFn | null> {
  pinyinLoaded ??= import('pinyin-pro').then((module) => module.pinyin as unknown as PinyinFn).catch(() => null);
  return pinyinLoaded;
}

function pinyinOf(pinyin: PinyinFn, text: string): string {
  return pinyin(text, { type: 'array', toneType: 'symbol', nonZh: 'consecutive' })
    .map((part) => part.trim())
    .filter((part) => part && !/^[\p{P}\p{S}]+$/u.test(part))
    .join(' ');
}

/* ---------- Lyrics ---------- */

type Reading = (text: string) => string;

/** The words of a line split into groups that end at a space, which is how Korean is read. */
function spaceGroups(words: LyricWord[]): Array<[number, number]> {
  const groups: Array<[number, number]> = [];
  let from = 0;
  words.forEach((word, index) => {
    if (/\s$/.test(word.text) || index === words.length - 1) {
      groups.push([from, index + 1]);
      from = index + 1;
    }
  });
  return groups;
}

const wordText = (words: LyricWord[], from: number, to: number) =>
  words
    .slice(from, to)
    .map((word) => word.text)
    .join('')
    .trim();

function groupsFor(words: LyricWord[], ranges: Array<[number, number]>, read: Reading): RomanGroup[] | undefined {
  const groups = ranges.map(([from, to]) => ({ from, to, text: read(wordText(words, from, to)) }));
  return groups.some((group) => group.text) ? groups : undefined;
}

function enrichLine(line: LyricLine, pinyin: PinyinFn | null, kanaSong: boolean): LyricLine {
  if (line.roman || line.romanGroups) return line;
  const text = line.text;
  const korean = hasHangul(text);
  const japanese = !korean && hasKana(text);
  const chinese = !korean && !japanese && !kanaSong && hasHan(text) && pinyin !== null;
  if (!korean && !japanese && !chinese) return line;

  if (korean) {
    const read: Reading = (value) => (hasHangul(value) ? romanizeHangul(value) : '');
    if (line.words.length) {
      const romanGroups = groupsFor(line.words, spaceGroups(line.words), read);
      return romanGroups ? { ...line, romanGroups } : line;
    }
    return { ...line, roman: text.split(/\s+/).map(read).filter(Boolean).join(' ') || undefined };
  }

  if (japanese) {
    if (hasHan(text)) return line;
    if (line.words.length) {
      const joined = line.words.map((word) => word.text).join('');
      const slots = kanaPerChar(joined);
      if (!slots) return line;
      let offset = 0;
      const romanGroups = line.words.map((word, index) => {
        const length = [...word.text].length;
        const part = slots.slice(offset, offset + length).map((slot) => slot.roman).join('').trim();
        offset += length;
        return { from: index, to: index + 1, text: part };
      });
      return romanGroups.some((group) => group.text) ? { ...line, romanGroups } : line;
    }
    return { ...line, roman: romanizeKanaLine(text) || undefined };
  }

  if (!pinyin) return line;
  if (line.words.length) {
    const romanGroups = groupsFor(
      line.words,
      line.words.map((_, index) => [index, index + 1] as [number, number]),
      (value) => (hasHan(value) ? pinyinOf(pinyin, value) : ''),
    );
    return romanGroups ? { ...line, romanGroups } : line;
  }
  return { ...line, roman: pinyinOf(pinyin, text) || undefined };
}

function enrichBacking(bg: BackingLine, pinyin: PinyinFn | null, kanaSong: boolean): BackingLine {
  if (bg.roman) return bg;
  const text = bg.text;
  let roman = '';
  if (hasHangul(text)) roman = text.split(/\s+/).map((part) => (hasHangul(part) ? romanizeHangul(part) : part)).join(' ');
  else if (hasKana(text)) roman = hasHan(text) ? '' : (romanizeKanaLine(text) ?? '');
  else if (hasHan(text) && !kanaSong && pinyin) roman = pinyinOf(pinyin, text);
  return roman ? { ...bg, roman } : bg;
}

/**
 * Adds a reading under Korean, Japanese and Chinese lyrics that came without one: Revised Romanization,
 * Hepburn romaji and pinyin. Kanji in Japanese lines have no reading here, so those lines are left alone.
 */
export async function addPronunciation(lyrics: Lyrics): Promise<Lyrics> {
  const all = lyrics.lines.flatMap((line) => (line.bg ? [line.text, line.bg.text] : [line.text]));
  const kanaSong = all.some(hasKana);
  const wantsPinyin = !kanaSong && all.some((text) => hasHan(text) && !hasHangul(text));
  if (!all.some((text) => hasHangul(text) || hasKana(text) || hasHan(text))) return lyrics;
  const pinyin = wantsPinyin ? await loadPinyin() : null;
  return {
    ...lyrics,
    lines: lyrics.lines.map((line) => {
      const next = enrichLine(line, pinyin, kanaSong);
      return next.bg ? { ...next, bg: enrichBacking(next.bg, pinyin, kanaSong) } : next;
    }),
  };
}
