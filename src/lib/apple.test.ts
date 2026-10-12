import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOMParser } from '@xmldom/xmldom';
import { applePaused, findApple, resetApplePause } from './apple';
import { HttpError, type TextFetch } from './http';

const parse = (source: string) => new DOMParser().parseFromString(source, 'application/xml') as unknown as Document;

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" itunes:timing="Word" xml:lang="ko"><head><metadata><ttm:agent type="person" xml:id="v1"/><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><transliterations><transliteration xml:lang="ko-Latn"><text for="L1"><span begin="10.357" end="11.310" xmlns="http://www.w3.org/ns/ttml">yonggamhan</span> <span begin="11.310" end="11.621" xmlns="http://www.w3.org/ns/ttml">nae</span></text><text for="L2"><span begin="12.809" end="13.155" xmlns="http://www.w3.org/ns/ttml">No</span></text></transliteration></transliterations></iTunesMetadata></metadata></head><body dur="2:11.998"><div><p begin="10.357" end="11.966" itunes:key="L1" ttm:agent="v1"><span begin="10.357" end="10.737">용</span><span begin="10.737" end="11.310">감한</span> <span begin="11.310" end="11.621">내</span></p><p begin="12.809" end="13.5" itunes:key="L2" ttm:agent="v1"><span begin="12.809" end="13.155">No</span></p></div></body></tt>`;

const ok: TextFetch = async () => JSON.stringify({ ttml: TTML });

test('apple lyrics come back word timed, with a reading under each group of words', async () => {
  resetApplePause();
  const found = await findApple({ title: 'NOT CUTE ANYMORE', artist: 'ILLIT', duration: 132 }, undefined, ok, parse);
  assert.ok(found);
  assert.equal(found.lyrics.source, 'apple');
  assert.equal(found.lyrics.mode, 'word');
  const first = found.lyrics.lines[0]!;
  assert.deepEqual(first.romanGroups, [
    { from: 0, to: 2, text: 'yonggamhan' },
    { from: 2, to: 3, text: 'nae' },
  ]);
  assert.equal(found.lyrics.lines[1]!.romanGroups, undefined, 'a line already in Latin script gets no reading');
});

test('songs the service does not have are a plain miss', async () => {
  resetApplePause();
  const get: TextFetch = async () => {
    throw new HttpError(401, 'API key required');
  };
  assert.equal(await findApple({ title: 'Song', artist: 'Band', duration: 100 }, undefined, get, parse), null);
});

test('a rate limit is reported as a failure and pauses the service', async () => {
  resetApplePause();
  const get: TextFetch = async () => {
    throw new HttpError(429, 'Too many');
  };
  await assert.rejects(findApple({ title: 'Song', artist: 'Band', duration: 100 }, undefined, get, parse));
  assert.equal(applePaused(), true);
  await assert.rejects(findApple({ title: 'Song', artist: 'Band', duration: 100 }, undefined, ok, parse));
  resetApplePause();
});

test('a transcription that runs far past the file is a different recording', async () => {
  resetApplePause();
  assert.equal(await findApple({ title: 'Song', artist: 'Band', duration: 5 }, undefined, ok, parse), null);
});
