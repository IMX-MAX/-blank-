import { Folder, MoreHorizontal, Play } from 'lucide-react';
import type { Album, Folder as FolderRecord, Track } from '../types';
import { formatTrackTime, matchesQuery } from '../lib/format';
import { useLibrary } from '../state/LibraryProvider';
import { useOffline, useOnline } from '../state/OfflineProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';
import { OfflineBadge } from './OfflineBadge';
import { atPointer, below, type Point } from './overlays';

export function LibraryView({
  title,
  folders,
  albums,
  tracks,
  query,
  onOpenFolder,
  onOpenAlbum,
  onPlayAlbum,
  onAlbumMenu,
  onFolderMenu,
  onTrackMenu,
  onPlayTrack,
}: {
  title?: string;
  folders: FolderRecord[];
  albums: Album[];
  tracks: Track[];
  query: string;
  onOpenFolder: (id: string) => void;
  onOpenAlbum: (id: string) => void;
  onPlayAlbum: (album: Album) => void;
  onAlbumMenu: (album: Album, at: Point) => void;
  onFolderMenu: (folder: FolderRecord, at: Point) => void;
  onTrackMenu: (track: Track, at: Point) => void;
  onPlayTrack: (track: Track) => void;
}) {
  const player = usePlayer();
  const { tracksFor } = useLibrary();
  const offline = useOffline();
  const online = useOnline();
  const visibleFolders = query ? [] : folders;
  const visibleAlbums = albums.filter((album) => matchesQuery(query, album.name, album.artist));
  const visibleTracks = query
    ? tracks.filter((track) => matchesQuery(query, track.title, track.artist)).slice(0, 40)
    : [];
  const empty = !visibleFolders.length && !visibleAlbums.length && !visibleTracks.length;

  return (
    <main className="stage">
      {title ? <h2 className="stage-title">{title}</h2> : null}
      {empty && query ? <p className="empty-note">No matches</p> : null}
      <div className="grid">
        {visibleFolders.map((folder, index) => (
          <div
            className="card"
            key={folder.id}
            style={{ ["--i" as string]: index }}
            onContextMenu={(event) => onFolderMenu(folder, atPointer(event))}
          >
            <button className="card-art folder-art" onClick={() => onOpenFolder(folder.id)} aria-label={folder.name}>
              <Folder size={42} strokeWidth={1.5} />
            </button>
            <div className="card-copy">
              <button className="card-title" onClick={() => onOpenFolder(folder.id)}>
                {folder.name}
              </button>
              <div className="card-sub">
                <span>Folder</span>
                <button
                  className="ghost-more"
                  aria-label={`Options for ${folder.name}`}
                  onClick={(event) => onFolderMenu(folder, below(event.currentTarget))}
                >
                  <MoreHorizontal size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {visibleAlbums.map((album, albumIndex) => {
          const index = albumIndex + visibleFolders.length;
          const playingHere =
            player.playing && tracksFor(album).some((track) => track.id === player.track?.id);
          return (
            <div
              className="card"
              key={album.id}
              data-album-id={album.id}
              style={{ ["--i" as string]: index }}
              onContextMenu={(event) => onAlbumMenu(album, atPointer(event))}
            >
              <div className="card-art-wrap">
                <button className="card-open" onClick={() => onOpenAlbum(album.id)} aria-label={album.name}>
                  <Cover fileId={album.coverFileId} hue={album.hue} radius={32} className="card-cover" />
                </button>
                <button
                  className="card-play"
                  aria-label={playingHere ? `Pause ${album.name}` : `Play ${album.name}`}
                  onClick={() => onPlayAlbum(album)}
                >
                  {playingHere ? <PauseIcon /> : <Play size={16} fill="currentColor" strokeWidth={0} />}
                </button>
              </div>
              <div className="card-copy">
                <button className="card-title" onClick={() => onOpenAlbum(album.id)}>
                  {album.name}
                </button>
                <div className="card-sub">
                  <span>{album.artist}</span>
                  <button
                    className="ghost-more"
                    aria-label={`Options for ${album.name}`}
                    onClick={(event) => onAlbumMenu(album, below(event.currentTarget))}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {visibleTracks.length ? (
        <div className="search-tracks">
          {visibleTracks.map((track) => (
            <button
              key={track.id}
              className="search-track"
              disabled={!online && !offline.isSaved(track.id)}
              onClick={() => onPlayTrack(track)}
              onContextMenu={(event) => onTrackMenu(track, atPointer(event))}
            >
              <Cover fileId={track.coverFileId} hue={track.hue} radius={8} className="search-art" />
              <span>
                <span className="track-title">{track.title}</span>
                <span className="track-sub">{track.artist}</span>
              </span>
              <span className="track-dur">
                <OfflineBadge trackId={track.id} />
                {formatTrackTime(track.durationMs)}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </main>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2" y="1" width="3.2" height="12" rx="0.6" fill="currentColor" />
      <rect x="8.8" y="1" width="3.2" height="12" rx="0.6" fill="currentColor" />
    </svg>
  );
}
