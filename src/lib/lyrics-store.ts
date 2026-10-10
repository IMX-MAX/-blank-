import type { Album, Track } from '../types';
import { findLyrics, type LyricsResult } from './lyrics';

/**
 * Lyrics kept on the phone for good, so they open with no connection. Separate from the small
 * rolling cache in lyrics.ts, which forgets old songs.
 */
type Saved = { trackId: string; signature: string; result: Exclude<LyricsResult, { status: 'none' }>; savedAt: number };

const DB_NAME = 'blank-lyrics';
const STORE = 'lyrics';

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'trackId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error('Lyrics storage is unavailable'));
    };
  });
  return opened;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(STORE, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage failed'));
  });
  const result = await work(tx.objectStore(STORE));
  await done;
  return result;
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function onSavedLyricsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saved lyrics belong to the tags they were looked up with, so retagging a song looks it up again. */
export const lyricsSignature = (track: Pick<Track, 'title' | 'artist'>) => `${track.title}\u0000${track.artist}`;

export async function getSavedLyrics(track: Pick<Track, 'id' | 'title' | 'artist'>): Promise<LyricsResult | null> {
  const saved = await run('readonly', (store) => wrap(store.get(track.id) as IDBRequest<Saved | undefined>));
  return saved && saved.signature === lyricsSignature(track) ? saved.result : null;
}

export async function saveLyrics(track: Pick<Track, 'id' | 'title' | 'artist'>, result: LyricsResult): Promise<void> {
  if (result.status === 'none') return;
  const entry: Saved = { trackId: track.id, signature: lyricsSignature(track), result, savedAt: Date.now() };
  await run('readwrite', (store) => wrap(store.put(entry)));
  changed();
}

export async function savedLyricsTrackIds(tracks: Track[]): Promise<Set<string>> {
  const all = await run('readonly', (store) => wrap(store.getAll() as IDBRequest<Saved[]>));
  const bySignature = new Map(all.map((entry) => [entry.trackId, entry.signature]));
  return new Set(tracks.filter((track) => bySignature.get(track.id) === lyricsSignature(track)).map((track) => track.id));
}

export async function clearSavedLyrics(): Promise<void> {
  await run('readwrite', (store) => wrap(store.clear()));
  changed();
}

export type CacheSummary = {
  saved: number;
  missing: number;
  failed: number;
  /** Stopped early because the lyrics services could not be reached. */
  offline: boolean;
};

const WORKERS = 3;
const GIVE_UP_AFTER = 4;

/** Looks up and saves lyrics for every song that does not have them yet. */
export async function saveLyricsFor(
  tracks: Track[],
  albums: Album[],
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<CacheSummary> {
  const have = await savedLyricsTrackIds(tracks);
  const todo = tracks.filter((track) => !have.has(track.id));
  const summary: CacheSummary = { saved: 0, missing: 0, failed: 0, offline: false };
  let next = 0;
  let done = 0;
  let streak = 0;
  options.onProgress?.(0, todo.length);

  const worker = async () => {
    while (!options.signal?.aborted && !summary.offline) {
      const track = todo[next++];
      if (!track) return;
      const album = albums.find((item) => item.id === track.albumId);
      try {
        const result = await findLyrics(
          { title: track.title, artist: track.artist, album: album?.name, duration: track.durationMs / 1000 },
          options.signal,
        );
        streak = 0;
        if (result.status === 'none') summary.missing += 1;
        else {
          await saveLyrics(track, result);
          summary.saved += 1;
        }
      } catch {
        if (options.signal?.aborted) return;
        summary.failed += 1;
        streak += 1;
        if (streak >= GIVE_UP_AFTER) summary.offline = true;
      }
      done += 1;
      options.onProgress?.(done, todo.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(WORKERS, todo.length) }, worker));
  return summary;
}
