import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPronunciation, kanaPerChar, romanizeHangul, romanizeKanaLine } from './romanize';
import type { LyricLine, Lyrics } from './lyric-types';

test('korean is romanised the way it is spoken', () => {
  const cases: Array<[string, string]> = [
    ['설명', 'seolmyeong'],
    ['같이', 'gachi'],
    ['국물', 'gungmul'],
    ['신라', 'silla'],
    ['독립', 'dongnip'],
    ['좋아', 'joa'],
    ['좋고', 'joko'],
    ['많이', 'mani'],
    ['읽다', 'ikda'],
    ['읽어', 'ilgeo'],
    ['괜찮아', 'gwaenchana'],
    ['사랑해', 'saranghae'],
    ['있어', 'isseo'],
    ['알아', 'ara'],
    ['멀리서도', 'meolliseodo'],
    ['붙어', 'buteo'],
    ['앉아', 'anja'],
    ['끌어당겨', 'kkeureodanggyeo'],
    ['초능력처럼', 'choneungnyeokcheoreom'],
  ];
  for (const [hangul, expected] of cases) assert.equal(romanizeHangul(hangul), expected, hangul);
  assert.equal(romanizeHangul('Oh 나나!'), 'Oh nana!');
});

test('kana become hepburn romaji', () => {
  assert.equal(romanizeKanaLine('きみとだけだよ'), 'ki mi to da ke da yo');
  assert.equal(romanizeKanaLine('ゴデハン'), 'go de ha n');
  assert.equal(romanizeKanaLine('チョヌンニョクチョロム'), 'cho nu n nyo ku cho ro mu');
  assert.deepEqual(kanaPerChar('しゃっか')?.map((slot) => slot.roman), ['sha', '', 'k', 'ka']);
  assert.deepEqual(kanaPerChar('コーヒー')?.map((slot) => slot.roman), ['ko', 'o', 'hi', 'i']);
  assert.equal(kanaPerChar('二人だけ'), null);
  assert.equal(romanizeKanaLine('ネ Oh モドゥンゲ'), 'ne Oh mo du n ge');
});

const line = (over: Partial<LyricLine>): LyricLine => ({ text: '', start: 0, end: 4, words: [], ...over });
const lyrics = (lines: LyricLine[]): Lyrics => ({ mode: 'word', source: 'amll', lines });

test('word-synced korean gets one reading per spoken word', async () => {
  const words = [
    { text: '설', start: 0, end: 1 },
    { text: '명 ', start: 1, end: 2 },
    { text: '할', start: 2, end: 3 },
    { text: '수', start: 3, end: 4 },
  ];
  const result = await addPronunciation(lyrics([line({ text: '설명 할수', words })]));
  assert.deepEqual(result.lines[0]!.romanGroups, [
    { from: 0, to: 2, text: 'seolmyeong' },
    { from: 2, to: 4, text: 'halsu' },
  ]);
});

test('line-synced korean and kana lines get a line reading, kanji lines are left alone', async () => {
  const result = await addPronunciation(
    lyrics([line({ text: '저 멀리서도' }), line({ text: 'ゴデハン' }), line({ text: '二人だけの空' }), line({ text: 'my gosh!' })]),
  );
  assert.equal(result.lines[0]!.roman, 'jeo meolliseodo');
  assert.equal(result.lines[1]!.roman, 'go de ha n');
  assert.equal(result.lines[2]!.roman, undefined);
  assert.equal(result.lines[3]!.roman, undefined);
});

test('chinese gets pinyin with tone marks, and readings from the source are kept', async () => {
  const result = await addPronunciation(
    lyrics([
      line({ text: '你好世界' }),
      line({ text: '설명', roman: 'from the file' }),
      line({ text: 'Oh', bg: { text: '하나', start: 0, end: 1, words: [] } }),
    ]),
  );
  assert.equal(result.lines[0]!.roman, 'nǐ hǎo shì jiè');
  assert.equal(result.lines[1]!.roman, 'from the file');
  assert.equal(result.lines[2]!.bg!.roman, 'hana');
});

test('lyrics without cjk come back untouched', async () => {
  const original = lyrics([line({ text: 'Hello there' })]);
  assert.equal(await addPronunciation(original), original);
});
