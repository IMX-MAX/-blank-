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
import { formatClock } from '../lib/format';
import { readPeaks } from '../lib/peaks';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { Waveform } from './Waveform';

export function NowPlaying() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const track = player.track;
  if (!track) return null;
  const album = albums.find((item) => item.id === track.albumId);
  const coverFileId = album?.coverFileId ?? track.coverFileId;
  const hue = album?.hue ?? track.hue;
  const duration = player.duration || track.durationMs / 1000;
  const progress = duration > 0 ? player.currentTime / duration : 0;

  return (
    <section className="now" data-overlay aria-label="Now playing">
      <Cover fileId={coverFileId} hue={hue} className="now-bg" radius={0} />
      <div className="now-shade" />
      <header className="now-head">
        <button className="icon-btn" aria-label="Close player" onClick={() => player.setExpandedOpen(false)}>
          <ChevronDown size={20} />
        </button>
      </header>
      <div className="now-body">
        <div className="now-art-wrap">
          <Cover fileId={coverFileId} hue={hue} className="now-art" radius={22} />
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
