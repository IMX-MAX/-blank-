import { useRef } from 'react';
import { AudioLines, ImagePlus, MoreHorizontal, Pause, Play, Plus, Shuffle } from 'lucide-react';
import type { Album, Track } from '../types';
import { albumYear } from '../lib/artists';
import { coverFor } from '../lib/covers';
import { formatTotal, matchesQuery, plural } from '../lib/format';
import { useLibrary } from '../state/LibraryProvider';
import { useSettings } from '../state/SettingsProvider';
import { AlbumLink, ArtistLinks } from './ArtistLinks';
import { useOffline, useOnline } from '../state/OfflineProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { OfflineBadge } from './OfflineBadge';
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
  const offline = useOffline();
  const online = useOnline();
  const coverInput = useRef<HTMLInputElement>(null);
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const isPlaylist = album.kind === 'playlist';
  const albumsById = new Map(albums.map((item) => [item.id, item]));
  const year = isPlaylist ? null : albumYear(tracks);
  const visible = tracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => matchesQuery(query, track.title, track.artist));
  const totalMs = tracks.reduce((sum, track) => sum + track.durationMs, 0);
  const inQueue = tracks.some((track) => track.id === player.track?.id);
  const playingAlbum = inQueue && player.playing;

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
              {isPlaylist ? 'Playlist' : <ArtistLinks artist={album.artist} className="album-artist" />}
              {year ? ` · ${year}` : ''} · {plural(tracks.length, 'track')} · {formatTotal(totalMs)}
            </p>
          </div>
          <div className="play-cluster">
            <button
              className={player.shuffle ? 'shuffle-btn on' : 'shuffle-btn'}
              aria-label="Shuffle"
              aria-pressed={player.shuffle}
              // Shuffle on an album that is not playing plays it shuffled; on the one playing it switches shuffle.
              onClick={() => (inQueue ? player.toggleShuffle() : player.shuffleTracks(tracks))}
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
          <Plus size={16} /> {isPlaylist ? 'Add songs' : 'Add tracks'}
        </button>
        <div className="track-list">
          {visible.map(({ track, index }) => {
            const active = player.track?.id === track.id;
            const unavailable = !online && !offline.isSaved(track.id);
            const home = track.albumId ? albumsById.get(track.albumId) : undefined;
            return (
              <div
                className={`track${isPlaylist ? ' art-track' : ''}${active ? ' active' : ''}${unavailable ? ' unavailable' : ''}`}
                key={track.id}
                onContextMenu={(event) => onTrackMenu(track, atPointer(event))}
              >
                <button className="track-hit" disabled={unavailable} onClick={() => onTrack(track)}>
                  <span className="track-num">
                    {active ? <AudioLines size={15} /> : !isPlaylist && track.trackNumber ? track.trackNumber : index + 1}
                  </span>
                  {isPlaylist ? (
                    <Cover fileId={coverFor(track, home, songCovers)} hue={home?.hue ?? track.hue} className="smart-track-art" radius={8} />
                  ) : null}
                  <span className="track-copy">
                    <span className="track-title">{track.title}</span>
                    <span className="track-sub">
                      <ArtistLinks artist={track.artist} />
                      {isPlaylist && home?.kind === 'album' ? (
                        <>
                          {' · '}
                          <AlbumLink album={home} />
                        </>
                      ) : null}
                    </span>
                  </span>
                </button>
                <OfflineBadge trackId={track.id} />
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
