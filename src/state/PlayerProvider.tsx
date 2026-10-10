import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audioObjectUrl } from '../api';
import { artworkFor, nativeControls, type ControlAction } from '../lib/media-controls';
import type { Track } from '../types';
import { useLibrary } from './LibraryProvider';

export type RepeatMode = 'off' | 'all' | 'one';

type PlayerContextValue = {
  queue: Track[];
  index: number;
  track: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  queueOpen: boolean;
  lyricsOpen: boolean;
  getTime: () => number;
  playTracks: (tracks: Track[], startIndex?: number) => void;
  toggleTrack: (track: Track, list: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setQueueOpen: (open: boolean) => void;
  setLyricsOpen: (open: boolean) => void;
  playNext: (track: Track) => void;
  jumpTo: (index: number) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function shuffleAfter(tracks: Track[], startIndex: number): Track[] {
  const current = tracks[startIndex];
  const rest = tracks.filter((_, index) => index !== startIndex);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = rest[i]!;
    rest[i] = rest[j]!;
    rest[j] = swap;
  }
  return current ? [current, ...rest] : rest;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { tracks, albums } = useLibrary();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const repeatRef = useRef<RepeatMode>('off');
  const lastVolume = useRef(0.9);
  const [queue, setQueue] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => {
    const raw = localStorage.getItem('blank.volume');
    const stored = raw === null ? NaN : Number(raw);
    return Number.isFinite(stored) ? Math.min(1, Math.max(0, stored)) : 0.9;
  });
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const [generation, setGeneration] = useState(0);
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

  const go = useCallback((nextIndex: number, list = queueRef.current) => {
    if (!list.length) return;
    const wrapped = (nextIndex + list.length) % list.length;
    indexRef.current = wrapped;
    queueRef.current = list;
    setQueue(list);
    setIndex(wrapped);
    setGeneration((value) => value + 1);
  }, []);

  const next = useCallback(() => {
    const list = queueRef.current;
    const at = indexRef.current;
    if (!list.length) return;
    if (repeatRef.current === 'one') {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    if (at < list.length - 1) {
      go(at + 1);
      return;
    }
    if (repeatRef.current === 'all') {
      go(0);
      return;
    }
    audioRef.current?.pause();
    setPlaying(false);
  }, [go]);

  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audioRef.current = audio;
    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => nextRef.current();
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.pause();
      audio.src = '';
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  useEffect(() => {
    if (generation === 0) return;
    const track = queueRef.current[indexRef.current];
    const audio = audioRef.current;
    if (!track || !audio) return;
    let cancelled = false;
    setLoading(true);
    setCurrentTime(0);
    void (async () => {
      try {
        const url = await audioObjectUrl(track.audioFileId);
        if (cancelled) return;
        audio.src = url;
        await audio.play();
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artist,
          });
        }
      } catch {
        if (!cancelled) setPlaying(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, index]);

  useEffect(() => {
    setQueue((current) => current.map((track) => tracks.find((item) => item.id === track.id) ?? track));
    queueRef.current = queueRef.current.map((track) => tracks.find((item) => item.id === track.id) ?? track);
  }, [tracks]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (indexRef.current > 0) go(indexRef.current - 1);
    else if (audio) audio.currentTime = 0;
  }, [go]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [muted, volume]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => void audioRef.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => audioRef.current?.pause());
    navigator.mediaSession.setActionHandler('nexttrack', () => next());
    navigator.mediaSession.setActionHandler('previoustrack', () => previous());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
      navigator.mediaSession.setActionHandler('previoustrack', null);
    };
  }, [next, previous]);

  const controlsRef = useRef<(action: ControlAction) => void>(() => undefined);
  controlsRef.current = (control) => {
    const audio = audioRef.current;
    if (control.action === 'play') void audio?.play();
    else if (control.action === 'pause') audio?.pause();
    else if (control.action === 'next') next();
    else if (control.action === 'previous') previous();
    else if (control.action === 'seekto' && audio && control.position !== undefined) {
      audio.currentTime = Math.max(0, control.position);
      setCurrentTime(audio.currentTime);
    }
  };

  const nowPlaying = queue[index] ?? null;
  const nowPlayingCover = albums.find((item) => item.id === nowPlaying?.albumId)?.coverFileId ?? nowPlaying?.coverFileId ?? null;
  const shownArtwork = useRef<string | null>(null);

  useEffect(() => {
    if (!nativeControls) return;
    const handle = nativeControls.addListener('action', (control) => controlsRef.current(control));
    return () => {
      void handle.then((listener) => listener.remove());
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const controls = nativeControls;
    if (!controls || !audio) return;
    if (!nowPlaying) {
      shownArtwork.current = null;
      void controls.clear();
      return;
    }
    let cancelled = false;
    const push = async () => {
      const artKey = `${nowPlaying.id}:${nowPlayingCover ?? ''}`;
      let artwork: string | undefined;
      if (shownArtwork.current !== artKey) {
        artwork = (await artworkFor(nowPlayingCover, nowPlaying.hue)) ?? undefined;
        if (cancelled) return;
        shownArtwork.current = artKey;
      }
      const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : nowPlaying.durationMs / 1000;
      await controls.update({
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        album: albums.find((item) => item.id === nowPlaying.albumId)?.name ?? '',
        durationMs: seconds * 1000,
        positionMs: audio.currentTime * 1000,
        playing: !audio.paused,
        artwork,
      });
    };
    const refresh = () => void push().catch(() => undefined);
    refresh();
    audio.addEventListener('seeked', refresh);
    audio.addEventListener('durationchange', refresh);
    return () => {
      cancelled = true;
      audio.removeEventListener('seeked', refresh);
      audio.removeEventListener('durationchange', refresh);
    };
  }, [albums, nowPlaying, nowPlayingCover, playing]);

  const playTracks = useCallback(
    (list: Track[], startIndex = 0) => {
      if (!list.length) return;
      const safeIndex = Math.min(Math.max(startIndex, 0), list.length - 1);
      const ordered = shuffleRef.current ? shuffleAfter(list, safeIndex) : list;
      go(shuffleRef.current ? 0 : safeIndex, ordered);
    },
    [go],
  );

  const toggleTrack = useCallback(
    (track: Track, list: Track[]) => {
      const current = queueRef.current[indexRef.current];
      if (current?.id === track.id) {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) void audio.play();
        else audio.pause();
        return;
      }
      const start = Math.max(0, list.findIndex((item) => item.id === track.id));
      playTracks(list, start);
    },
    [playTracks],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !queueRef.current.length) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, seconds);
    setCurrentTime(audio.currentTime);
  }, []);

  const setVolume = useCallback((value: number) => {
    const nextVolume = Math.min(1, Math.max(0, value));
    if (nextVolume > 0) lastVolume.current = nextVolume;
    if (audioRef.current) audioRef.current.volume = nextVolume;
    setVolumeState(nextVolume);
    setMuted(nextVolume === 0);
    localStorage.setItem('blank.volume', String(nextVolume));
  }, []);

  const toggleMute = useCallback(() => {
    if (muted || volume === 0) setVolume(lastVolume.current || 0.9);
    else setVolume(0);
  }, [muted, setVolume, volume]);

  const toggleShuffle = useCallback(() => setShuffle((value) => !value), []);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => (value === 'off' ? 'all' : value === 'all' ? 'one' : 'off'));
  }, []);

  const playNext = useCallback((track: Track) => {
    const list = [...queueRef.current];
    if (!list.length) {
      go(0, [track]);
      return;
    }
    const insertAt = indexRef.current + 1;
    list.splice(insertAt, 0, track);
    queueRef.current = list;
    setQueue(list);
  }, [go]);

  const jumpTo = useCallback(
    (nextIndex: number) => {
      go(nextIndex);
    },
    [go],
  );

  const track = queue[index] ?? null;

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      index,
      track,
      playing,
      loading,
      currentTime,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      queueOpen,
      lyricsOpen,
      getTime,
      playTracks,
      toggleTrack,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      setQueueOpen,
      setLyricsOpen,
      playNext,
      jumpTo,
    }),
    [
      queue,
      index,
      track,
      playing,
      loading,
      currentTime,
      duration,
      volume,
      muted,
      shuffle,
      repeat,
      queueOpen,
      lyricsOpen,
      getTime,
      playTracks,
      toggleTrack,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      playNext,
      jumpTo,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
