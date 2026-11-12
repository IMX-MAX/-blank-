import { useEffect, useRef } from 'react';
import { ListenTracker, saveListens, type Listen } from '../lib/stats';
import { useLibrary } from './LibraryProvider';
import { usePlayer } from './PlayerProvider';

const FLUSH_MS = 20_000;

/** Feeds playback into the listening stats: buffered in memory, written every 20 s, on pause, and when the app is left. */
export function useListeningRecorder(): void {
  const { track, currentTime, playing, duration } = usePlayer();
  const { albums } = useLibrary();
  const buffer = useRef<Listen[]>([]);
  const tracker = useRef<ListenTracker | null>(null);
  tracker.current ??= new ListenTracker((listen) => buffer.current.push(listen));

  const flush = useRef(() => {
    const listens = buffer.current;
    if (!listens.length) return;
    buffer.current = [];
    void saveListens(listens).catch(() => {
      // Keep them for the next try rather than lose them.
      buffer.current = [...listens, ...buffer.current];
    });
  });

  useEffect(() => {
    const album = track?.albumId ? albums.find((item) => item.id === track.albumId) : undefined;
    tracker.current!.observe({
      trackId: track?.id ?? null,
      time: currentTime,
      playing,
      duration: duration || (track ? track.durationMs / 1000 : 0),
      meta: {
        title: track?.title ?? '',
        artist: track?.artist ?? '',
        album: album?.kind === 'album' ? album.name : '',
        albumId: album?.kind === 'album' ? album.id : null,
      },
    });
  }, [track, currentTime, playing, duration, albums]);

  useEffect(() => {
    if (!playing) flush.current();
  }, [playing, track?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => flush.current(), FLUSH_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush.current);
    const flushNow = flush.current;
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flushNow);
      flushNow();
    };
  }, []);
}
