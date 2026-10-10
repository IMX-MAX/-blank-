import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { downloadAudio, downloadCover } from '../api';
import { findLyrics } from '../lib/lyrics';
import type { LyricsResult } from '../lib/lyric-types';
import {
  isQuotaError,
  listOffline,
  onOfflineChange,
  removeOffline,
  requestPersistence,
  saveOffline,
  type OfflineInfo,
} from '../lib/offline';
import type { Track } from '../types';
import { useLibrary } from './LibraryProvider';

type OfflineContextValue = {
  /** Track ids that can be played with no connection. */
  saved: ReadonlySet<string>;
  /** 0..1 for songs being downloaded; 0 while waiting in line. */
  progress: Readonly<Record<string, number>>;
  count: number;
  bytes: number;
  isSaved: (trackId: string) => boolean;
  makeAvailable: (tracks: Track[]) => Promise<void>;
  remove: (tracks: Track[]) => Promise<void>;
  removeAll: () => Promise<void>;
};

const OfflineContext = createContext<OfflineContextValue | null>(null);

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function OfflineProvider({ children }: { children: ReactNode }) {
  const library = useLibrary();
  const [infos, setInfos] = useState<OfflineInfo[]>([]);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inFlight = useRef(new Set<string>());

  const reload = useCallback(() => {
    void listOffline()
      .then(setInfos)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    reload();
    return onOfflineChange(reload);
  }, [reload]);

  const saved = useMemo(() => new Set(infos.map((info) => info.trackId)), [infos]);

  // Songs deleted from the library should not keep taking up space. Only trust a library that came from the server.
  useEffect(() => {
    if (!library.live || !library.ready) return;
    const present = new Set(library.tracks.map((track) => track.id));
    const gone = infos.filter((info) => !present.has(info.trackId)).map((info) => info.trackId);
    if (gone.length) void removeOffline(gone).catch(() => undefined);
  }, [infos, library.live, library.ready, library.tracks]);

  const saveOne = useCallback(
    async (track: Track) => {
      const album = library.albums.find((item) => item.id === track.albumId);
      const audio = await downloadAudio(track.audioFileId, (fraction) =>
        setProgress((current) => ({ ...current, [track.id]: fraction })),
      );

      const coverIds = [...new Set([track.coverFileId, album?.coverFileId].filter((id): id is string => !!id))];
      const covers: Array<{ fileId: string; blob: Blob }> = [];
      for (const fileId of coverIds) {
        try {
          covers.push({ fileId, blob: await downloadCover(fileId) });
        } catch {
          /* the song is still usable without its artwork */
        }
      }

      let lyrics: LyricsResult | null = null;
      try {
        const found = await findLyrics({
          title: track.title,
          artist: track.artist,
          album: album?.name,
          duration: track.durationMs / 1000,
        });
        if (found.status !== 'none') lyrics = found;
      } catch {
        /* lyrics are saved the next time they are opened with a connection */
      }

      await saveOffline(
        { trackId: track.id, audioFileId: track.audioFileId, audio, coverIds: covers.map((c) => c.fileId), lyrics, savedAt: Date.now() },
        covers,
      );
    },
    [library.albums],
  );

  const makeAvailable = useCallback(
    async (tracks: Track[]) => {
      const wanted = tracks.filter((track) => !saved.has(track.id) && !inFlight.current.has(track.id));
      if (!wanted.length) return;
      await requestPersistence();
      for (const track of wanted) inFlight.current.add(track.id);
      setProgress((current) => ({ ...current, ...Object.fromEntries(wanted.map((track) => [track.id, 0])) }));

      let failed = 0;
      let full = false;
      const job = queue.current.then(async () => {
        for (const track of wanted) {
          try {
            await saveOne(track);
          } catch (err) {
            failed += 1;
            if (isQuotaError(err)) full = true;
          } finally {
            inFlight.current.delete(track.id);
            setProgress((current) => {
              const { [track.id]: _done, ...rest } = current;
              return rest;
            });
          }
        }
      });
      queue.current = job.catch(() => undefined);
      await job;
      if (full) throw new Error('Not enough storage on this device to keep those songs offline');
      if (failed) {
        throw new Error(
          failed === wanted.length && wanted.length === 1
            ? 'Could not download that song. Check your connection and try again'
            : `${failed} of ${wanted.length} songs could not be downloaded`,
        );
      }
    },
    [saveOne, saved],
  );

  const remove = useCallback(async (tracks: Track[]) => {
    await removeOffline(tracks.map((track) => track.id));
  }, []);

  const removeAll = useCallback(async () => {
    await removeOffline(infos.map((info) => info.trackId));
  }, [infos]);

  const value = useMemo<OfflineContextValue>(
    () => ({
      saved,
      progress,
      count: infos.length,
      bytes: infos.reduce((sum, info) => sum + info.size, 0),
      isSaved: (trackId) => saved.has(trackId),
      makeAvailable,
      remove,
      removeAll,
    }),
    [infos, makeAvailable, progress, remove, removeAll, saved],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}

export function useOffline() {
  const ctx = useContext(OfflineContext);
  if (!ctx) throw new Error('useOffline must be used within OfflineProvider');
  return ctx;
}
