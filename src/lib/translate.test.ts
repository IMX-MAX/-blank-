import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { parseTtml } from './amll';
import type { TextFetch } from './http';
import type { Lyrics } from './lyric-types';
import { attachTranslations, parseReadings, parseYrc } from './ncm';
import {
  batches,
  hasTranslationFor,
  languageKey,
  machineTranslate,
  needsMachineTranslation,
  parseDictChrome,
  parseGtx,
  sameLanguage,
} from './translate';

const parse = (source: string) => new DOMParser().parseFromString(source, 'application/xml') as unknown as Document;

const AMLL = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><head><metadata/></head><body><div>
<p begin="1.372" end="2.705" itunes:key="L1" ttm:agent="v1"><span begin="1.372" end="1.749">夢</span><span begin="1.749" end="2.524">ならば</span><span ttm:role="x-translation" xml:lang="zh-CN">如果只是一场梦</span><span ttm:role="x-translation" xml:lang="en">If only it were a dream</span><span ttm:role="x-roman">yu me na ra ba</span></p>
<p begin="3.0" end="5.0" itunes:key="L2" ttm:agent="v1"><span begin="3.0" end="4.0">どれほど</span><span ttm:role="x-bg"><span begin="4.0" end="5.0">(ああ)</span><span ttm:role="x-translation" xml:lang="en">(ah)</span></span><span ttm:role="x-translation" xml:lang="en">How much</span></p>
<p begin="6.0" end="7.0" itunes:key="L3" ttm:agent="v1"><span begin="6.0" end="7.0">Yeah</span></p>
</div></body></tt>`;

test('AMLL inline translations go on their lines, in the reader\'s language when the file has it', () => {
  const lyrics = parseTtml(AMLL, parse, 'en-GB')!;
  assert.deepEqual(lyrics.translation, { lang: 'en', by: 'source' });
  const [first, second, third] = lyrics.lines;
  assert.equal(first!.translation, 'If only it were a dream');
  assert.equal(first!.roman, 'yu me na ra ba');
  assert.equal(first!.text, '夢ならば', 'translation text is not sung');
  assert.equal(second!.text, 'どれほど');
  assert.equal(second!.translation, 'How much');
  assert.equal(second!.bg?.text, 'ああ');
  assert.equal(second!.bg?.translation, 'ah');
  assert.equal(third!.translation, undefined);

  const chinese = parseTtml(AMLL, parse, 'zh-Hans-CN')!;
  assert.deepEqual(chinese.translation, { lang: 'zh-CN', by: 'source' });
  assert.equal(chinese.lines[0]!.translation, '如果只是一场梦');
});

const APPLE = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="ko"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation type="subtitle" xml:lang="ja"><text for="L1">勇敢な私</text></translation><translation type="replacement" xml:lang="en"><text for="L1">Brave me <span xmlns="http://www.w3.org/ns/ttml" ttm:role="x-bg">(yeah)</span></text><text for="L2">No</text></translation></translations></iTunesMetadata></metadata></head><body><div>
<p begin="10.357" end="11.966" itunes:key="L1" ttm:agent="v1"><span begin="10.357" end="11.310">용감한</span> <span begin="11.310" end="11.621">내</span><span ttm:role="x-bg"><span begin="11.7" end="11.9">(yeah)</span></span></p>
<p begin="12.809" end="13.5" itunes:key="L2" ttm:agent="v1"><span begin="12.809" end="13.155">No</span></p>
</div></body></tt>`;

test('Apple Music <translations> blocks are matched to lines by key, picking the reader\'s language', () => {
  const lyrics = parseTtml(APPLE, parse, 'en-GB')!;
  assert.deepEqual(lyrics.translation, { lang: 'en', by: 'source' });
  assert.equal(lyrics.lines[0]!.translation, 'Brave me');
  assert.equal(lyrics.lines[0]!.bg?.translation, 'yeah');
  assert.equal(lyrics.lines[1]!.translation, 'No');
  const japanese = parseTtml(APPLE, parse, 'ja-JP')!;
  assert.equal(japanese.translation?.lang, 'ja');
  assert.equal(japanese.lines[0]!.translation, '勇敢な私');
  assert.equal(japanese.lines[1]!.translation, undefined);
});

test('a file without translations has none', () => {
  const plain = AMLL.replace(/<span ttm:role="x-translation"[^>]*>[^<]*<\/span>/g, '');
  const lyrics = parseTtml(plain, parse, 'en')!;
  assert.equal(lyrics.translation, undefined);
  assert.ok(lyrics.lines.every((line) => !line.translation && !line.bg?.translation));
});

const YRC = [
  '[1000,2000](1000,500,0)Is (1500,400,0)this (1900,1100,0)real',
  '[4000,1500](4000,700,0)Sin (4700,800,0)city',
  '[7000,1000](7000,1000,0)Yeah',
].join('\n');

test('NetEase tlyric attaches to the line with the nearest timestamp; gaps and "//" rows are skipped', () => {
  const tlyric = '[00:00.000]\n[00:01.310]这是真的吗\n[00:04.500]罪恶之城\n[00:07.000]//\n[00:30.000]很远的一行';
  const lyrics = attachTranslations(parseYrc(YRC)!, parseReadings(tlyric));
  assert.deepEqual(lyrics.translation, { lang: 'zh-CN', by: 'source' });
  assert.deepEqual(
    lyrics.lines.map((line) => line.translation),
    ['这是真的吗', '罪恶之城', undefined],
  );
});

test('a second translation list only fills the lines the first one missed', () => {
  const exact = attachTranslations(parseYrc(YRC)!, parseReadings('[00:01.000]第一'));
  const filled = attachTranslations(exact, parseReadings('[00:01.100]不该替换\n[00:04.100]第二'));
  assert.deepEqual(filled.lines.map((line) => line.translation), ['第一', '第二', undefined]);
  assert.equal(attachTranslations(parseYrc(YRC)!, parseReadings('[00:00.000]//\n')).translation, undefined);
});

test('language tags compare by language, but Chinese keeps its script', () => {
  assert.ok(sameLanguage('en-GB', 'en'));
  assert.ok(sameLanguage('en_US', 'EN-gb'));
  assert.ok(!sameLanguage('en', 'es'));
  assert.equal(languageKey('zh-CN'), 'zh-hans');
  assert.equal(languageKey('zh-Hant-TW'), 'zh-hant');
  assert.ok(!sameLanguage('zh-TW', 'zh-CN'));
  assert.ok(sameLanguage('zh', 'zh-Hans'));
});

const song = (texts: string[], extra: Partial<Lyrics> = {}): Lyrics => ({
  v: 5,
  mode: 'line',
  source: 'lrclib',
  lines: texts.map((text, index) => ({ text, start: index * 2, end: index * 2 + 2, words: [] })),
  ...extra,
});

test('a source translation only counts when it is in the reader\'s language', () => {
  const zh = song(['사랑해'], { translation: { lang: 'zh-CN', by: 'source' } });
  zh.lines[0]!.translation = '我爱你';
  assert.equal(hasTranslationFor(zh, 'en-GB'), false);
  assert.equal(needsMachineTranslation(zh, 'en-GB'), true);
  assert.equal(hasTranslationFor(zh, 'zh-Hans'), true);
  assert.equal(needsMachineTranslation(zh, 'zh-CN'), false);
  assert.equal(needsMachineTranslation(song(['Hello'], { translation: { lang: 'en', by: 'none' } }), 'en-GB'), false);
  assert.equal(needsMachineTranslation(song(['Hello'], { translation: { lang: 'en', by: 'none' } }), 'fr'), true);
});

test('Google answers are read in both shapes', () => {
  assert.deepEqual(parseDictChrome('[["love you","ko"],["I love you","en"]]', 2), [
    { text: 'love you', lang: 'ko' },
    { text: 'I love you', lang: 'en' },
  ]);
  assert.deepEqual(parseDictChrome('["love you","ko"]', 1), [{ text: 'love you', lang: 'ko' }]);
  assert.equal(parseDictChrome('[["a","ko"]]', 2), null);
  assert.equal(parseDictChrome('<html>', 1), null);
  assert.deepEqual(parseGtx('[[["I love you\\n","사랑해\\n"],["I miss you","보고 싶어"]],null,"ko"]', 2), [
    { text: 'I love you', lang: 'ko' },
    { text: 'I miss you', lang: 'ko' },
  ]);
  assert.equal(parseGtx('[[["only one line","x"]],null,"ko"]', 2), null);
});

test('long songs are sent in several requests that each stay under the limit', () => {
  const lines = Array.from({ length: 40 }, (_, index) => `라인 번호 ${index} 사랑해 보고 싶어`);
  const parts = batches(lines, 600);
  assert.ok(parts.length > 1);
  assert.deepEqual(parts.flat(), lines);
  for (const part of parts) assert.ok(part.map((text) => encodeURIComponent(text).length + 3).reduce((a, b) => a + b) <= 600 || part.length === 1);
});

test('machine translation fills lines not in the reader\'s language and is marked as such', async () => {
  const calls: string[] = [];
  const get: TextFetch = async (url) => {
    calls.push(url);
    const qs = new URL(url).searchParams.getAll('q');
    return JSON.stringify(qs.map((q) => (q === '사랑해' ? ['I love you', 'ko'] : q === '보고 싶어' ? ['I miss you', 'ko'] : [q, 'en'])));
  };
  const out = await machineTranslate(song(['사랑해', 'Oh baby', '보고 싶어', '사랑해']), 'en-GB', get);
  assert.equal(calls.length, 1, 'one request; repeated lines are asked once');
  assert.equal(new URL(calls[0]!).searchParams.get('tl'), 'en');
  assert.deepEqual(out.translation, { lang: 'en-GB', by: 'machine' });
  assert.deepEqual(out.lines.map((line) => line.translation), ['I love you', undefined, 'I miss you', 'I love you']);
});

test('lyrics mostly in the reader\'s language are marked as needing no translation, and old ones are dropped', async () => {
  const get: TextFetch = async (url) => JSON.stringify(new URL(url).searchParams.getAll('q').map((q) => [q.toUpperCase(), 'en']));
  const input = song(['Hello there', 'General Kenobi'], { translation: { lang: 'zh-CN', by: 'source' } });
  input.lines[0]!.translation = '你好';
  const out = await machineTranslate(input, 'en-GB', get);
  assert.deepEqual(out.translation, { lang: 'en-GB', by: 'none' });
  assert.ok(out.lines.every((line) => !line.translation));
  assert.equal(needsMachineTranslation(out, 'en-GB'), false);
});

test('when the first Google endpoint fails, the gtx endpoint is used', async () => {
  const get: TextFetch = async (url) => {
    if (url.includes('clients5')) throw new Error('blocked');
    return JSON.stringify([[['Brave me\n', '용감한 내\n'], ['No', '노']], null, 'ko']);
  };
  const out = await machineTranslate(song(['용감한 내', '노']), 'en', get);
  assert.deepEqual(out.lines.map((line) => line.translation), ['Brave me', 'No']);
});

test('word-timed copies from sources that write translations are looked up again once, hand-picked ones are not', async () => {
  const { isStale } = await import('./lyrics');
  const word = (source: Lyrics['source'], v: number, chosen = false) =>
    isStale({ status: 'found', id: 1, lyrics: { v, mode: 'word', source, lines: [], ...(chosen ? { chosen } : {}) } });
  assert.equal(word('apple', 4), true);
  assert.equal(word('amll', 4), true);
  assert.equal(word('ncm', 4), true);
  assert.equal(word('ncm', 5), false);
  assert.equal(word('lrclib', 4), false);
  assert.equal(word('apple', 4, true), false);
});
