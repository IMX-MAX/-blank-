import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { coverFor } from '../lib/covers';
import { formatTotal, formatTrackTime, plural } from '../lib/format';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import type { Track } from '../types';
import { Cover } from './Cover';

function Bars({ playing }: { playing: boolean }) {
  return (
    <span className={playing ? 'bars on' : 'bars'} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function QueuePanel() {
  const player = usePlayer();
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const { queue, index } = player;
  const current = queue[index];
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  const cover = (track: Track) => {
    const album = albums.find((item) => item.id === track.albumId);
    return <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="queue-cover" radius={9} />;
  };

  const upcoming = queue.map((track, position) => ({ track, position })).filter(({ position }) => position > index);
  const earlier = queue.map((track, position) => ({ track, position })).filter(({ position }) => position < index);
  const remaining = upcoming.reduce((sum, { track }) => sum + track.durationMs, 0);

  const row = ({ track, position }: { track: Track; position: number }, played: boolean) => (
    <div key={`${track.id}-${position}`} className={played ? 'queue-row played' : 'queue-row'}>
      <button className="queue-main" onClick={() => player.jumpTo(position)}>
        {cover(track)}
        <span className="queue-text">
          <span className="queue-title">{track.title}</span>
          <span className="queue-artist">{track.artist}</span>
        </span>
        <span className="queue-time">{formatTrackTime(track.durationMs)}</span>
      </button>
      <button className="queue-remove" aria-label={`Remove ${track.title} from the queue`} onClick={() => player.removeFromQueue(position)}>
        <X size={15} />
      </button>
    </div>
  );

  return (
    <div className="queue-panel" data-overlay>
      <div className="queue-head">
        <div>
          <div className="queue-name">Queue</div>
          <div className="queue-sub">
            {upcoming.length ? `${plural(upcoming.length, 'song')} up next · ${formatTotal(remaining)}` : 'Nothing up next'}
          </div>
        </div>
        <button className="pill-btn queue-clear" onClick={player.clearQueue}>
          Clear
        </button>
      </div>
      <div className="queue-list" ref={listRef}>
        {current ? (
          <>
            <div className="queue-label">Now playing</div>
            <div className="queue-now">
              {cover(current)}
              <span className="queue-text">
                <span className="queue-title">{current.title}</span>
                <span className="queue-artist">{current.artist}</span>
              </span>
              <Bars playing={player.playing} />
            </div>
          </>
        ) : null}
        {upcoming.length ? (
          <>
            <div className="queue-label">Up next</div>
            {upcoming.map((entry) => row(entry, false))}
          </>
        ) : null}
        {earlier.length ? (
          <>
            <div className="queue-label">Played</div>
            {earlier.map((entry) => row(entry, true))}
          </>
        ) : null}
      </div>
    </div>
  );
}
