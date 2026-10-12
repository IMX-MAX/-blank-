import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, downloadArgs, infoArgs, parseInfoFile, parseListing, progressFrom, safeName, sortFiles } from './ytdlp-parse';

test('links must be YouTube; other text is a search', () => {
  assert.deepEqual(classify('  blinding lights the weeknd '), { kind: 'search', target: 'ytsearch8:blinding lights the weeknd' });
  assert.equal(classify('https://music.youtube.com/watch?v=4NRXx6U8ABQ&list=RDAMVM4NRXx6U8ABQ').kind, 'video');
  assert.equal(classify('https://youtu.be/4NRXx6U8ABQ').kind, 'video');
  assert.deepEqual(classify('https://music.youtube.com/playlist?list=OLAK5uy_abc&si=x'), {
    kind: 'playlist',
    target: 'https://music.youtube.com/playlist?list=OLAK5uy_abc',
  });
  assert.equal(classify('https://example.com/watch?v=1').kind, 'invalid');
  assert.equal(classify('http://www.youtube.com/watch?v=1').kind, 'invalid');
  assert.equal(classify('https://www.youtube.com.evil.test/watch?v=1').kind, 'invalid');
  assert.equal(classify('file:///etc/passwd').kind, 'invalid');
  assert.equal(classify('   ').kind, 'invalid');
});

test('a single link never expands into the whole mix it came from', () => {
  assert.ok(infoArgs('video').includes('--no-playlist'));
  assert.ok(infoArgs('playlist').includes('--flat-playlist'));
  assert.ok(downloadArgs('/tmp/x/%(id)s.%(ext)s').includes('--no-playlist'));
});

test('download progress lines', () => {
  assert.equal(progressFrom('[download]  42.5% of 3.40MiB at 1.2MiB/s ETA 00:02'), 0.425);
  assert.equal(progressFrom('[download] 100% of 3.40MiB in 00:00:03'), 1);
  assert.equal(progressFrom('[youtube] Extracting URL'), null);
});

test('files yt-dlp wrote are told apart', () => {
  assert.deepEqual(sortFiles(['4NRX.webp', '4NRX.info.json', '4NRX.m4a']), { audio: '4NRX.m4a', cover: '4NRX.webp', info: '4NRX.info.json' });
  assert.deepEqual(sortFiles(['a.m4a.part']), { audio: null, cover: null, info: null });
});

test('a YouTube Music song keeps its own tags', () => {
  const entry = parseInfoFile(
    JSON.stringify({
      id: 'abc',
      title: 'Blinding Lights',
      track: 'Blinding Lights',
      artists: ['The Weeknd'],
      album: 'After Hours',
      release_year: 2020,
      duration: 200.4,
      webpage_url: 'https://music.youtube.com/watch?v=abc',
      thumbnails: [
        { url: 'https://lh3.googleusercontent.com/small', width: 60, height: 60 },
        { url: 'https://lh3.googleusercontent.com/big', width: 544, height: 544 },
      ],
    }),
  );
  assert.deepEqual(entry, {
    id: 'abc',
    url: 'https://music.youtube.com/watch?v=abc',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    year: 2020,
    durationMs: 200400,
    thumbnail: 'https://lh3.googleusercontent.com/big',
  });
});

test('a video title is split into artist and song', () => {
  const listing = parseListing(
    JSON.stringify({
      _type: 'playlist',
      extractor_key: 'YoutubeSearch',
      title: 'blinding lights',
      entries: [
        null,
        {
          id: '4NRXx6U8ABQ',
          title: 'The Weeknd - Blinding Lights (Official Video)',
          url: 'https://www.youtube.com/watch?v=4NRXx6U8ABQ',
          duration: 263,
          channel: 'The Weeknd',
          thumbnails: [{ url: 'http://insecure.example/a.jpg', width: 1, height: 1 }],
        },
        { id: 'x', title: 'Heat Waves', uploader: 'Glass Animals - Topic', url: 'https://evil.test/x' },
      ],
    }),
  );
  assert.equal(listing.title, null);
  assert.equal(listing.entries.length, 2);
  assert.equal(listing.entries[0]!.title, 'Blinding Lights');
  assert.equal(listing.entries[0]!.artist, 'The Weeknd');
  assert.equal(listing.entries[0]!.thumbnail, null);
  assert.equal(listing.entries[1]!.artist, 'Glass Animals');
  assert.equal(listing.entries[1]!.url, 'https://www.youtube.com/watch?v=x');
});

test('an album link keeps its name', () => {
  const listing = parseListing(JSON.stringify({ _type: 'playlist', extractor_key: 'YoutubeTab', title: 'Album - After Hours', entries: [{ id: 'a', title: 'Alone Again' }] }));
  assert.equal(listing.title, 'Album - After Hours');
  assert.throws(() => parseListing('not json'));
});

test('file names are safe', () => {
  assert.equal(safeName('AC/DC: Back in Black?', 'M4A'), 'AC DC Back in Black.m4a');
  assert.equal(safeName('???', 'm4a'), 'track.m4a');
});
