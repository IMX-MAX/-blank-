import {
  AlignJustify,
  AudioLines,
  FastForward,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Shuffle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useRef } from 'react';
import { coverFor } from '../lib/covers';
import { formatClock } from '../lib/format';
import { readPeaks } from '../lib/peaks';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import { Marquee } from './Marquee';
import { Cover } from './Cover';
import { LyricsView } from './LyricsView';
import { NowPlaying } from './NowPlaying';
import { Presence } from './Presence';
import { Waveform } from './Waveform';

export function PlayerBar() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const barRef = useRef<HTMLElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number; active: boolean; moved: boolean } | null>(null);
  const swiped = useRef(false);
  const track = player.track;
  if (!track) return null;
  const trackAlbum = albums.find((album) => album.id === track.albumId);
  const coverFileId = coverFor(track, trackAlbum, songCovers);

  const progress = player.duration > 0 ? player.currentTime / player.duration : 0;
  const peaks = readPeaks(track.waveform, track.id);

  return (
    <>
      <Presence show={player.lyricsOpen}>
        <LyricsView />
      </Presence>
      <Presence show={player.expandedOpen} ms={380}>
        <NowPlaying />
      </Presence>
      <Presence show={player.queueOpen}>
        <div className="queue-panel" data-overlay>
          <div className="queue-head">Queue</div>
          <div className="queue-list">
            {player.queue.map((item, itemIndex) => (
              <button
                key={`${item.id}-${itemIndex}`}
                className={itemIndex === player.index ? 'queue-row active' : 'queue-row'}
                onClick={() => player.jumpTo(itemIndex)}
              >
                <span className="queue-index">
                  {itemIndex === player.index ? <AudioLines size={14} /> : itemIndex + 1}
                </span>
                <span className="queue-title">{item.title}</span>
                <span className="queue-artist">{item.artist}</span>
              </button>
            ))}
          </div>
        </div>
      </Presence>
      <footer
        ref={barRef}
        className={`player${player.playing ? ' is-playing' : ''}${player.expandedOpen ? ' expanded' : ''}`}
      >
        <div
          className="player-id"
          role="button"
          tabIndex={0}
          aria-label="Open player"
          onClick={() => {
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            player.setLyricsOpen(false);
            player.setQueueOpen(false);
            player.setExpandedOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              event.currentTarget.click();
            }
          }}
          onPointerDown={(event) => {
            swipe.current = { x: event.clientX, y: event.clientY, id: event.pointerId, active: false, moved: false };
            swiped.current = false;
          }}
          onPointerMove={(event) => {
            const gesture = swipe.current;
            const bar = barRef.current;
            if (!gesture || !bar || gesture.id !== event.pointerId) return;
            const dy = event.clientY - gesture.y;
            const dx = event.clientX - gesture.x;
            if (!gesture.active) {
              if (Math.abs(dy) < 8 || Math.abs(dx) > Math.abs(dy)) return;
              gesture.active = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              bar.style.animation = 'none';
              bar.style.transition = 'none';
            }
            gesture.moved = true;
            const down = Math.max(0, dy);
            bar.style.transform = `translateY(${down}px)`;
            bar.style.opacity = String(Math.max(0.25, 1 - down / 180));
          }}
          onPointerUp={(event) => {
            const gesture = swipe.current;
            const bar = barRef.current;
            swipe.current = null;
            if (!gesture || !bar || !gesture.moved) return;
            swiped.current = true;
            const dy = event.clientY - gesture.y;
            bar.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
            if (dy > 70) {
              bar.style.transform = 'translateY(160px)';
              bar.style.opacity = '0';
              window.setTimeout(() => player.clearQueue(), 200);
            } else {
              bar.style.transform = '';
              bar.style.opacity = '';
            }
          }}
          onPointerCancel={() => {
            swipe.current = null;
            const bar = barRef.current;
            if (bar) {
              bar.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
              bar.style.transform = '';
              bar.style.opacity = '';
            }
          }}
        >
          <Cover fileId={coverFileId} hue={trackAlbum?.hue ?? track.hue} radius="50%" className="player-art" />
          <div className="player-names">
            <Marquee className="player-title" text={track.title} />
            <div className="player-sub">{track.artist}</div>
          </div>
        </div>
        <div className="player-mid">
          <Waveform
            peaks={peaks}
            progress={progress}
            onSeek={(ratio) => player.seek(ratio * (player.duration || 0))}
          />
          <div className="player-time">
            {formatClock(player.currentTime)} <span>/ {formatClock(player.duration || track.durationMs / 1000)}</span>
          </div>
        </div>
        <div className="player-controls">
          <button className="ctrl" aria-label="Previous" onClick={player.previous}>
            <Rewind size={24} fill="currentColor" strokeWidth={0} />
          </button>
          <button className="ctrl play-toggle" aria-label={player.playing ? 'Pause' : 'Play'} onClick={player.toggle}>
            {player.playing ? (
              <Pause size={24} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={24} fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button className="ctrl" aria-label="Next" onClick={player.next}>
            <FastForward size={24} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            className={player.shuffle ? 'ctrl is-on' : 'ctrl'}
            aria-label="Shuffle"
            onClick={player.toggleShuffle}
          >
            <Shuffle size={19} />
          </button>
          <button
            className={player.repeat !== 'off' ? 'ctrl is-on' : 'ctrl'}
            aria-label="Repeat"
            onClick={player.cycleRepeat}
          >
            {player.repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
          </button>
          <button
            className={player.lyricsOpen ? 'ctrl is-on' : 'ctrl'}
            aria-label="Lyrics"
            aria-pressed={player.lyricsOpen}
            onClick={() => {
              player.setQueueOpen(false);
              player.setExpandedOpen(false);
              player.setLyricsOpen(!player.lyricsOpen);
            }}
          >
            <MicVocal size={19} />
          </button>
          <button
            className={player.queueOpen ? 'ctrl is-on' : 'ctrl'}
            aria-label="Queue"
            onClick={() => {
              player.setLyricsOpen(false);
              player.setExpandedOpen(false);
              player.setQueueOpen(!player.queueOpen);
            }}
          >
            <AlignJustify size={19} />
          </button>
          <div className="volume">
            <button className="ctrl" aria-label="Volume" onClick={player.toggleMute}>
              {player.muted || player.volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
            </button>
            <input
              className="volume-slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.muted ? 0 : player.volume}
              aria-label="Volume level"
              onChange={(event) => player.setVolume(Number(event.target.value))}
            />
          </div>
        </div>
      </footer>
    </>
  );
}
