import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Music2, RotateCw } from 'lucide-react';
import { activeLineIndex, type LyricLine, type LyricWord, type Lyrics, type LyricsResult } from '../lib/lyrics';
import { addPronunciation } from '../lib/romanize';
import { loadLyrics } from '../lib/lyrics-load';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import type { Track } from '../types';
import { coverFor } from '../lib/covers';
import { setKeepAwake } from '../lib/keep-awake';
import { useSettings } from '../state/SettingsProvider';
import { Cover } from './Cover';

type State = { status: 'loading' } | { status: 'error' } | LyricsResult;

function useLyrics(track: Track | null, album: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
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
  }, [trackId, title, artist, album, durationMs, attempt]);

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

type RowProps = {
  line: LyricLine;
  index: number;
  item: number;
  status: 'hot' | 'past' | 'future' | 'plain';
  distance: number;
  synced: boolean;
  seek: (time: number) => void;
  register: (item: number, element: HTMLElement | null) => void;
};

const Row = memo(function Row({ line, index, item, status, distance, synced, seek, register }: RowProps) {
  const classes = ['ly', status];
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
      onClick={synced ? () => seek(line.start) : undefined}
      role={synced ? 'button' : undefined}
    >
      <div className="ly-in">
        <div className="ly-main">{words ? wordSpans(words, line.romanGroups) : line.text}</div>
        {line.roman ? <div className="ly-roman">{line.roman}</div> : null}
        {bg ? (
          <div className="ly-bg">
            <div className="ly-main">{bg.words.length ? wordSpans(bg.words, undefined) : bg.text}</div>
            {bg.roman ? <div className="ly-roman">{bg.roman}</div> : null}
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
  const { songCovers, keepAwake, pronunciation } = useSettings();
  const album = albums.find((item) => item.id === track?.albumId);
  const { state, retry } = useLyrics(track, album?.name);
  const base = state.status === 'found' ? state.lyrics : null;

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
  const lyrics = enriched && enriched.source === base ? enriched.lyrics : base;
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

      for (const gone of litLines.filter((index) => !hot.includes(index))) {
        const found = lookup(gone);
        [...found.words, ...found.back].forEach((span) => span.style.removeProperty('--p'));
        found.bg?.classList.remove('on');
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

  const alignTo = useCallback((item: number, mode: 'instant' | 'spring' | 'smooth') => {
    const root = scrollRef.current;
    const row = rows.current[item];
    if (!root || !row) return;
    const target = Math.max(0, row.offsetTop - root.clientHeight * ANCHOR);
    const before = root.scrollTop;
    if (mode === 'smooth') {
      root.scrollTo({ top: target, behavior: 'smooth' });
      return;
    }
    root.scrollTop = target;
    const delta = root.scrollTop - before;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (mode === 'instant' || reduced || Math.abs(delta) < 2 || Math.abs(delta) > root.clientHeight * 1.5) return;

    // The rows jump to their new place at once, then glide there from where they were, the ones further
    // down starting a little later so the lyrics unroll like a spring.
    const near = rows.current
      .map((element, index) => ({ element, index }))
      .filter(({ element }) => element && element.offsetTop > before - root.clientHeight && element.offsetTop < before + root.clientHeight * 2);
    for (const { element } of near) {
      element!.style.transition = 'none';
      element!.style.transform = `translate3d(0, ${delta}px, 0)`;
    }
    void root.offsetHeight;
    for (const { element, index } of near) {
      const delay = Math.min(Math.max(0, index - item), 7) * 55;
      element!.style.transition = `transform 760ms cubic-bezier(0.25, 1.1, 0.4, 1) ${delay}ms`;
      element!.style.transform = '';
    }
    window.setTimeout(() => {
      for (const { element } of near) element!.style.transition = '';
    }, 1300);
  }, []);

  useEffect(() => {
    if (!synced || !lines.length) return;
    if (Date.now() < holdScrollUntil.current) return;
    alignTo(anchorItem, aligned.current ? 'spring' : 'instant');
    aligned.current = true;
  }, [anchorItem, synced, lines, alignTo]);

  useEffect(() => {
    if (!synced || !aligned.current) return;
    alignTo(viewRef.current.dots >= 0 ? viewRef.current.dots : (itemOfLine.get(viewRef.current.anchor) ?? 0), 'instant');
    // A reading appearing under the words makes the rows taller.
  }, [enriched, synced, itemOfLine, alignTo]);

  const holdAutoScroll = useCallback(() => {
    holdScrollUntil.current = Date.now() + 2800;
    window.clearTimeout(realign.current);
    realign.current = window.setTimeout(() => {
      const current = viewRef.current;
      alignTo(current.dots >= 0 ? current.dots : (itemOfLine.get(current.anchor) ?? 0), 'smooth');
    }, 2900);
  }, [alignTo, itemOfLine]);

  useEffect(() => () => window.clearTimeout(realign.current), []);

  if (!track) return null;

  const hotSet = new Set(view.hot ? view.hot.split(',').map(Number) : []);

  return (
    <section className="lyrics" data-overlay aria-label="Lyrics">
      <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="lyrics-bg" radius={0} />
      <div className="lyrics-shade" />
      <header className="lyrics-head">
        <button className="icon-btn" aria-label="Close lyrics" onClick={() => player.setLyricsOpen(false)}>
          <ChevronDown size={20} />
        </button>
        <div className="lyrics-names">
          <div className="lyrics-title">{track.title}</div>
          <div className="lyrics-artist">{track.artist}</div>
        </div>
        {lyrics && lyrics.mode !== 'line' ? <span className={`lyrics-chip ${lyrics.mode}`}>{MODE_LABEL[lyrics.mode]}</span> : null}
      </header>

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
          <div className={`lyrics-lines ${lyrics.mode}`}>
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
                  seek={seek}
                  register={register}
                />
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
