import assert from 'node:assert/strict';
import test from 'node:test';
import { durationMs, parseAlbum, parseSearch, splitMeta, streamFromPlayer } from './youtube';

const song = {
  musicResponsiveListItemRenderer: {
    thumbnail: {
      musicThumbnailRenderer: {
        thumbnail: {
          thumbnails: [
            { url: 'https://example.com/small.jpg', width: 60 },
            { url: 'https://example.com/large.jpg', width: 226 },
          ],
        },
      },
    },
    overlay: {
      musicItemThumbnailOverlayRenderer: {
        content: {
          musicPlayButtonRenderer: {
            playNavigationEndpoint: { watchEndpoint: { videoId: '4D7u5KF7SP8' } },
          },
        },
      },
    },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Get Lucky' }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: 'Daft Punk' }, { text: ' • ' }, { text: 'Random Access Memories' }, { text: ' • ' }, { text: '6:10' }] },
        },
      },
    ],
  },
};

const album = {
  musicResponsiveListItemRenderer: {
    thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://example.com/album.jpg', width: 120 }] } } },
    flexColumns: [
      { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Discovery' }] } } },
      {
        musicResponsiveListItemFlexColumnRenderer: {
          text: { runs: [{ text: 'Album' }, { text: ' • ' }, { text: 'Daft Punk' }, { text: ' • ' }, { text: '2001' }] },
        },
      },
    ],
    navigationEndpoint: {
      browseEndpoint: {
        browseId: 'MPREb_examplealbum01',
        browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } },
      },
    },
  },
};

test('duration and the artist / album / length line', () => {
  assert.equal(durationMs('6:10'), 370000);
  assert.equal(durationMs('1:02:03'), 3723000);
  assert.equal(durationMs('nope'), 0);
  assert.deepEqual(splitMeta(['Daft Punk', ' • ', 'Discovery', ' • ', '3:47']), {
    artist: 'Daft Punk',
    album: 'Discovery',
    duration: '3:47',
  });
});

test('search rows become songs and albums', () => {
  const result = parseSearch({ songs: [song], albums: [album] });
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0]?.videoId, '4D7u5KF7SP8');
  assert.equal(result.songs[0]?.title, 'Get Lucky');
  assert.equal(result.songs[0]?.artist, 'Daft Punk');
  assert.equal(result.songs[0]?.album, 'Random Access Memories');
  assert.equal(result.songs[0]?.durationMs, 370000);
  assert.equal(result.songs[0]?.thumbnail, 'https://example.com/large.jpg');
  assert.equal(result.albums.length, 1);
  assert.equal(result.albums[0]?.browseId, 'MPREb_examplealbum01');
  assert.equal(result.albums[0]?.title, 'Discovery');
  assert.equal(result.albums[0]?.year, 2001);
});

test('an album page keeps the first shelf and numbers the tracks', () => {
  const page = parseAlbum(
    {
      musicResponsiveHeaderRenderer: {
        title: { runs: [{ text: 'Discovery' }] },
        straplineTextOne: { runs: [{ text: 'Daft Punk' }] },
        subtitle: { runs: [{ text: 'Album' }, { text: ' • ' }, { text: '2001' }] },
      },
      musicShelfRenderer: {
        contents: [song, { musicResponsiveListItemRenderer: { flexColumns: [] } }],
      },
      musicCarouselShelfRenderer: { contents: [song] },
    },
    { browseId: 'MPREb_examplealbum01', title: 'Fallback', artist: 'Someone', thumbnail: '', year: null },
  );
  assert.equal(page.album.title, 'Discovery');
  assert.equal(page.album.artist, 'Daft Punk');
  assert.equal(page.album.year, 2001);
  assert.equal(page.tracks.length, 1);
  assert.equal(page.tracks[0]?.trackNumber, 1);
  assert.equal(page.tracks[0]?.album, 'Random Access Memories');
});

test('a duration that sits in its own column is kept', () => {
  const row = {
    musicResponsiveListItemRenderer: {
      overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'IluRBvnYMoY' } } } } } },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Give Life Back to Music' }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Daft Punk' }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: '4:36' }] } } },
      ],
    },
  };
  const page = parseAlbum({ musicShelfRenderer: { contents: [row] } }, { browseId: 'MPREb_x', title: 'Random Access Memories', artist: 'Daft Punk', thumbnail: '', year: 2013 });
  assert.equal(page.tracks[0]?.durationMs, 276000);
});

test('player responses: direct audio wins, a sign-in wall is reported, cipher-only is not used', () => {
  const audio = streamFromPlayer({
    playabilityStatus: { status: 'OK' },
    streamingData: {
      adaptiveFormats: [
        { mimeType: 'audio/webm', url: 'https://rr.googlevideo.com/webm', bitrate: 160000 },
        { mimeType: 'audio/mp4', url: 'https://rr.googlevideo.com/m4a', bitrate: 128000 },
      ],
    },
  });
  assert.deepEqual(audio, { url: 'https://rr.googlevideo.com/m4a', mimeType: 'audio/mp4' });

  const wall = streamFromPlayer({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } });
  assert.deepEqual(wall, { error: 'Sign in to confirm you’re not a bot' });

  const cipher = streamFromPlayer({
    playabilityStatus: { status: 'OK' },
    streamingData: { adaptiveFormats: [{ mimeType: 'audio/mp4', signatureCipher: 's=abc', bitrate: 128000 }] },
  });
  assert.deepEqual(cipher, { error: 'YouTube did not provide a playable stream' });
});
