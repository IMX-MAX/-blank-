import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { audioObjectUrl } from '../api';
import { audioEngine } from '../lib/audio-engine';
import { effectiveEq, eqActive } from '../lib/equaliser';
import { coverFor } from '../lib/covers';
import { readPeaks } from '../lib/peaks';
import { useSettings } from './SettingsProvider';
import { artworkFor, nativeControls, type ControlAction } from '../lib/media-controls';
import type { Track } from '../types';
import { useLibrary } from './LibraryProvider';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { historyTracks, pushHistory, readHistory, readSavedQueue, restoreQueue, serialiseQueue, writeHistory, writeSavedQueue } from '../lib/queue-persist';
import {
  advance,
  emptyQueue,
  insertNext,
  jump,
  mapQueue,
  playOrder,
  moveUpcoming,
  reinsert,
  removeWithUndo,
  retreat,
  type Removed,
  setShuffle as reorder,
  startQueue,
  type QueueState,
} from '../lib/queue-order';

export type RepeatMode = 'off' | 'all' | 'one';

export type QueueUndo = { removed: Removed<Track>; epoch: number };

type PlayerContextValue = {
  queue: Track[];
  index: number;
  /** Songs played recently, oldest first (still in the library), kept across new queues and launches. */
  history: Track[];
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
  expandedOpen: boolean;
  getTime: () => number;
  /** Plays a list from `startIndex`; with shuffle on and no start given, from a random song. */
  playTracks: (tracks: Track[], startIndex?: number) => void;
  /** Turns shuffle on and plays the list shuffled. */
  shuffleTracks: (tracks: Track[]) => void;
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
  setExpandedOpen: (open: boolean) => void;
  clearQueue: () => void;
  playNext: (track: Track) => void;
  /** Removes the song at a play-order position; the token undoes it with `undoRemove`. */
  removeFromQueue: (index: number) => QueueUndo | null;
  /** Puts back a removed song. False when the queue has been replaced since. */
  undoRemove: (token: QueueUndo) => boolean;
  /** Moves an upcoming song from one play-order position to another. */
  moveInQueue: (from: number, to: number) => void;
  jumpTo: (index: number) => void;
  /** Plays a song from the history: back to it in the queue when it is there, otherwise straight after the current one. */
  playFromHistory: (track: Track) => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

const SHUFFLE_KEY = 'blank.shuffle';
const REPEAT_KEY = 'blank.repeat';

function readRepeat(): RepeatMode {
  const stored = localStorage.getItem(REPEAT_KEY);
  return stored === 'all' || stored === 'one' ? stored : 'off';
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { tracks, albums, ready: libraryReady } = useLibrary();
  const { songCovers, glyphSupported, glyphWaveform, eq, crossfade, pauseOnDisconnect } = useSettings();
  const pauseOnDisconnectRef = useRef(pauseOnDisconnect);
  pauseOnDisconnectRef.current = pauseOnDisconnect;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** Two elements take turns as the active one so a crossfade can overlap the end of one song with the start of the next. */
  const elementsRef = useRef<HTMLAudioElement[]>([]);
  const fading = useRef<HTMLAudioElement | null>(null);
  const fadeStarting = useRef(false);
  const skipLoad = useRef(false);
  const crossfadeRef = useRef(crossfade);
  crossfadeRef.current = crossfade;
  const needsEngine = crossfade > 0 || eqActive(eq);
  const eqSetting = useMemo(() => effectiveEq(eq), [eq]);
  const engineRef = useRef({ needed: needsEngine, eq: eqSetting, level: 1 });
  /** The queue in the order it was given and the order it plays in (see queue-order.ts). */
  const stateRef = useRef<QueueState<Track>>(emptyQueue());
  /** Bumped whenever a new queue replaces the old one, so an undo from the old queue is not applied to it. */
  const epochRef = useRef(0);
  /** The play order and position, mirrored from `stateRef` for the code that only needs those. */
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
  const [shuffle, setShuffle] = useState(() => localStorage.getItem(SHUFFLE_KEY) === '1');
  const [repeat, setRepeat] = useState<RepeatMode>(readRepeat);
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const getTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);
  const [generation, setGeneration] = useState(0);
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;
  repeatRef.current = repeat;

  /** Set once the queue saved at the last launch has been put back (or there was none), so it is not overwritten first. */
  const restoredRef = useRef(false);
  const lastSaved = useRef(0);

  /**
   * Remembers the queue, both orders, the shuffle and the position for the next launch. An empty queue is only
   * forgotten when it was cleared on purpose (`clear`), not because the library has not loaded yet.
   */
  const persistQueue = useCallback((position?: number, clear = false) => {
    if (!restoredRef.current) return;
    const saved = serialiseQueue(stateRef.current, shuffleRef.current, position ?? audioRef.current?.currentTime ?? 0);
    if (!saved && !clear) return;
    lastSaved.current = Date.now();
    writeSavedQueue(saved);
  }, []);
  const [historyIds, setHistoryIds] = useState<string[]>(() => readHistory());
  const historyRef = useRef(historyIds);
  const recordHistory = useCallback((id: string) => {
    const next = pushHistory(historyRef.current, id);
    if (next === historyRef.current) return;
    historyRef.current = next;
    setHistoryIds(next);
    writeHistory(next);
  }, []);
  const persistRef = useRef(persistQueue);
  persistRef.current = persistQueue;

  /** Play. A queue put back at launch whose file could not be opened yet loads the song first. */
  const resumeRef = useRef(() => {
    const audio = audioRef.current;
    if (!audio || !queueRef.current.length) return;
    if (!audio.getAttribute('src')) setGeneration((value) => value + 1);
    else void audio.play();
  });

  /** Makes `state` the queue. `load` starts the song now at its position (a different song, or the same one again). */
  const apply = useCallback(
    (state: QueueState<Track>, load: boolean) => {
      const list = playOrder(state);
      stateRef.current = state;
      queueRef.current = list;
      indexRef.current = state.index;
      setQueue(list);
      setIndex(state.index);
      if (load) {
        setGeneration((value) => value + 1);
        const playingNow = list[state.index];
        if (playingNow) recordHistory(playingNow.id);
      }
      persistQueue(load ? 0 : undefined);
    },
    [persistQueue, recordHistory],
  );

  /** Where a skip goes. Repeat-one only repeats a song that finishes on its own, so a skip still moves on. */
  const following = useCallback(
    (repeatMode: RepeatMode) => advance(stateRef.current, repeatMode === 'one' ? 'all' : repeatMode, shuffleRef.current),
    [],
  );

  const next = useCallback(() => {
    if (!queueRef.current.length) return;
    const target = following(repeatRef.current);
    if (target) {
      apply(target, true);
      return;
    }
    audioRef.current?.pause();
    setPlaying(false);
  }, [apply, following]);

  /** A song played to its end: repeat-one plays it again, anything else moves on. */
  const finished = useCallback(() => {
    if (repeatRef.current === 'one') {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = 0;
      void audio.play();
      return;
    }
    next();
  }, [next]);

  const finishedRef = useRef(finished);
  finishedRef.current = finished;

  const cancelFade = useCallback(() => {
    const ghost = fading.current;
    fading.current = null;
    if (ghost) {
      ghost.pause();
      ghost.removeAttribute('src');
      ghost.load();
    }
    audioEngine.settle();
  }, []);

  const startCrossfade = useCallback(
    (outgoing: HTMLAudioElement, target: QueueState<Track>) => {
      const from = stateRef.current;
      const upcoming = playOrder(target)[target.index];
      const elements = elementsRef.current;
      const incoming = elements.find((element) => element !== outgoing);
      if (!upcoming || !incoming) return;
      fadeStarting.current = true;
      void (async () => {
        try {
          const url = await audioObjectUrl(upcoming.audioFileId);
          if (audioRef.current !== outgoing || stateRef.current !== from || outgoing.paused) return;
          incoming.src = url;
          incoming.currentTime = 0;
          audioEngine.silence(elements.indexOf(incoming));
          await incoming.play();
          const remaining = outgoing.duration - outgoing.currentTime;
          if (audioRef.current !== outgoing || !(remaining > 0.5)) {
            incoming.pause();
            audioEngine.settle();
            return;
          }
          fading.current = outgoing;
          audioRef.current = incoming;
          skipLoad.current = true;
          setCurrentTime(0);
          setDuration(Number.isFinite(incoming.duration) ? incoming.duration : 0);
          audioEngine.crossfade(elements.indexOf(outgoing), elements.indexOf(incoming), remaining, () => {
            if (fading.current === outgoing) cancelFade();
          });
          apply(target, true);
        } catch {
          audioEngine.settle();
        } finally {
          fadeStarting.current = false;
        }
      })();
    },
    [apply, cancelFade],
  );

  const startCrossfadeRef = useRef(startCrossfade);
  startCrossfadeRef.current = startCrossfade;
  const cancelFadeRef = useRef(cancelFade);
  cancelFadeRef.current = cancelFade;

  useEffect(() => {
    const elements = [new Audio(), new Audio()];
    elementsRef.current = elements;
    audioRef.current = elements[0]!;
    if (engineRef.current.needed) audioEngine.ensure(elements, engineRef.current.eq, engineRef.current.level);
    const cleanups = elements.map((audio) => {
      audio.preload = 'auto';
      const active = () => audioRef.current === audio;
      const onTime = () => {
        if (!active()) return;
        setCurrentTime(audio.currentTime || 0);
        if (!audio.paused && Date.now() - lastSaved.current > 5000) persistRef.current();
        const seconds = crossfadeRef.current;
        if (!seconds || fading.current || fadeStarting.current || audio.paused || !audioEngine.connected) return;
        if (!Number.isFinite(audio.duration) || audio.duration < seconds * 2 + 2) return;
        const remaining = audio.duration - audio.currentTime;
        if (remaining > seconds || remaining < 0.6 || repeatRef.current === 'one') return;
        const target = advance(stateRef.current, repeatRef.current, shuffleRef.current);
        if (target && playOrder(target)[target.index] !== queueRef.current[indexRef.current]) startCrossfadeRef.current(audio, target);
      };
      const onMeta = () => {
        if (active()) setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
      };
      const onPlay = () => {
        if (!active()) return;
        setPlaying(true);
        audioEngine.resume();
      };
      const onPause = () => {
        if (!active()) return;
        if (fading.current) cancelFadeRef.current();
        setPlaying(false);
        persistRef.current();
      };
      const onEnded = () => {
        if (active()) finishedRef.current();
      };
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
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);

  useEffect(() => {
    if (generation === 0) return;
    if (skipLoad.current) {
      skipLoad.current = false;
      setLoading(false);
      return;
    }
    cancelFade();
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
      } catch (err) {
        if (!cancelled) {
          setPlaying(false);
          const message = err instanceof Error ? err.message : '';
          if (/YouTube|sign in|playable stream|Download failed/i.test(message)) {
            window.dispatchEvent(new CustomEvent('blank:playback-error', { detail: message }));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [generation, cancelFade]);

  useEffect(() => {
    if (!stateRef.current.ordered.length) return;
    const byId = new Map(tracks.map((track) => [track.id, track]));
    apply(mapQueue(stateRef.current, (track) => byId.get(track.id) ?? track), false);
  }, [tracks, apply]);

  const previous = useCallback(() => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    const target = retreat(stateRef.current);
    if (target) apply(target, true);
    else if (audio) audio.currentTime = 0;
  }, [apply]);

  engineRef.current = { needed: needsEngine, eq: eqSetting, level: muted ? 0 : volume };
  useEffect(() => {
    if (needsEngine) audioEngine.ensure(elementsRef.current, eqSetting, muted ? 0 : volume);
  }, [needsEngine, eqSetting, muted, volume]);

  useEffect(() => {
    audioEngine.setEq(eqSetting);
  }, [eqSetting]);

  useEffect(() => {
    const level = muted ? 0 : volume;
    if (audioEngine.connected) audioEngine.setVolume(level);
    else for (const element of elementsRef.current) element.volume = level;
  }, [muted, volume, needsEngine]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => resumeRef.current());
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

  const toggleShuffleRef = useRef<() => void>(() => undefined);
  const controlsRef = useRef<(action: ControlAction) => void>(() => undefined);
  controlsRef.current = (control) => {
    const audio = audioRef.current;
    if (control.action === 'play') resumeRef.current();
    else if (control.action === 'pause') audio?.pause();
    else if (control.action === 'next') next();
    else if (control.action === 'previous') previous();
    else if (control.action === 'shuffle') toggleShuffleRef.current();
    // Headphones or Bluetooth went away: pause through the normal path, so the screens and the notification follow.
    // It never resumes on its own when they come back.
    else if (control.action === 'noisy') {
      if (pauseOnDisconnectRef.current && audio && !audio.paused) audio.pause();
    }
    else if (control.action === 'seekto' && audio && control.position !== undefined) {
      audio.currentTime = Math.max(0, control.position);
      setCurrentTime(audio.currentTime);
    }
  };

  const nowPlaying = queue[index] ?? null;
  const nowPlayingCover = nowPlaying
    ? coverFor(nowPlaying, albums.find((item) => item.id === nowPlaying.albumId), songCovers)
    : null;
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
        trackId: nowPlaying.id,
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        album: albums.find((item) => item.id === nowPlaying.albumId)?.name ?? '',
        durationMs: seconds * 1000,
        positionMs: audio.currentTime * 1000,
        playing: !audio.paused,
        artwork,
        peaks: glyphSupported && glyphWaveform ? readPeaks(nowPlaying.waveform, nowPlaying.id) : undefined,
        shuffle,
        widgetPeaks: readPeaks(nowPlaying.waveform, nowPlaying.id),
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
  }, [albums, nowPlaying, nowPlayingCover, playing, shuffle, glyphSupported, glyphWaveform]);

  const playTracks = useCallback(
    (list: Track[], startIndex?: number) => {
      if (!list.length) return;
      epochRef.current += 1;
      apply(startQueue(list, startIndex, shuffleRef.current), true);
    },
    [apply],
  );

  const writeShuffle = useCallback((on: boolean) => {
    shuffleRef.current = on;
    setShuffle(on);
    localStorage.setItem(SHUFFLE_KEY, on ? '1' : '0');
  }, []);

  const shuffleTracks = useCallback(
    (list: Track[]) => {
      if (!list.length) return;
      writeShuffle(true);
      epochRef.current += 1;
      apply(startQueue(list, undefined, true), true);
    },
    [apply, writeShuffle],
  );

  const toggleTrack = useCallback(
    (track: Track, list: Track[]) => {
      const current = queueRef.current[indexRef.current];
      if (current?.id === track.id) {
        const audio = audioRef.current;
        if (!audio) return;
        if (audio.paused) resumeRef.current();
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
    if (audio.paused) resumeRef.current();
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
    setVolumeState(nextVolume);
    setMuted(nextVolume === 0);
    localStorage.setItem('blank.volume', String(nextVolume));
  }, []);

  const toggleMute = useCallback(() => {
    if (muted || volume === 0) setVolume(lastVolume.current || 0.9);
    else setVolume(0);
  }, [muted, setVolume, volume]);

  const clearQueue = useCallback(() => {
    cancelFade();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    epochRef.current += 1;
    stateRef.current = emptyQueue();
    queueRef.current = [];
    indexRef.current = 0;
    setQueue([]);
    setIndex(0);
    setPlaying(false);
    setLoading(false);
    setCurrentTime(0);
    setDuration(0);
    setQueueOpen(false);
    setLyricsOpen(false);
    setExpandedOpen(false);
    setGeneration((value) => value + 1);
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
    persistQueue(0, true);
  }, [cancelFade, persistQueue]);

  // Put back the queue from the last launch, paused where it was, once the library is there to find the songs in.
  useEffect(() => {
    if (!libraryReady || restoredRef.current) return;
    restoredRef.current = true;
    if (!tracks.length || stateRef.current.slots.length) return;
    const restored = restoreQueue(readSavedQueue(), tracks);
    if (!restored) return;
    shuffleRef.current = restored.shuffle;
    setShuffle(restored.shuffle);
    localStorage.setItem('blank.shuffle', restored.shuffle ? '1' : '0');
    apply(restored.state, false);
    const track = playOrder(restored.state)[restored.state.index];
    const audio = audioRef.current;
    if (!track || !audio) return;
    const position = restored.position;
    setCurrentTime(position);
    void (async () => {
      try {
        const url = await audioObjectUrl(track.audioFileId);
        // Something else was played in the meantime.
        if (audioRef.current !== audio || queueRef.current[indexRef.current] !== track || audio.src) return;
        audio.preload = 'auto';
        audio.src = url;
        const seekTo = () => {
          if (position > 0 && position < (audio.duration || Infinity) - 1) audio.currentTime = position;
          setCurrentTime(audio.currentTime || 0);
        };
        if (audio.readyState >= 1) seekTo();
        else audio.addEventListener('loadedmetadata', seekTo, { once: true });
      } catch {
        /* the file is not available right now; pressing play loads it as usual */
      }
    })();
  }, [libraryReady, tracks, apply]);

  // Leaving the app (switching away, screen off, closing) saves the exact position.
  useEffect(() => {
    const save = () => persistRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    const handle = Capacitor.isNativePlatform()
      ? App.addListener('appStateChange', (state) => {
          if (!state.isActive) save();
        })
      : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
      void handle?.then((listener) => listener.remove());
    };
  }, []);

  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current;
    writeShuffle(on);
    // The song playing carries on; only what comes after it changes.
    if (stateRef.current.slots.length) apply(reorder(stateRef.current, on), false);
  }, [apply, writeShuffle]);
  toggleShuffleRef.current = toggleShuffle;

  const cycleRepeat = useCallback(() => {
    const nextMode: RepeatMode = repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = nextMode;
    localStorage.setItem(REPEAT_KEY, nextMode);
    setRepeat(nextMode);
  }, []);

  const playNext = useCallback(
    (track: Track) => {
      const wasEmpty = !stateRef.current.slots.length;
      apply(insertNext(stateRef.current, track), wasEmpty);
    },
    [apply],
  );

  const removeFromQueue = useCallback(
    (at: number): QueueUndo | null => {
      const result = removeWithUndo(stateRef.current, at);
      if (!result) return null;
      apply(result.state, false);
      return { removed: result.removed, epoch: epochRef.current };
    },
    [apply],
  );

  const undoRemove = useCallback(
    (token: QueueUndo) => {
      if (token.epoch !== epochRef.current || !stateRef.current.slots.length) return false;
      apply(reinsert(stateRef.current, token.removed), false);
      return true;
    },
    [apply],
  );

  const moveInQueue = useCallback(
    (from: number, to: number) => {
      const nextState = moveUpcoming(stateRef.current, from, to);
      if (nextState !== stateRef.current) apply(nextState, false);
    },
    [apply],
  );

  const playFromHistory = useCallback(
    (track: Track) => {
      const state = stateRef.current;
      const order = playOrder(state);
      for (let at = state.index; at >= 0; at -= 1) {
        if (order[at]?.id === track.id) {
          if (at === state.index) resumeRef.current();
          else apply(jump(state, at), true);
          return;
        }
      }
      if (!state.slots.length) {
        epochRef.current += 1;
        apply(startQueue([track], 0, false), true);
        return;
      }
      const inserted = insertNext(state, track);
      apply(jump(inserted, inserted.index + 1), true);
    },
    [apply],
  );

  const jumpTo = useCallback(
    (nextIndex: number) => {
      if (stateRef.current.slots.length) apply(jump(stateRef.current, nextIndex), true);
    },
    [apply],
  );

  const track = queue[index] ?? null;
  const history = useMemo(() => historyTracks(historyIds, new Map(tracks.map((item) => [item.id, item]))), [historyIds, tracks]);

  const value = useMemo<PlayerContextValue>(
    () => ({
      queue,
      index,
      history,
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
      expandedOpen,
      getTime,
      playTracks,
      shuffleTracks,
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
      setExpandedOpen,
      clearQueue,
      playNext,
      removeFromQueue,
      undoRemove,
      moveInQueue,
      jumpTo,
      playFromHistory,
    }),
    [
      queue,
      index,
      history,
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
      expandedOpen,
      getTime,
      playTracks,
      shuffleTracks,
      toggleTrack,
      toggle,
      next,
      previous,
      seek,
      setVolume,
      toggleMute,
      toggleShuffle,
      cycleRepeat,
      clearQueue,
      playNext,
      removeFromQueue,
      undoRemove,
      moveInQueue,
      jumpTo,
      playFromHistory,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
