import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { GripVertical, History, Repeat, Repeat1, Shuffle, Trash2, X } from 'lucide-react';
import { coverFor } from '../lib/covers';
import { dropTarget, edgeScrollSpeed, occurrenceKeys, shiftFor, swipeRemoves } from '../lib/drag-reorder';
import { formatTotal, formatTrackTime, plural } from '../lib/format';
import { tapHaptic, thudHaptic, tickHaptic } from '../lib/haptics';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer, type QueueUndo } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import type { Album, Track } from '../types';
import { Cover } from './Cover';

/** How many songs from the history are shown above the one playing. */
const HISTORY_SHOWN = 30;
const UNDO_MS = 5000;

function Bars({ playing }: { playing: boolean }) {
  return (
    <span className={playing ? 'bars on' : 'bars'} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

type Drag = { from: number; target: number; dy: number };

type RowProps = {
  track: Track;
  album: Album | undefined;
  songCovers: boolean;
  at: number;
  count: number;
  shift: number;
  dragging: boolean;
  settling: boolean;
  onPlay: (at: number) => void;
  onRemove: (at: number) => void;
  onGrab: (at: number, event: ReactPointerEvent<HTMLElement>) => void;
  onKeyMove: (at: number, to: number) => void;
  dy: number;
};

/** One upcoming song: tap to play, drag the handle to move, swipe left to remove. */
const UpcomingRow = memo(function UpcomingRow({ track, album, songCovers, at, count, shift, dragging, settling, dy, onPlay, onRemove, onGrab, onKeyMove }: RowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ id: number; x: number; y: number; t: number; dx: number; v: number; mode: 'idle' | 'swipe' | 'scroll'; armed: boolean } | null>(null);
  const swiped = useRef(false);

  const setX = (x: number, animate: boolean) => {
    const body = bodyRef.current;
    if (!body) return;
    body.style.transition = animate ? 'transform 0.24s cubic-bezier(0.2, 0.85, 0.25, 1)' : 'none';
    body.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    rowRef.current?.style.setProperty('--swipe', String(Math.min(1, -x / 120)));
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as Element).closest('.queue-handle, .queue-remove')) return;
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp, dx: 0, v: 0, mode: 'idle', armed: false };
    swiped.current = false;
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    if (!state || state.id !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dyNow = event.clientY - state.y;
    if (state.mode === 'idle') {
      if (Math.abs(dyNow) > 10 && Math.abs(dyNow) > Math.abs(dx)) state.mode = 'scroll';
      else if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dyNow) * 1.3) {
        state.mode = 'swipe';
        swiped.current = true;
        rowRef.current?.setPointerCapture(event.pointerId);
      }
    }
    if (state.mode !== 'swipe') return;
    const elapsed = Math.max(1, event.timeStamp - state.t);
    state.v = (dx - state.dx) / elapsed;
    state.t = event.timeStamp;
    state.dx = dx;
    // Only leftwards; a pull to the right gives a little and springs back.
    const x = dx < 0 ? dx : dx * 0.15;
    setX(x, false);
    const width = rowRef.current?.offsetWidth ?? 360;
    const armed = swipeRemoves(dx, width, 0);
    if (armed !== state.armed) {
      state.armed = armed;
      rowRef.current?.classList.toggle('armed', armed);
      if (armed) tickHaptic();
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    swipe.current = null;
    if (!state || state.id !== event.pointerId || state.mode !== 'swipe') return;
    const row = rowRef.current;
    const width = row?.offsetWidth ?? 360;
    if (row && swipeRemoves(state.dx, width, state.v)) {
      thudHaptic();
      setX(-width - 40, true);
      // Then fold the gap closed before the song leaves the queue.
      window.setTimeout(() => {
        row.style.height = `${row.offsetHeight}px`;
        void row.offsetHeight;
        row.classList.add('folding');
        row.style.height = '0px';
        window.setTimeout(() => onRemove(at), 190);
      }, 170);
    } else {
      row?.classList.remove('armed');
      setX(0, true);
    }
  };

  const keyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' && at > 0) onKeyMove(at, at - 1);
    else if (event.key === 'ArrowDown' && at < count - 1) onKeyMove(at, at + 1);
    else if (event.key === 'Delete' || event.key === 'Backspace') onRemove(at);
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={rowRef}
      className={`queue-row${dragging ? ' dragging' : ''}${settling ? ' settling' : ''}`}
      style={{ transform: dragging ? `translate3d(0, ${dy}px, 0)` : shift ? `translate3d(0, ${shift}px, 0)` : undefined }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div className="queue-swipe-bg" aria-hidden>
        <Trash2 size={18} />
        <span>Remove</span>
      </div>
      <div className="queue-row-body" ref={bodyRef}>
        <button
          className="queue-main"
          onClick={() => {
            if (!swiped.current) onPlay(at);
          }}
        >
          <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="queue-cover" radius={9} />
          <span className="queue-text">
            <span className="queue-title">{track.title}</span>
            <span className="queue-artist">{track.artist}</span>
          </span>
          <span className="queue-time">{formatTrackTime(track.durationMs)}</span>
        </button>
        <button className="queue-remove" aria-label={`Remove ${track.title} from the queue`} onClick={() => onRemove(at)}>
          <X size={15} />
        </button>
        <button
          className="queue-handle"
          aria-label={`Move ${track.title}. Use the up and down arrow keys to move it in the queue`}
          onPointerDown={(event) => onGrab(at, event)}
          onKeyDown={keyDown}
        >
          <GripVertical size={18} />
        </button>
      </div>
    </div>
  );
});

export function QueuePanel() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const { queue, index, history } = player;
  const current = queue[index];
  const listRef = useRef<HTMLDivElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [settling, setSettling] = useState(false);
  const [undo, setUndo] = useState<{ token: QueueUndo; title: string; id: number } | null>(null);
  const undoTimer = useRef<number | null>(null);
  const dragInfo = useRef<{ pointer: number; startY: number; startScroll: number; lastY: number; rowHeight: number; frame: number; from: number; target: number } | null>(null);

  const albumsById = new Map(albums.map((album) => [album.id, album]));
  const albumOf = (track: Track) => (track.albumId ? albumsById.get(track.albumId) : undefined);

  const upcoming = queue.slice(index + 1);
  const keys = occurrenceKeys(upcoming.map((track) => track.id));
  const remaining = upcoming.reduce((sum, track) => sum + track.durationMs, 0);
  const played = (history.length && current && history[history.length - 1]!.id === current.id ? history.slice(0, -1) : history).slice(-HISTORY_SHOWN);

  // Open with the song playing at the top, the history above it a scroll away.
  useLayoutEffect(() => {
    const list = listRef.current;
    const now = nowRef.current;
    if (list && now) list.scrollTop = Math.max(0, now.offsetTop - list.offsetTop - 34);
  }, []);

  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
      if (dragInfo.current) cancelAnimationFrame(dragInfo.current.frame);
    },
    [],
  );

  const showUndo = useCallback((token: QueueUndo, title: string) => {
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
    const id = Date.now();
    setUndo({ token, title, id });
    undoTimer.current = window.setTimeout(() => setUndo((value) => (value?.id === id ? null : value)), UNDO_MS);
  }, []);

  const playerRef = useRef(player);
  playerRef.current = player;
  const indexRef = useRef(index);
  indexRef.current = index;
  const upcomingRef = useRef(upcoming);
  upcomingRef.current = upcoming;

  const remove = useCallback(
    (at: number) => {
      const track = upcomingRef.current[at];
      const token = playerRef.current.removeFromQueue(indexRef.current + 1 + at);
      if (token && track) showUndo(token, track.title);
    },
    [showUndo],
  );
  const play = useCallback((at: number) => playerRef.current.jumpTo(indexRef.current + 1 + at), []);
  const keyMove = useCallback((at: number, to: number) => playerRef.current.moveInQueue(indexRef.current + 1 + at, indexRef.current + 1 + to), []);

  const update = useCallback(() => {
    const info = dragInfo.current;
    const list = listRef.current;
    if (!info || !list) return;
    const dy = info.lastY - info.startY + (list.scrollTop - info.startScroll);
    const target = dropTarget(info.from, dy, info.rowHeight, upcomingRef.current.length);
    if (target !== info.target) {
      info.target = target;
      tickHaptic();
    }
    setDrag({ from: info.from, target, dy });
  }, []);

  const tick = useCallback(() => {
    const info = dragInfo.current;
    const list = listRef.current;
    if (!info || !list) return;
    const box = list.getBoundingClientRect();
    const speed = edgeScrollSpeed(info.lastY, box.top, box.bottom);
    if (speed) {
      list.scrollTop += speed;
      update();
    }
    info.frame = requestAnimationFrame(tick);
  }, [update]);

  const grab = useCallback(
    (at: number, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !listRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const row = event.currentTarget.closest('.queue-row') as HTMLElement | null;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragInfo.current = {
        pointer: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        startScroll: listRef.current.scrollTop,
        rowHeight: row?.offsetHeight ?? 58,
        frame: 0,
        from: at,
        target: at,
      };
      tapHaptic();
      setDrag({ from: at, target: at, dy: 0 });
      dragInfo.current.frame = requestAnimationFrame(tick);
    },
    [tick],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: PointerEvent) => {
      const info = dragInfo.current;
      if (!info || event.pointerId !== info.pointer) return;
      info.lastY = event.clientY;
      update();
    };
    const onUp = (event: PointerEvent) => {
      const info = dragInfo.current;
      if (!info || event.pointerId !== info.pointer) return;
      cancelAnimationFrame(info.frame);
      dragInfo.current = null;
      // Rows jump to their new places without sliding back first.
      setSettling(true);
      setDrag(null);
      if (event.type === 'pointerup' && info.target !== info.from) {
        playerRef.current.moveInQueue(indexRef.current + 1 + info.from, indexRef.current + 1 + info.target);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag !== null, update]); // eslint-disable-line react-hooks/exhaustive-deps

  const duration = player.duration || (current ? current.durationMs / 1000 : 0);
  const progress = duration > 0 ? Math.min(1, player.currentTime / duration) : 0;

  return (
    <div className={`queue-panel${drag ? ' is-dragging' : ''}`} data-overlay role="dialog" aria-label="Queue">
      <div className="queue-head">
        <div className="queue-head-copy">
          <div className="queue-name">Queue</div>
          <div className="queue-sub">
            {upcoming.length ? `${plural(upcoming.length, 'song')} up next · ${formatTotal(remaining)}` : 'Nothing up next'}
          </div>
        </div>
        <div className="queue-tools">
          <button
            className={player.shuffle ? 'queue-tool on' : 'queue-tool'}
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            onClick={player.toggleShuffle}
          >
            <Shuffle size={17} />
          </button>
          <button
            className={player.repeat !== 'off' ? 'queue-tool on' : 'queue-tool'}
            aria-label={player.repeat === 'one' ? 'Repeat one' : player.repeat === 'all' ? 'Repeat all' : 'Repeat off'}
            onClick={player.cycleRepeat}
          >
            {player.repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
          <button className="queue-tool text" onClick={player.clearQueue} disabled={!queue.length}>
            Clear
          </button>
        </div>
      </div>
      <div className="queue-list" ref={listRef}>
        {played.length ? (
          <section className="queue-history" aria-label="History">
            <div className="queue-label">
              <History size={13} /> History
            </div>
            {played.map((track, at) => {
              const album = albumOf(track);
              return (
                <button key={`${track.id}-${at}`} className="queue-past" onClick={() => player.playFromHistory(track)}>
                  <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="queue-cover small" radius={7} />
                  <span className="queue-text">
                    <span className="queue-title">{track.title}</span>
                    <span className="queue-artist">{track.artist}</span>
                  </span>
                </button>
              );
            })}
          </section>
        ) : null}

        {current ? (
          <div className="queue-now-wrap" ref={nowRef}>
            <div className="queue-label">Now playing</div>
            <div className="queue-now">
              <Cover fileId={coverFor(current, albumOf(current), songCovers)} hue={albumOf(current)?.hue ?? current.hue} className="queue-cover" radius={11} />
              <span className="queue-text">
                <span className="queue-title">{current.title}</span>
                <span className="queue-artist">{current.artist}</span>
              </span>
              <Bars playing={player.playing} />
              <span className="queue-progress" aria-hidden>
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
            </div>
          </div>
        ) : (
          <p className="queue-empty">Nothing is playing. Pick an album or song to start a queue.</p>
        )}

        {current ? (
          <section className="queue-upnext" aria-label="Up next">
            <div className="queue-label">
              Up next
              {player.shuffle ? <span className="queue-label-note">Shuffled</span> : null}
            </div>
            {upcoming.length ? (
              <div className="queue-rows">
                {upcoming.map((track, at) => (
                  <UpcomingRow
                    key={keys[at]}
                    track={track}
                    album={albumOf(track)}
                    songCovers={songCovers}
                    at={at}
                    count={upcoming.length}
                    dragging={drag?.from === at}
                    settling={settling}
                    dy={drag?.from === at ? drag.dy : 0}
                    shift={drag ? shiftFor(at, drag.from, drag.target, dragInfo.current?.rowHeight ?? 58) : 0}
                    onPlay={play}
                    onRemove={remove}
                    onGrab={grab}
                    onKeyMove={keyMove}
                  />
                ))}
              </div>
            ) : (
              <p className="queue-empty">Songs you choose to play next show up here.</p>
            )}
            {upcoming.length > 1 ? <p className="queue-hint">Drag the handle to reorder. Swipe left to remove.</p> : null}
          </section>
        ) : null}
      </div>

      {undo ? (
        <div className="queue-undo" role="status" key={undo.id}>
          <span>
            Removed <b>{undo.title}</b>
          </span>
          <button
            onClick={() => {
              if (undoTimer.current !== null) window.clearTimeout(undoTimer.current);
              setUndo(null);
              player.undoRemove(undo.token);
            }}
          >
            Undo
          </button>
        </div>
      ) : null}
    </div>
  );
}
