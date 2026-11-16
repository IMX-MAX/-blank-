import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Music2, RotateCw, X } from 'lucide-react';
import { activeLineIndex, checkSources, type SourceCheck, type LyricLine, type LyricWord, type Lyrics, type LyricsResult } from '../lib/lyrics';
import { withEstimatedWords } from '../lib/estimate';
import { addPronunciation } from '../lib/romanize';
import { loadLyrics } from '../lib/lyrics-load';
import { saveTranslatedLyrics } from '../lib/lyrics-cache';
import { lyricsGeneration } from '../lib/lyrics-epoch';
import { RowGlide, staggerFor } from '../lib/lyric-spring';
import { deviceLanguage, hasTranslationFor, machineTranslate, needsMachineTranslation } from '../lib/translate';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useLyricsVersion } from '../state/useLyricsVersion';
import type { Track } from '../types';
import { coverFor } from '../lib/covers';
import { setKeepAwake } from '../lib/keep-awake';
import { useSettings } from '../state/SettingsProvider';
import { Wash } from './Wash';
import { ShareLyricsSheet } from './ShareLyrics';
import { pressHaptic, tickHaptic } from '../lib/haptics';
import { interceptBack } from '../lib/navigation';
import { SHARE_MAX_LINES, toggleSelection } from '../lib/share-layout';

type State = { status: 'loading' } | { status: 'error' } | LyricsResult;

function useLyrics(track: Track | null, album: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Goes up when cached lyrics are cleared or a different lyric is picked: load them again.
  const version = useLyricsVersion();
  const { cacheLyrics } = useSettings();
  const cacheRef = useRef(cacheLyrics);
  cacheRef.current = cacheLyrics;
  const trackId = track?.id;
  const title = track?.title;
  const artist = track?.artist;
  const durationMs = track?.durationMs ?? 0;

  useEffect(() => {
    if (!trackId || !title) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadLyrics({ id: trackId, title, artist: artist ?? '', durationMs }, album, controller.signal, cacheRef.current)
      .then((result) => {
        if (!controller.signal.aborted) setState(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [trackId, title, artist, album, durationMs, attempt, version]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}

const MODE_LABEL: Record<Lyrics['mode'], string> = {
  word: 'Word-synced',
  line: '',
  plain: 'Unsynced',
};

const INTERLUDE_SECONDS = 5;
const ANCHOR = 0.28;
const BACKING_BEFORE = 0.3;
const BACKING_AFTER = 0.7;

type Item = { kind: 'line'; index: number } | { kind: 'gap' } | { kind: 'dots'; start: number; end: number };

/** A line stays lit until its backing vocals have finished too. */
const lineEnd = (line: LyricLine) => Math.max(line.end, line.bg?.end ?? 0);

/** The lyrics as rows, with a row of dots wherever the singing stops for a while. */
function buildItems(lines: LyricLine[], synced: boolean): Item[] {
  const items: Item[] = [];
  if (synced && lines.length && lines[0]!.start >= INTERLUDE_SECONDS - 1) items.push({ kind: 'dots', start: 0, end: lines[0]!.start });
  lines.forEach((line, index) => {
    if (!line.text.trim()) {
      items.push({ kind: 'gap' });
      return;
    }
    items.push({ kind: 'line', index });
    const next = lines[index + 1];
    if (synced && next && next.start - lineEnd(line) >= INTERLUDE_SECONDS) items.push({ kind: 'dots', start: lineEnd(line), end: next.start });
  });
  return items;
}

type View = { anchor: number; hot: string; dots: number };
const START_VIEW: View = { anchor: -1, hot: '', dots: -1 };

function wordSpans(
  words: LyricWord[],
  groups: Array<{ from: number; to: number; text: string }> | undefined,
) {
  const span = (word: LyricWord, index: number) => (
    <span className={word.end - word.start >= 1.1 && word.text.trim().length <= 8 ? 'lw long' : 'lw'} key={index}>
      {word.text}
    </span>
  );
  if (!groups) return words.map(span);
  return groups.map((group, index) => (
    <span className="rg" key={index}>
      <span className="rg-w">{words.slice(group.from, group.to).map((word, offset) => span(word, group.from + offset))}</span>
      <span className={group.text ? 'rg-r' : 'rg-r empty'}>{group.text}</span>
    </span>
  ));
}

/** Puts the translations of `from` on the same lines of `onto` (the same lyrics, with readings or estimated words added). */
function withTranslations(onto: Lyrics, from: Lyrics): Lyrics {
  if (onto === from || onto.lines.length !== from.lines.length) return onto === from ? onto : { ...onto, translation: undefined };
  return {
    ...onto,
    translation: from.translation,
    lines: onto.lines.map((line, index) => {
      const source = from.lines[index]!;
      const next: LyricLine = { ...line, translation: source.translation };
      if (next.bg) next.bg = { ...next.bg, translation: source.bg?.translation };
      return next;
    }),
  };
}

type RowProps = {
  line: LyricLine;
  index: number;
  item: number;
  status: 'hot' | 'past' | 'future' | 'plain';
  distance: number;
  synced: boolean;
  /** Draw the translation under the line. */
  translated: boolean;
  seek: (time: number) => void;
  register: (item: number, element: HTMLElement | null) => void;
  /** Choosing lines to share: a tap picks the line instead of jumping to it. */
  selecting: boolean;
  picked: boolean;
  onPick: (index: number) => void;
  /** A long press on the line, to start choosing lines to share. */
  onHold: (index: number) => void;
};

const HOLD_MS = 450;
const HOLD_SLOP = 10;

const Row = memo(function Row({ line, index, item, status, distance, synced, translated, seek, register, selecting, picked, onPick, onHold }: RowProps) {
  const hold = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const cancelHold = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
  };
  useEffect(() => cancelHold, []);
  const classes = ['ly', status];
  if (selecting) classes.push(picked ? 'picked' : 'unpicked');
  if (line.align) classes.push(line.align);
  if (line.backing) classes.push('backing');
  const words = synced && line.words.length ? line.words : null;
  const bg = synced ? line.bg : undefined;
  return (
    <div
      ref={(element) => register(item, element)}
      data-line={index}
      className={classes.join(' ')}
      style={{ ['--d' as string]: distance } as CSSProperties}
      onClick={() => {
        // The click that ends a long press does nothing more.
        if (hold.current?.fired) {
          hold.current = null;
          return;
        }
        if (selecting) onPick(index);
        else if (synced) seek(line.start);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !line.text.trim()) return;
        cancelHold();
        const state = { timer: 0, x: event.clientX, y: event.clientY, fired: false };
        state.timer = window.setTimeout(() => {
          state.fired = true;
          onHold(index);
        }, HOLD_MS);
        hold.current = state;
      }}
      onPointerMove={(event) => {
        const state = hold.current;
        if (state && !state.fired && Math.hypot(event.clientX - state.x, event.clientY - state.y) > HOLD_SLOP) cancelHold();
      }}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => {
        // Right-click, or a long press the browser turned into a context menu.
        event.preventDefault();
        if (hold.current?.fired || !line.text.trim()) return;
        cancelHold();
        hold.current = { timer: 0, x: 0, y: 0, fired: true };
        onHold(index);
      }}
      role={synced || selecting ? 'button' : undefined}
      aria-pressed={selecting ? picked : undefined}
    >
      <div className="ly-in">
        <div className="ly-main">{words ? wordSpans(words, line.romanGroups) : line.text}</div>
        {line.roman ? <div className="ly-roman">{line.roman}</div> : null}
        {translated && line.translation ? <div className="ly-tr">{line.translation}</div> : null}
        {bg ? (
          <div className="ly-bg">
            <div className="ly-main">{bg.words.length ? wordSpans(bg.words, undefined) : bg.text}</div>
            {bg.roman ? <div className="ly-roman">{bg.roman}</div> : null}
            {translated && bg.translation ? <div className="ly-tr">{bg.translation}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const Dots = memo(function Dots({ item, active, register }: { item: number; active: boolean; register: (item: number, element: HTMLElement | null) => void }) {
  return (
    <div ref={(element) => register(item, element)} className={active ? 'ly-dots on' : 'ly-dots'} aria-hidden>
      <i />
      <i />
      <i />
    </div>
  );
});

export function LyricsView() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const track = player.track;
  const { songCovers, keepAwake, pronunciation, estimateWords, translation: translationOn } = useSettings();
  const album = albums.find((item) => item.id === track?.albumId);
  const { state, retry } = useLyrics(track, album?.name);
  const found = state.status === 'found' ? state.lyrics : null;
  const [why, setWhy] = useState<SourceCheck[] | 'running' | null>(null);
  const explain = () => {
    if (!track) return;
    if (why) {
      setWhy(null);
      return;
    }
    setWhy('running');
    checkSources(undefined, { title: track.title, artist: track.artist ?? '', duration: track.durationMs / 1000 })
      .then(setWhy)
      .catch(() => setWhy(null));
  };
  useEffect(() => setWhy(null), [track?.id]);

  // Lyrics with no translation in the phone's language get one from Google Translate, which is then saved in the
  // same cache entries as the lyrics, so it opens offline with them and is cleared with them.
  const target = useMemo(() => deviceLanguage(), []);
  const [machine, setMachine] = useState<{ source: Lyrics; lyrics: Lyrics } | null>(null);
  const foundResult = state.status === 'found' ? state : null;
  useEffect(() => {
    setMachine(null);
    if (!foundResult || !track || !translationOn || !needsMachineTranslation(foundResult.lyrics, target)) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const controller = new AbortController();
    const started = lyricsGeneration();
    const song = { id: track.id, title: track.title, artist: track.artist ?? '' };
    machineTranslate(foundResult.lyrics, target, undefined, controller.signal)
      .then((lyrics) => {
        if (controller.signal.aborted) return;
        setMachine({ source: foundResult.lyrics, lyrics });
        void saveTranslatedLyrics(song, { ...foundResult, lyrics }, started).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // The track is read for its tags only; a new track always brings new lyrics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foundResult, translationOn, target]);
  const withMachine = found && machine && machine.source === found ? machine.lyrics : found;
  const base = useMemo(() => (found && estimateWords ? withEstimatedWords(found) : found), [found, estimateWords]);

  const [enriched, setEnriched] = useState<{ source: Lyrics; lyrics: Lyrics } | null>(null);
  useEffect(() => {
    setEnriched(null);
    if (!base || !pronunciation) return;
    let cancelled = false;
    addPronunciation(base)
      .then((lyrics) => {
        if (!cancelled && lyrics !== base) setEnriched({ source: base, lyrics });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [base, pronunciation]);
  const shown = enriched && enriched.source === base ? enriched.lyrics : base;
  const lyrics = useMemo(() => (shown && withMachine ? withTranslations(shown, withMachine) : shown), [shown, withMachine]);
  const translated = translationOn && lyrics !== null && hasTranslationFor(lyrics, target);
  const synced = lyrics !== null && lyrics.mode !== 'plain';

  useEffect(() => {
    if (!keepAwake) return;
    setKeepAwake(true);
    return () => setKeepAwake(false);
  }, [keepAwake]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useRef<Array<HTMLElement | null>>([]);
  const [view, setView] = useState<View>(START_VIEW);
  const viewRef = useRef<View>(START_VIEW);
  const holdScrollUntil = useRef(0);
  // Choosing lines to share: the picked line numbers, or null when not choosing.
  const [picked, setPicked] = useState<number[] | null>(null);
  const [sharing, setSharing] = useState(false);
  const [capHint, setCapHint] = useState(false);
  const capTimer = useRef(0);
  const selectingRef = useRef(false);
  selectingRef.current = picked !== null;
  const realign = useRef(0);
  const aligned = useRef(false);
  const { getTime, seek } = player;

  const lines = useMemo(() => lyrics?.lines ?? [], [lyrics]);
  const items = useMemo(() => buildItems(lines, synced), [lines, synced]);
  const itemOfLine = useMemo(() => {
    const map = new Map<number, number>();
    items.forEach((item, index) => {
      if (item.kind === 'line') map.set(item.index, index);
    });
    return map;
  }, [items]);

  const register = useCallback((item: number, element: HTMLElement | null) => {
    rows.current[item] = element;
  }, []);

  useEffect(() => {
    viewRef.current = START_VIEW;
    setView(START_VIEW);
    aligned.current = false;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [base]);

  useEffect(() => {
    if (!lyrics || !synced) return;
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    let litLines: number[] = [];
    /** Lines left filled after they were sung. */
    const filled = new Set<number>();
    const cache = new Map<number, { words: HTMLElement[]; back: HTMLElement[]; bg: HTMLElement | null }>();

    const lookup = (index: number) => {
      let found = cache.get(index);
      if (!found) {
        const row = root.querySelector<HTMLElement>(`[data-line="${index}"]`);
        found = {
          words: row ? Array.from(row.querySelectorAll<HTMLElement>('.ly-in > .ly-main .lw')) : [],
          back: row ? Array.from(row.querySelectorAll<HTMLElement>('.ly-bg .lw')) : [],
          bg: row?.querySelector<HTMLElement>('.ly-bg') ?? null,
        };
        cache.set(index, found);
      }
      return found;
    };

    const paint = (spans: HTMLElement[], words: LyricWord[], time: number) => {
      words.forEach((word, wordIndex) => {
        const progress = Math.min(1, Math.max(0, (time - word.start) / Math.max(0.05, word.end - word.start)));
        spans[wordIndex]?.style.setProperty('--p', progress.toFixed(3));
      });
    };

    const tick = () => {
      const time = getTime();
      const anchor = activeLineIndex(lines, time);
      const hot: number[] = [];
      for (let index = anchor; index >= 0 && index > anchor - 6; index -= 1) {
        if (time < lineEnd(lines[index]!)) hot.unshift(index);
      }
      const dotsAt = items.findIndex((item) => item.kind === 'dots' && time >= item.start && time < item.end);
      const next: View = { anchor, hot: hot.join(','), dots: dotsAt };
      const current = viewRef.current;
      if (next.anchor !== current.anchor || next.hot !== current.hot || next.dots !== current.dots) {
        viewRef.current = next;
        setView(next);
      }

      // A line that stops being sung keeps its words filled. Its class only changes from `hot` to `past` when React
      // renders, after this frame is painted, so clearing the fill here drew the whole line unlit (and without its
      // glow) for a frame just before it settled: the flash before each line change. The fill is cleared only once
      // the line is back ahead of the playhead (a seek backwards), where the `future` class wants it empty anyway.
      for (const gone of litLines.filter((index) => !hot.includes(index))) {
        const found = lookup(gone);
        const sung = time >= lines[gone]!.start;
        [...found.words, ...found.back].forEach((span) => (sung ? span.style.setProperty('--p', '1') : span.style.removeProperty('--p')));
        if (sung) filled.add(gone);
        found.bg?.classList.remove('on');
      }
      for (const index of filled) {
        if (hot.includes(index) || time >= lines[index]!.start) continue;
        const found = lookup(index);
        [...found.words, ...found.back].forEach((span) => span.style.removeProperty('--p'));
        filled.delete(index);
      }
      litLines = hot;
      for (const index of hot) {
        const line = lines[index]!;
        const found = lookup(index);
        if (line.words.length) paint(found.words, line.words, time);
        if (line.bg) {
          if (line.bg.words.length) paint(found.back, line.bg.words, time);
          found.bg?.classList.toggle('on', time >= line.bg.start - BACKING_BEFORE && time < line.bg.end + BACKING_AFTER);
        }
      }

      if (dotsAt >= 0) {
        const item = items[dotsAt] as Extract<Item, { kind: 'dots' }>;
        const dots = rows.current[dotsAt];
        if (dots) {
          const progress = (time - item.start) / Math.max(0.1, item.end - item.start);
          dots.querySelectorAll<HTMLElement>('i').forEach((dot, dotIndex) => {
            dot.style.setProperty('--p', Math.min(1, Math.max(0, progress * 3 - dotIndex)).toFixed(3));
          });
          dots.style.setProperty('--out', Math.min(1, Math.max(0, (time - (item.end - 0.7)) / 0.7)).toFixed(3));
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      root.querySelectorAll<HTMLElement>('.lw').forEach((span) => span.style.removeProperty('--p'));
    };
  }, [lyrics, synced, lines, items, getTime]);

  const anchorItem = useMemo(() => {
    if (view.dots >= 0) return view.dots;
    if (view.anchor >= 0) return itemOfLine.get(view.anchor) ?? 0;
    return 0;
  }, [view.dots, view.anchor, itemOfLine]);

  const glideRef = useRef(new RowGlide<HTMLElement>());
  const glideFrame = useRef(0);

  const stopGlide = useCallback(() => {
    cancelAnimationFrame(glideFrame.current);
    glideFrame.current = 0;
    for (const element of glideRef.current.clear()) element.style.transform = '';
  }, []);

  const pumpGlide = useCallback(() => {
    if (glideFrame.current) return;
    const step = (now: number) => {
      for (const [element, y] of glideRef.current.frame(now)) {
        element.style.transform = y === 0 ? '' : `translate3d(0, ${y.toFixed(2)}px, 0)`;
      }
      glideFrame.current = glideRef.current.active ? requestAnimationFrame(step) : 0;
    };
    glideFrame.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => stopGlide, [stopGlide]);

  const alignTo = useCallback(
    (item: number, mode: 'instant' | 'spring' | 'smooth') => {
      const root = scrollRef.current;
      const row = rows.current[item];
      if (!root || !row) return;
      // offsetTop ignores transforms, so rows that are still gliding measure where they will end up.
      const target = Math.max(0, row.offsetTop - root.clientHeight * ANCHOR);
      const before = root.scrollTop;
      if (mode === 'smooth') {
        stopGlide();
        root.scrollTo({ top: target, behavior: 'smooth' });
        return;
      }
      root.scrollTop = target;
      const delta = root.scrollTop - before;
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (mode === 'instant' || reduced || Math.abs(delta) > root.clientHeight * 1.5) {
        stopGlide();
        return;
      }
      if (Math.abs(delta) < 0.5) return;

      // Every row on screen before or after the jump is drawn where it was and glides to its new place.
      const top = before - root.clientHeight;
      const bottom = before + root.clientHeight * 2 + Math.abs(delta);
      const moving: Array<{ key: HTMLElement; delay: number }> = [];
      rows.current.forEach((element, index) => {
        if (element && element.offsetTop > top && element.offsetTop < bottom) moving.push({ key: element, delay: staggerFor(index - item) });
      });
      const now = performance.now();
      glideRef.current.shift(moving, delta, now);
      // Draw the starting offsets in this same frame, before the browser paints the new scroll position.
      for (const { key } of moving) key.style.transform = `translate3d(0, ${glideRef.current.offset(key, now).toFixed(2)}px, 0)`;
      pumpGlide();
    },
    [pumpGlide, stopGlide],
  );

  // A layout effect, so the new line's highlight and the scroll that brings it into place are painted together.
  useLayoutEffect(() => {
    if (!synced || !lines.length) return;
    if (selectingRef.current || Date.now() < holdScrollUntil.current) return;
    alignTo(anchorItem, aligned.current ? 'spring' : 'instant');
    aligned.current = true;
  }, [anchorItem, synced, lines, alignTo]);

  useEffect(() => {
    if (!synced || !aligned.current) return;
    alignTo(viewRef.current.dots >= 0 ? viewRef.current.dots : (itemOfLine.get(viewRef.current.anchor) ?? 0), 'instant');
    // A reading or a translation appearing under the words makes the rows taller.
  }, [enriched, machine, translated, synced, itemOfLine, alignTo]);

  const holdAutoScroll = useCallback(() => {
    // Rows still gliding finish on their own: a transform adds to the finger's scroll, so neither jumps.
    holdScrollUntil.current = Date.now() + 2800;
    window.clearTimeout(realign.current);
    realign.current = window.setTimeout(() => {
      if (selectingRef.current) return;
      const current = viewRef.current;
      alignTo(current.dots >= 0 ? current.dots : (itemOfLine.get(current.anchor) ?? 0), 'smooth');
    }, 2900);
  }, [alignTo, itemOfLine]);

  useEffect(() => () => window.clearTimeout(realign.current), []);

  // Tapping a line to jump there is not a manual scroll: the list follows straight away.
  const seekLine = useCallback(
    (time: number) => {
      holdScrollUntil.current = 0;
      window.clearTimeout(realign.current);
      seek(time);
    },
    [seek],
  );

  const startPicking = useCallback((index: number) => {
    pressHaptic();
    window.clearTimeout(realign.current);
    setSharing(false);
    setPicked((current) => (current ? toggleSelection(current, index).next : [index]));
  }, []);

  const pickedRef = useRef<number[] | null>(null);
  pickedRef.current = picked;
  const pickLine = useCallback((index: number) => {
    const current = pickedRef.current;
    if (!current) return;
    const { next, capped } = toggleSelection(current, index);
    tickHaptic();
    if (capped) {
      setCapHint(true);
      window.clearTimeout(capTimer.current);
      capTimer.current = window.setTimeout(() => setCapHint(false), 1800);
    }
    pickedRef.current = next;
    setPicked(next);
  }, []);

  const stopPicking = useCallback(() => {
    setPicked(null);
    setSharing(false);
    setCapHint(false);
    holdScrollUntil.current = 0;
    const current = viewRef.current;
    alignTo(current.dots >= 0 ? current.dots : (itemOfLine.get(current.anchor) ?? 0), 'smooth');
  }, [alignTo, itemOfLine]);

  // Back closes the share screen, then the choosing, before the lyrics.
  useEffect(() => {
    if (picked === null) return;
    return interceptBack(() => {
      if (sharing) setSharing(false);
      else stopPicking();
      return true;
    });
  }, [picked === null, sharing, stopPicking]);

  // A new song ends choosing.
  useEffect(() => {
    setPicked(null);
    setSharing(false);
  }, [track?.id]);
  useEffect(() => () => window.clearTimeout(capTimer.current), []);

  if (!track) return null;

  const pickedSet = new Set(picked ?? []);
  const selecting = picked !== null;
  // While choosing or sharing lines the player bar steps aside so it cannot cover the buttons.
  useEffect(() => {
    if (!selecting && !sharing) return;
    const root = document.documentElement;
    root.dataset.sharingLyrics = '';
    return () => {
      delete root.dataset.sharingLyrics;
    };
  }, [selecting, sharing]);

  const hotSet = new Set(view.hot ? view.hot.split(',').map(Number) : []);

  return (
    <section className="lyrics" data-overlay aria-label="Lyrics">
      <Wash fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="lyrics-bg" />
      <div className="lyrics-shade" />
      {selecting ? (
        <header className="lyrics-head lyrics-select-head">
          <button className="icon-btn" aria-label="Stop choosing lines" onClick={stopPicking}>
            <X size={19} />
          </button>
          <div className="lyrics-names">
            <div className="lyrics-title">{picked.length ? `${picked.length} ${picked.length === 1 ? 'line' : 'lines'} selected` : 'Select lyrics'}</div>
            <div className={capHint ? 'lyrics-artist select-hint cap' : 'lyrics-artist select-hint'}>
              {capHint ? `You can share up to ${SHARE_MAX_LINES} lines` : `Tap up to ${SHARE_MAX_LINES} lines to share`}
            </div>
          </div>
          <button className="select-next" disabled={!picked.length} onClick={() => setSharing(true)}>
            Next
          </button>
        </header>
      ) : (
      <header className="lyrics-head">
        <button className="icon-btn" aria-label="Close lyrics" onClick={() => player.setLyricsOpen(false)}>
          <ChevronDown size={20} />
        </button>
        <div className="lyrics-names">
          <div className="lyrics-title">{track.title}</div>
          <div className="lyrics-artist">{track.artist}</div>
        </div>
        {lyrics?.estimated ? (
          <button className="lyrics-chip estimated" onClick={explain} aria-expanded={why !== null}>
            Estimated
          </button>
        ) : lyrics && lyrics.mode !== 'line' ? (
          <span className={`lyrics-chip ${lyrics.mode}`}>{MODE_LABEL[lyrics.mode]}</span>
        ) : null}
      </header>
      )}
      {why ? (
        <div className="lyrics-why">
          <div className="lyrics-why-title">Why this song is only estimated</div>
          {why === 'running' ? (
            <div>Checking the sources&hellip;</div>
          ) : (
            why.map((item) => (
              <div key={item.name} className={item.ok ? undefined : 'source-bad'}>
                {item.name}: {item.detail}
              </div>
            ))
          )}
        </div>
      ) : null}

      <div
        className="lyrics-scroll"
        ref={scrollRef}
        onWheel={holdAutoScroll}
        onTouchMove={holdAutoScroll}
        onPointerDown={holdAutoScroll}
      >
        {state.status === 'loading' ? (
          <div className="lyrics-state" aria-busy>
            <div className="lyrics-skeleton">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
        {state.status === 'error' ? (
          <div className="lyrics-state">
            <p>Could not reach the lyrics services.</p>
            <button className="text-btn" onClick={retry}>
              <RotateCw size={14} /> Try again
            </button>
          </div>
        ) : null}
        {state.status === 'none' ? (
          <div className="lyrics-state">
            <Music2 size={28} strokeWidth={1.5} />
            <p>No lyrics found for this track.</p>
            <small>Lyrics are matched on the title and artist tags.</small>
          </div>
        ) : null}
        {state.status === 'instrumental' ? (
          <div className="lyrics-state">
            <Music2 size={28} strokeWidth={1.5} />
            <p>Instrumental</p>
          </div>
        ) : null}

        {lyrics ? (
          <div className={`lyrics-lines ${lyrics.mode}${selecting ? ' selecting' : ''}`} data-haptic={selecting ? 'off' : undefined}>
            {items.map((item, position) => {
              if (item.kind === 'gap') return <div key={`g${position}`} className="ly-gap" />;
              if (item.kind === 'dots') return <Dots key={`d${position}`} item={position} active={view.dots === position} register={register} />;
              const line = lines[item.index]!;
              const status = !synced ? 'plain' : hotSet.has(item.index) ? 'hot' : item.index < view.anchor || (item.index === view.anchor && !hotSet.has(item.index)) ? 'past' : 'future';
              return (
                <Row
                  key={item.index}
                  line={line}
                  index={item.index}
                  item={position}
                  status={status}
                  distance={status === 'hot' ? 0 : Math.min(Math.abs(item.index - view.anchor), 6)}
                  synced={synced}
                  translated={translated}
                  seek={seekLine}
                  register={register}
                  selecting={selecting}
                  picked={pickedSet.has(item.index)}
                  onPick={pickLine}
                  onHold={startPicking}
                />
              );
            })}
            {translated && lyrics.translation?.by === 'machine' ? <div className="lyrics-credit">Translated by Google</div> : null}
          </div>
        ) : null}
      </div>
      {sharing && picked?.length ? (
        <ShareLyricsSheet
          title={track.title}
          artist={track.artist}
          lines={picked.map((index) => lines[index]?.text ?? '').filter((text) => text.trim())}
          coverFileId={coverFor(track, album, songCovers)}
          hue={album?.hue ?? track.hue ?? 210}
          onBack={() => setSharing(false)}
          onDone={stopPicking}
        />
      ) : null}
    </section>
  );
}
