import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Music2, RotateCw } from 'lucide-react';
import { activeLineIndex, findLyrics, type LyricLine, type Lyrics, type LyricsResult } from '../lib/lyrics';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import type { Track } from '../types';
import { Cover } from './Cover';

type State = { status: 'loading' } | { status: 'error' } | LyricsResult;

function useLyrics(track: Track | null, album: string | undefined) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const trackId = track?.id;
  const title = track?.title;
  const artist = track?.artist;
  const seconds = (track?.durationMs ?? 0) / 1000;

  useEffect(() => {
    if (!trackId || !title) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    findLyrics({ title, artist: artist ?? '', album, duration: seconds }, controller.signal)
      .then(setState)
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [trackId, title, artist, album, seconds, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}

const MODE_LABEL: Record<Lyrics['mode'], string> = {
  word: 'Word-synced',
  line: 'Line-synced',
  plain: 'Unsynced',
};

const SOURCE_LABEL: Record<Lyrics['source'], string> = {
  amll: 'AMLL TTML Database',
  lrclib: 'LRCLIB',
};

export function LyricsView() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const track = player.track;
  const album = albums.find((item) => item.id === track?.albumId);
  const { state, retry } = useLyrics(track, album?.name);
  const lyrics = state.status === 'found' ? state.lyrics : null;
  const synced = lyrics !== null && lyrics.mode !== 'plain';

  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(-1);
  const holdScrollUntil = useRef(0);
  const { getTime, seek } = player;

  useEffect(() => {
    activeRef.current = -1;
    setActive(-1);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [lyrics]);

  useEffect(() => {
    if (!lyrics || !synced) return;
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    let litIndex = -1;

    const clearLine = (index: number) => {
      root.querySelectorAll<HTMLElement>(`[data-line="${index}"] .lw`).forEach((word) => word.style.removeProperty('--p'));
    };

    const tick = () => {
      const time = getTime();
      const index = activeLineIndex(lyrics.lines, time);
      if (index !== activeRef.current) {
        activeRef.current = index;
        setActive(index);
      }
      if (litIndex !== index) {
        if (litIndex >= 0) clearLine(litIndex);
        litIndex = index;
      }
      const line: LyricLine | undefined = lyrics.lines[index];
      if (line) {
        const words = root.querySelectorAll<HTMLElement>(`[data-line="${index}"] .lw`);
        line.words.forEach((word, wordIndex) => {
          const span = Math.max(0.05, word.end - word.start);
          const progress = Math.min(1, Math.max(0, (time - word.start) / span));
          words[wordIndex]?.style.setProperty('--p', progress.toFixed(3));
        });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [lyrics, synced, getTime]);

  useEffect(() => {
    if (!synced || active < 0) return;
    const root = scrollRef.current;
    const row = root?.querySelector<HTMLElement>(`[data-line="${active}"]`);
    if (!root || !row || Date.now() < holdScrollUntil.current) return;
    const top = row.offsetTop - root.clientHeight * 0.34 + row.offsetHeight / 2;
    root.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [active, synced]);

  const holdAutoScroll = useCallback(() => {
    holdScrollUntil.current = Date.now() + 2800;
  }, []);

  const lines = useMemo(() => lyrics?.lines ?? [], [lyrics]);

  if (!track) return null;

  return (
    <section className="lyrics" data-overlay aria-label="Lyrics">
      <Cover fileId={album?.coverFileId ?? track.coverFileId} hue={album?.hue ?? track.hue} className="lyrics-bg" radius={0} />
      <div className="lyrics-shade" />
      <header className="lyrics-head">
        <button className="icon-btn" aria-label="Close lyrics" onClick={() => player.setLyricsOpen(false)}>
          <ChevronDown size={20} />
        </button>
        <div className="lyrics-names">
          <div className="lyrics-title">{track.title}</div>
          <div className="lyrics-artist">{track.artist}</div>
        </div>
        {lyrics ? <span className={`lyrics-chip ${lyrics.mode}`}>{MODE_LABEL[lyrics.mode]}</span> : null}
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
            {synced && active < 0 ? <div className="lyrics-wait" aria-hidden><i /><i /><i /></div> : null}
            {lines.map((line, index) => {
              const status = !synced ? 'plain' : index < active ? 'past' : index === active ? 'active' : 'future';
              if (!line.text.trim()) return <div key={index} className="ly-gap" />;
              return (
                <div
                  key={index}
                  data-line={index}
                  className={`ly ${status}${line.align ? ` ${line.align}` : ''}`}
                  style={{ ['--d' as string]: Math.min(Math.abs(index - active), 6) } as CSSProperties}
                  onClick={synced ? () => seek(line.start) : undefined}
                  role={synced ? 'button' : undefined}
                >
                  {synced && line.words.length
                    ? line.words.map((word, wordIndex) => (
                        <span className="lw" key={wordIndex}>
                          {word.text}
                        </span>
                      ))
                    : line.text}
                </div>
              );
            })}
          </div>
        ) : null}
        {lyrics ? <p className="lyrics-credit">Lyrics from {SOURCE_LABEL[lyrics.source]}</p> : null}
      </div>
    </section>
  );
}
