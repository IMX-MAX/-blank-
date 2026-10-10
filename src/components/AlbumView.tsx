import { AudioLines, MoreHorizontal, Pause, Play, Plus, Shuffle } from 'lucide-react';
import type { Album, Track } from '../types';
import { formatTotal, formatTrackTime, matchesQuery, plural } from '../lib/format';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';

export function AlbumView({
  album,
  tracks,
  query,
  onPlay,
  onTrack,
  onTrackMenu,
  onAdd,
}: {
  album: Album;
  tracks: Track[];
  query: string;
  onPlay: () => void;
  onTrack: (track: Track) => void;
  onTrackMenu: (track: Track, anchor: HTMLElement) => void;
  onAdd: () => void;
}) {
  const player = usePlayer();
  const visible = tracks.filter((track) => matchesQuery(query, track.title, track.artist));
  const totalMs = tracks.reduce((sum, track) => sum + track.durationMs, 0);
  const playingAlbum = tracks.some((track) => track.$id === player.track?.$id) && player.playing;

  return (
    <main className="album">
      <Cover fileId={album.coverFileId} hue={album.hue} radius={32} className="album-cover" />
      <section className="album-main">
        <div className="album-heading">
          <div>
            <h2 className="album-title">{album.name}</h2>
            <p className="album-meta">
              {album.artist} · {plural(tracks.length, 'track')} · {formatTotal(totalMs)}
            </p>
          </div>
          <div className="play-cluster">
            <button
              className={player.shuffle ? 'shuffle-btn on' : 'shuffle-btn'}
              aria-label="Shuffle"
              onClick={player.toggleShuffle}
            >
              <Shuffle size={18} />
            </button>
            <button className="big-play" aria-label={playingAlbum ? 'Pause' : 'Play'} onClick={onPlay}>
              {playingAlbum ? (
                <Pause size={22} fill="currentColor" strokeWidth={0} />
              ) : (
                <Play size={22} fill="currentColor" strokeWidth={0} />
              )}
            </button>
          </div>
        </div>
        <button className="add-tracks" onClick={onAdd}>
          <Plus size={16} /> Add tracks
        </button>
        <div className="track-list">
          {visible.map((track, index) => {
            const active = player.track?.$id === track.$id;
            return (
              <div className={active ? 'track active' : 'track'} key={track.$id}>
                <button className="track-hit" onClick={() => onTrack(track)}>
                  <span className="track-num">
                    {active ? <AudioLines size={15} /> : index + 1}
                  </span>
                  <span className="track-copy">
                    <span className="track-title">{track.title}</span>
                    <span className="track-sub">{track.artist}</span>
                  </span>
                  <span className="track-dur">{formatTrackTime(track.durationMs)}</span>
                </button>
                <button
                  className="ghost-more track-more"
                  aria-label={`Options for ${track.title}`}
                  onClick={(event) => onTrackMenu(track, event.currentTarget)}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
