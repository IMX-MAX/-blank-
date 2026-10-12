import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowedTarget, GET } from '../../api/lyrics-proxy';

test('only the two lyric services are allowed', () => {
  assert.equal(allowedTarget('https://music.163.com/api/search/get?s=a')?.hostname, 'music.163.com');
  assert.equal(allowedTarget('https://lyrics-api.boidu.dev/getLyrics?s=a')?.hostname, 'lyrics-api.boidu.dev');
  assert.equal(allowedTarget('https://example.com/'), null);
  assert.equal(allowedTarget('https://music.163.com.evil.test/'), null);
  assert.equal(allowedTarget('https://evil.test/@music.163.com'), null);
  assert.equal(allowedTarget('https://user@music.163.com/'), null);
  assert.equal(allowedTarget('http://music.163.com/'), null);
  assert.equal(allowedTarget('https://music.163.com:8443/'), null);
  assert.equal(allowedTarget('file:///etc/passwd'), null);
  assert.equal(allowedTarget('not a url'), null);
  assert.equal(allowedTarget(null), null);
});

test('a refused address answers 400 and marks the response as coming from the proxy', async () => {
  const response = await GET(new Request('http://localhost/lyrics-proxy?url=' + encodeURIComponent('https://example.com/')));
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('x-lyrics-proxy'), '1');
});
