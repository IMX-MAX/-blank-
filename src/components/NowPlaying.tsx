import {
  AlignJustify,
  ChevronDown,
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
import { useEffect, useLayoutEffect, useRef } from 'react';
import { coverFor } from '../lib/covers';
import { formatClock } from '../lib/format';
import { readPeaks } from '../lib/peaks';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import { Cover } from './Cover';
import { Slider } from './Slider';
import { Waveform } from './Waveform';

/** Moves the big cover between the playback bar's cover and its resting place, like the cover is being pulled up. */
function flyCover(wrap: HTMLElement | null, direction: 'open' | 'close') {
  const art = wrap?.querySelector<HTMLElement>('.now-art');
  const from = document.querySelector<HTMLElement>('.player .player-art');
  if (!art || !from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const small = from.getBoundingClientRect();
  const big = art.getBoundingClientRect();
  if (!big.width) return;
  const dx = small.left + small.width / 2 - (big.left + big.width / 2);
  const dy = small.top + small.height / 2 - (big.top + big.height / 2);
  const shrunk = `translate(${dx}px, ${dy}px) scale(${from.offsetWidth / big.width})`;
  const frames =
    direction === 'open'
      ? [
          { transform: shrunk, borderRadius: '50%', cornerShape: 'round' },
          { transform: 'none', borderRadius: '26px', cornerShape: 'squircle' },
        ]
      : [
          { transform: 'none', borderRadius: '26px', cornerShape: 'squircle' },
          { transform: shrunk, borderRadius: '50%', cornerShape: 'round' },
        ];
  art.animate(frames, {
    duration: direction === 'open' ? 520 : 340,
    easing: 'cubic-bezier(0.2, 0.85, 0.25, 1)',
    fill: 'both',
  });
}

export function NowPlaying() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const wrapRef = useRef<HTMLDivElement>(null);
  const open = player.expandedOpen;
  const track = player.track;
  const album = albums.find((item) => item.id === track?.albumId);
  const coverFileId = track ? coverFor(track, album, songCovers) : null;

  useLayoutEffect(() => {
    flyCover(wrapRef.current, 'open');
  }, []);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) flyCover(wrapRef.current, 'close');
    wasOpen.current = open;
  }, [open]);

  if (!track) return null;
  const hue = album?.hue ?? track.hue;
  const duration = player.duration || track.durationMs / 1000;
  const progress = duration > 0 ? player.currentTime / duration : 0;

  return (
    <section className="now" data-overlay aria-label="Now playing">
      <div className="now-backdrop">
        <Cover fileId={coverFileId} hue={hue} className="now-bg" radius={0} />
        <div className="now-shade" />
      </div>
      <header className="now-head">
        <button className="icon-btn" aria-label="Close player" onClick={() => player.setExpandedOpen(false)}>
          <ChevronDown size={20} />
        </button>
      </header>
      <div className="now-body">
        <div className="now-art-wrap" ref={wrapRef}>
          <Cover fileId={coverFileId} hue={hue} className="now-art" radius={26} />
        </div>
        <div className="now-panel">
          <div className="now-names">
            <div className="now-title">{track.title}</div>
            <div className="now-artist">{track.artist}</div>
          </div>
          <div className="now-seek">
            <Waveform
              peaks={readPeaks(track.waveform, track.id)}
              progress={progress}
              onSeek={(ratio) => player.seek(ratio * duration)}
            />
            <div className="now-times">
              <span>{formatClock(player.currentTime)}</span>
              <span>{formatClock(duration)}</span>
            </div>
          </div>
          <div className="now-controls">
            <button
              className={player.shuffle ? 'ctrl is-on' : 'ctrl'}
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              onClick={player.toggleShuffle}
            >
              <Shuffle size={22} />
            </button>
            <button className="ctrl" aria-label="Previous" onClick={player.previous}>
              <Rewind size={32} fill="currentColor" strokeWidth={0} />
            </button>
            <button className="now-play" aria-label={player.playing ? 'Pause' : 'Play'} onClick={player.toggle}>
              {player.playing ? (
                <Pause size={30} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={30} fill="currentColor" strokeWidth={0} />
              )}
            </button>
            <button className="ctrl" aria-label="Next" onClick={player.next}>
              <FastForward size={32} fill="currentColor" strokeWidth={0} />
            </button>
            <button
              className={player.repeat !== 'off' ? 'ctrl is-on' : 'ctrl'}
              aria-label="Repeat"
              onClick={player.cycleRepeat}
            >
              {player.repeat === 'one' ? <Repeat1 size={22} /> : <Repeat size={22} />}
            </button>
          </div>
          <div className="now-extras">
            <button
              className="ctrl"
              aria-label="Lyrics"
              onClick={() => {
                player.setExpandedOpen(false);
                player.setQueueOpen(false);
                player.setLyricsOpen(true);
              }}
            >
              <MicVocal size={21} />
            </button>
            <div className="volume now-volume">
              <button className="ctrl" aria-label="Volume" onClick={player.toggleMute}>
                {player.muted || player.volume === 0 ? <VolumeX size={21} /> : <Volume2 size={21} />}
              </button>
              <Slider className="volume-slider" min={0} max={1} step={0.01} value={player.muted ? 0 : player.volume} label="Volume level" onChange={player.setVolume} />
            </div>
            <button
              className="ctrl"
              aria-label="Queue"
              onClick={() => {
                player.setExpandedOpen(false);
                player.setLyricsOpen(false);
                player.setQueueOpen(true);
              }}
            >
              <AlignJustify size={21} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
