import { useRef } from 'react';
import { AudioLines, ImagePlus, MoreHorizontal, Pause, Play, Plus, Shuffle } from 'lucide-react';
import type { Album, Track } from '../types';
import { formatTotal, matchesQuery, plural, relativeTime } from '../lib/format';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { atPointer, below, type Point } from './overlays';

export function AlbumView({
  album,
  tracks,
  query,
  onPlay,
  onTrack,
  onTrackMenu,
  onAdd,
  onCover,
}: {
  album: Album;
  tracks: Track[];
  query: string;
  onPlay: () => void;
  onTrack: (track: Track) => void;
  onTrackMenu: (track: Track, at: Point) => void;
  onAdd: () => void;
  onCover: (file: File) => void;
}) {
  const player = usePlayer();
  const coverInput = useRef<HTMLInputElement>(null);
  const visible = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => matchesQuery(query, track.title, track.artist));
  const totalMs = tracks.reduce((sum, track) => sum + track.durationMs, 0);
  const playingAlbum = tracks.some((track) => track.id === player.track?.id) && player.playing;

  return (
    <main className="album">
      <button
        className="album-cover-btn"
        aria-label="Change cover art"
        title="Change cover art"
        onClick={() => coverInput.current?.click()}
      >
        <Cover fileId={album.coverFileId} hue={album.hue} radius={28} className="album-cover" />
        <span className="cover-hint">
          <ImagePlus size={20} /> Change cover
        </span>
      </button>
      <input
        ref={coverInput}
        className="hidden-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onCover(file);
        }}
      />
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
          {visible.map(({ track, index }) => {
            const active = player.track?.id === track.id;
            return (
              <div
                className={`track${active ? ' active' : ''}`}
                key={track.id}
                onContextMenu={(event) => onTrackMenu(track, atPointer(event))}
              >
                <button className="track-hit" onClick={() => onTrack(track)}>
                  <span className="track-num">
                    {active ? <AudioLines size={15} /> : index + 1}
                  </span>
                  <span className="track-copy">
                    <span className="track-title">{track.title}</span>
                    <span className="track-sub">{relativeTime(track.createdAt)}</span>
                  </span>
                </button>
                <button
                  className="ghost-more track-more"
                  aria-label={`Options for ${track.title}`}
                  onClick={(event) => onTrackMenu(track, below(event.currentTarget, 'right'))}
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
