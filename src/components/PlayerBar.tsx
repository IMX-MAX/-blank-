import {
  AudioLines,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { formatClock } from '../lib/format';
import { readPeaks } from '../lib/peaks';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { Waveform } from './Waveform';

export function PlayerBar() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const track = player.track;
  if (!track) return null;
  const albumName = albums.find((album) => album.$id === track.albumId)?.name;

  const progress = player.duration > 0 ? player.currentTime / player.duration : 0;
  const peaks = readPeaks(track.waveform, track.$id);

  return (
    <>
      {player.queueOpen ? (
        <div className="queue-panel" data-overlay>
          <div className="queue-head">Queue</div>
          <div className="queue-list">
            {player.queue.map((item, itemIndex) => (
              <button
                key={`${item.$id}-${itemIndex}`}
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
      ) : null}
      <footer className="player">
        <div className="player-id">
          <Cover fileId={track.coverFileId} hue={track.hue} radius="50%" className="player-art" />
          <div className="player-names">
            <div className="player-title">{track.title}</div>
            <div className="player-sub">{albumName || track.artist}</div>
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
            <SkipBack size={20} fill="currentColor" strokeWidth={0} />
          </button>
          <button className="ctrl play-toggle" aria-label={player.playing ? 'Pause' : 'Play'} onClick={player.toggle}>
            {player.playing ? (
              <Pause size={20} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={20} fill="currentColor" strokeWidth={0} />
            )}
          </button>
          <button className="ctrl" aria-label="Next" onClick={player.next}>
            <SkipForward size={20} fill="currentColor" strokeWidth={0} />
          </button>
          <button
            className={player.shuffle ? 'ctrl is-on' : 'ctrl'}
            aria-label="Shuffle"
            onClick={player.toggleShuffle}
          >
            <Shuffle size={18} />
          </button>
          <button
            className={player.repeat !== 'off' ? 'ctrl is-on' : 'ctrl'}
            aria-label="Repeat"
            onClick={player.cycleRepeat}
          >
            {player.repeat === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
          </button>
          <button
            className={player.queueOpen ? 'ctrl is-on' : 'ctrl'}
            aria-label="Queue"
            onClick={() => player.setQueueOpen(!player.queueOpen)}
          >
            <ListMusic size={18} />
          </button>
          <div className="volume">
            <button className="ctrl" aria-label="Volume" onClick={player.toggleMute}>
              {player.muted || player.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
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
