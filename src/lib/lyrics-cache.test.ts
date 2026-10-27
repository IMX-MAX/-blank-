import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}
(globalThis as { localStorage: unknown }).localStorage = new MemoryStorage();

const { LYRICS_VERSION } = await import('./lyric-types');
type Lyrics = import('./lyric-types').Lyrics;
type LyricsResult = import('./lyric-types').LyricsResult;
const { findLyrics, peekCachedLyrics, setCachedLyrics } = await import('./lyrics');
const { loadLyrics } = await import('./lyrics-load');
const { getSavedLyrics, saveLyrics, clearSavedLyrics } = await import('./lyrics-store');
const { getOfflineAudio, getOfflineLyrics, saveOffline, setOfflineLyrics } = await import('./offline');
const { clearAllLyricsCaches, forgetTrackLyrics, saveChosenLyrics } = await import('./lyrics-cache');
const { lyricsVersion, onLyricsChange } = await import('./lyrics-epoch');

const lyricsOf = (text: string, mode: Lyrics['mode'] = 'line', extra: Partial<Lyrics> = {}): Extract<LyricsResult, { status: 'found' }> => ({
  status: 'found',
  id: text,
  lyrics: { v: LYRICS_VERSION, mode, source: 'lrclib', lines: [{ text, start: 1, end: 3, words: [] }], ...extra },
});

type T = { id: string; title: string; artist: string; durationMs: number };
const songA: T = { id: 'a', title: 'Song A', artist: 'Band', durationMs: 200_000 };
const songB: T = { id: 'b', title: 'Song B', artist: 'Band', durationMs: 180_000 };
const queryOf = (track: T) => ({ title: track.title, artist: track.artist, duration: track.durationMs / 1000 });

const download = (track: T) =>
  saveOffline({ trackId: track.id, audioFileId: `file-${track.id}`, audio: new Blob(['audio']), coverIds: [], lyrics: null, savedAt: 1 }, []);

let fetchCalls: string[] = [];
let served = 'from the network';
let gate: Promise<void> | null = null;

beforeEach(async () => {
  (globalThis.localStorage as unknown as MemoryStorage).clear();
  fetchCalls = [];
  served = 'from the network';
  gate = null;
  await clearAllLyricsCaches();
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetchCalls.push(url);
    if (gate) await gate;
    if (url.startsWith('https://lrclib.net/api/search')) {
      const record = { id: 7, trackName: 'x', artistName: 'y', duration: 200, syncedLyrics: `[00:01.00] ${served}` };
      return new Response(JSON.stringify([record]), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
});

async function seed(track: T, text = 'old lyrics') {
  setCachedLyrics(queryOf(track), lyricsOf(text));
  await saveLyrics(track, lyricsOf(text));
  await download(track);
  await setOfflineLyrics(track.id, lyricsOf(text));
}

const lyricKeys = () => {
  const store = globalThis.localStorage;
  return Array.from({ length: store.length }, (_, index) => store.key(index)!).filter((key) => key.startsWith('blank.lyrics'));
};

test('clearing only the saved-lyrics store leaves old lyrics in the lookup cache (the original bug)', async () => {
  await seed(songA);
  await clearSavedLyrics();
  assert.equal(await getSavedLyrics(songA), null);
  assert.ok(peekCachedLyrics(queryOf(songA)), 'rolling cache still serves the old lyrics');
  const signal = new AbortController().signal;
  const loaded = await loadLyrics(songA, undefined, signal, false);
  assert.equal(loaded.status === 'found' && loaded.lyrics.lines[0]!.text, 'old lyrics');
  assert.equal(fetchCalls.length, 0);
});

test('clear wipes every layer and the next load asks the network again', async () => {
  await seed(songA);
  await seed(songB, 'other old lyrics');
  (globalThis.localStorage as unknown as MemoryStorage).setItem('blank.cacheLyrics', '1');
  const announced: number[] = [];
  const stop = onLyricsChange(() => announced.push(lyricsVersion()));

  const outcome = await clearAllLyricsCaches();
  stop();

  assert.deepEqual(outcome.failed, []);
  assert.equal(announced.length, 1);
  assert.deepEqual(lyricKeys(), []);
  assert.equal(globalThis.localStorage.getItem('blank.cacheLyrics'), '1', 'settings are left alone');
  for (const track of [songA, songB]) {
    assert.equal(peekCachedLyrics(queryOf(track)), null);
    assert.equal(await getSavedLyrics(track), null);
    assert.equal(await getOfflineLyrics(track.id), null);
  }
  assert.ok(await getOfflineAudio('file-a'), 'the downloaded audio is not touched');

  const loaded = await loadLyrics(songA, undefined, new AbortController().signal, true);
  assert.ok(fetchCalls.length > 0, 'lyrics are fetched again');
  assert.equal(loaded.status === 'found' && loaded.lyrics.lines[0]!.text, 'from the network');
});

test('a lookup that was running while lyrics were cleared does not put them back', async () => {
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  const running = findLyrics(queryOf(songA));
  await new Promise((resolve) => setTimeout(resolve, 20));
  await clearAllLyricsCaches();
  release();
  const result = await running;
  assert.equal(result.status, 'found');
  assert.equal(peekCachedLyrics(queryOf(songA)), null);
  assert.deepEqual(lyricKeys(), []);
});

test('removing a song removes its lyrics from every layer and leaves other songs alone', async () => {
  await seed(songA);
  await seed(songB, 'keep me');
  // looked up with a slightly different length earlier: still the same song
  setCachedLyrics({ ...queryOf(songA), duration: 201 }, lyricsOf('old lyrics'));

  await forgetTrackLyrics([songA]);

  assert.equal(peekCachedLyrics(queryOf(songA)), null);
  assert.equal(peekCachedLyrics({ ...queryOf(songA), duration: 201 }), null);
  assert.equal(await getSavedLyrics(songA), null);
  assert.equal(await getOfflineLyrics('a'), null);
  assert.equal(await getOfflineAudio('file-a'), null, 'its offline copy goes too');
  assert.ok(peekCachedLyrics(queryOf(songB)));
  assert.ok(await getSavedLyrics(songB));
  assert.ok(await getOfflineLyrics('b'));
  assert.ok(lyricKeys().some((key) => key.includes('song b')));
  assert.ok(!lyricKeys().some((key) => key.includes('song a')));
});

test('a lyric picked by hand replaces every cached copy and is not refreshed by a newer lookup', async () => {
  await seed(songA);
  let announced = 0;
  const stop = onLyricsChange(() => (announced += 1));
  await saveChosenLyrics(songA, lyricsOf('picked lyrics', 'line', { v: 1 }));
  stop();
  assert.equal(announced, 1);

  const loaded = await loadLyrics(songA, undefined, new AbortController().signal, false);
  assert.equal(fetchCalls.length, 0, 'served from the saved copy, even though a line-timed v1 copy would normally be refreshed');
  assert.ok(loaded.status === 'found');
  assert.equal(loaded.status === 'found' && loaded.lyrics.lines[0]!.text, 'picked lyrics');
  assert.equal(loaded.status === 'found' && loaded.lyrics.chosen, true);
  assert.equal(loaded.status === 'found' && loaded.lyrics.v, LYRICS_VERSION);

  const saved = await getSavedLyrics(songA);
  assert.equal(saved?.status === 'found' && saved.lyrics.lines[0]!.text, 'picked lyrics');
  const kept = await getOfflineLyrics('a');
  assert.equal(kept?.status === 'found' && kept.lyrics.lines[0]!.text, 'picked lyrics');
  const rolling = peekCachedLyrics(queryOf(songA));
  assert.equal(rolling?.status === 'found' && rolling.lyrics.lines[0]!.text, 'picked lyrics');

  await clearAllLyricsCaches();
  assert.equal(await getSavedLyrics(songA), null, 'clearing removes picked lyrics too');
});
