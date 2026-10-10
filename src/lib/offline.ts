import type { Library } from '../api';
import type { LyricsResult } from './lyric-types';

/**
 * Everything needed to use a song with no connection lives in IndexedDB: the audio, the cover art,
 * the lyrics found for it, and a snapshot of the library so the app can open and list it.
 */
export type OfflineEntry = {
  trackId: string;
  audioFileId: string;
  audio: Blob;
  coverIds: string[];
  lyrics: LyricsResult | null;
  savedAt: number;
};

export type OfflineInfo = Pick<OfflineEntry, 'trackId' | 'audioFileId' | 'coverIds' | 'savedAt'> & {
  size: number;
  hasLyrics: boolean;
};

const DB_NAME = 'blank-offline';
const TRACKS = 'tracks';
const COVERS = 'covers';
const META = 'meta';

let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tracks = db.createObjectStore(TRACKS, { keyPath: 'trackId' });
      tracks.createIndex('audioFileId', 'audioFileId', { unique: false });
      db.createObjectStore(COVERS, { keyPath: 'fileId' });
      db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opened = null;
      reject(request.error ?? new Error('Offline storage is unavailable'));
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

async function run<T>(stores: string | string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const db = await open();
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Storage is full', 'QuotaExceededError'));
  });
  const result = await work(tx);
  await done;
  return result;
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

export function onOfflineChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function listOffline(): Promise<OfflineInfo[]> {
  const entries = await run(TRACKS, 'readonly', (tx) => wrap(tx.objectStore(TRACKS).getAll() as IDBRequest<OfflineEntry[]>));
  return entries.map((entry) => ({
    trackId: entry.trackId,
    audioFileId: entry.audioFileId,
    coverIds: entry.coverIds,
    savedAt: entry.savedAt,
    size: entry.audio.size,
    hasLyrics: entry.lyrics !== null,
  }));
}

export async function getOfflineAudio(audioFileId: string): Promise<Blob | null> {
  const entry = await run(TRACKS, 'readonly', (tx) =>
    wrap(tx.objectStore(TRACKS).index('audioFileId').get(audioFileId) as IDBRequest<OfflineEntry | undefined>),
  );
  return entry?.audio ?? null;
}

export async function getOfflineLyrics(trackId: string): Promise<LyricsResult | null> {
  const entry = await run(TRACKS, 'readonly', (tx) =>
    wrap(tx.objectStore(TRACKS).get(trackId) as IDBRequest<OfflineEntry | undefined>),
  );
  return entry?.lyrics ?? null;
}

/** Keeps the lyrics with a downloaded song. Does nothing for songs that are not downloaded. */
export async function setOfflineLyrics(trackId: string, lyrics: LyricsResult): Promise<void> {
  const saved = await run(TRACKS, 'readwrite', async (tx) => {
    const store = tx.objectStore(TRACKS);
    const entry = (await wrap(store.get(trackId))) as OfflineEntry | undefined;
    if (!entry) return false;
    await wrap(store.put({ ...entry, lyrics }));
    return true;
  });
  if (saved) changed();
}

export async function saveOffline(entry: OfflineEntry, covers: Array<{ fileId: string; blob: Blob }>): Promise<void> {
  await run([TRACKS, COVERS], 'readwrite', async (tx) => {
    await wrap(tx.objectStore(TRACKS).put(entry));
    for (const cover of covers) await wrap(tx.objectStore(COVERS).put(cover));
  });
  changed();
}

export async function removeOffline(trackIds: string[]): Promise<void> {
  if (!trackIds.length) return;
  await run([TRACKS, COVERS], 'readwrite', async (tx) => {
    const tracks = tx.objectStore(TRACKS);
    for (const id of trackIds) await wrap(tracks.delete(id));
    const remaining = (await wrap(tracks.getAll())) as OfflineEntry[];
    const kept = new Set(remaining.flatMap((entry) => entry.coverIds));
    const covers = tx.objectStore(COVERS);
    for (const key of (await wrap(covers.getAllKeys())) as string[]) {
      if (!kept.has(key)) await wrap(covers.delete(key));
    }
  });
  changed();
}

export async function getOfflineCover(fileId: string): Promise<Blob | null> {
  const row = await run(COVERS, 'readonly', (tx) =>
    wrap(tx.objectStore(COVERS).get(fileId) as IDBRequest<{ fileId: string; blob: Blob } | undefined>),
  );
  return row?.blob ?? null;
}

export async function loadLibrarySnapshot(userId: string): Promise<Library | null> {
  const snapshot = await run(META, 'readonly', (tx) => wrap(tx.objectStore(META).get(`library:${userId}`) as IDBRequest<Library | undefined>));
  return snapshot ?? null;
}

export async function saveLibrarySnapshot(userId: string, library: Library): Promise<void> {
  await run(META, 'readwrite', (tx) => wrap(tx.objectStore(META).put(library, `library:${userId}`)));
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

export async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not supported: the browser may evict under pressure, the app still works */
  }
}
