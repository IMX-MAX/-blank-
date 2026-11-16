import { useMemo, useState } from 'react';
import { AudioLines, MoreHorizontal, Pause, Play, Shuffle } from 'lucide-react';
import { artistCovers, artistInitials, artistKey, trackArtists, artistPage, artistSections, albumYear } from '../lib/artists';
import { coverFor } from '../lib/covers';
import { formatTotal, formatTrackTime, hueFromName, plural } from '../lib/format';
import { songTotals } from '../lib/stats';
import { useLibrary } from '../state/LibraryProvider';
import { useOffline, useOnline } from '../state/OfflineProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import { useStatsDays } from '../state/useStatsDays';
import type { Album, Track } from '../types';
import { AlbumLink, ArtistLinks } from './ArtistLinks';
import { Cover } from './Cover';
import { OfflineBadge } from './OfflineBadge';
import { atPointer, below, type Point } from './overlays';

const POPULAR = 5;

/** An artist: their picture, play and shuffle, their most played songs, albums, albums they are on, and every song. */
export function ArtistView({
  name,
  onOpenAlbum,
  onPlayAlbum,
  onTrackMenu,
}: {
  name: string;
  onOpenAlbum: (albumId: string) => void;
  onPlayAlbum: (album: Album) => void;
  onTrackMenu: (track: Track, at: Point, list: Track[]) => void;
}) {
  const { albums, tracks, tracksFor } = useLibrary();
  const player = usePlayer();
  const { songCovers } = useSettings();
  const { days } = useStatsDays();
  const page = useMemo(() => artistPage(name, albums, tracks), [name, albums, tracks]);
  const [showAll, setShowAll] = useState(false);
  const covers = artistCovers(page);
  const hero = covers[0] ?? null;
  const heroAlbum = page.albums[0] ?? page.appearsOn[0];
  const hue = heroAlbum?.hue ?? page.tracks[0]?.hue ?? hueFromName(page.name);
  const totals = useMemo(() => songTotals(days ?? []), [days]);
  const popular = useMemo(
    () =>
      page.tracks
        .map((track) => ({ track, plays: totals.get(track.id)?.plays ?? 0 }))
        .filter((item) => item.plays > 0)
        .sort((a, b) => b.plays - a.plays)
        .slice(0, POPULAR),
    [page.tracks, totals],
  );
  const list = page.tracks;
  const inQueue = list.some((track) => track.id === player.track?.id);
  const playingHere = inQueue && player.playing;
  const totalMs = list.reduce((sum, track) => sum + track.durationMs, 0);
  const albumCount = page.albums.length;
  const sections = artistSections(page, popular.length);
  const visibleSongs = showAll ? list : list.slice(0, sections.songsLimit);
  const sparse = list.length <= 3 && albumCount + page.appearsOn.length <= 1;

  if (!list.length && !albumCount) {
    return (
      <main className="artist-page">
        <div className="artist-empty">
          <span className="artist-avatar initials" style={{ ['--hue' as string]: hueFromName(name) }}>
            {artistInitials(name)}
          </span>
          <h2 className="artist-name">{name}</h2>
          <p className="empty-note">No songs by this artist in your library</p>
        </div>
      </main>
    );
  }

  return (
    <main className={sparse ? 'artist-page sparse' : 'artist-page'}>
      <header className="artist-hero">
        <div className="artist-hero-bg" aria-hidden>
          <Cover fileId={hero} hue={hue} radius={0} className="artist-hero-art" />
        </div>
        {hero ? (
          <Cover fileId={hero} hue={hue} radius="50%" className="artist-avatar" />
        ) : (
          <span className="artist-avatar initials" style={{ ['--hue' as string]: hue }} aria-hidden>
            {artistInitials(page.name)}
          </span>
        )}
        <div className="artist-heading">
          <p className="artist-kicker">Artist</p>
          <h2 className="artist-name">{page.name}</h2>
          <p className="album-meta">
            {plural(list.length, 'song')}
            {albumCount ? ` · ${plural(albumCount, 'album')}` : page.appearsOn.length ? ` · on ${plural(page.appearsOn.length, 'album')}` : ''}
            {list.length ? ` · ${formatTotal(totalMs)}` : ''}
          </p>
        </div>
        <div className="play-cluster artist-play">
          <button
            className={player.shuffle && inQueue ? 'shuffle-btn on' : 'shuffle-btn'}
            aria-label="Shuffle"
            disabled={!list.length}
            onClick={() => (inQueue ? player.toggleShuffle() : player.shuffleTracks(list))}
          >
            <Shuffle size={18} />
          </button>
          <button
            className="big-play"
            aria-label={playingHere ? 'Pause' : 'Play'}
            disabled={!list.length}
            onClick={() => (inQueue ? player.toggle() : player.playTracks(list))}
          >
            {playingHere ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
          </button>
        </div>
      </header>

      {sections.mostPlayed ? (
        <section className="artist-section">
          <h3 className="shelf-title">Most played</h3>
          <SongRows rows={popular.map((item) => item.track)} list={popular.map((item) => item.track)} artist={page.name} plays={totals} songCovers={songCovers} onTrackMenu={onTrackMenu} />
        </section>
      ) : null}

      {page.albums.length ? (
        <section className="artist-section">
          <h3 className="shelf-title">{page.albums.length === 1 ? 'Album' : 'Albums'}</h3>
          <AlbumShelf albums={page.albums} tracksFor={tracksFor} onOpen={onOpenAlbum} onPlay={onPlayAlbum} />
        </section>
      ) : null}

      {page.appearsOn.length ? (
        <section className="artist-section">
          <h3 className="shelf-title">Appears on</h3>
          <AlbumShelf albums={page.appearsOn} tracksFor={tracksFor} onOpen={onOpenAlbum} onPlay={onPlayAlbum} showArtist />
        </section>
      ) : null}

      {list.length ? (
        <section className="artist-section">
          <h3 className="shelf-title">{list.length === 1 ? 'Song' : 'Songs'}</h3>
          <SongRows rows={visibleSongs} list={list} artist={page.name} plays={totals} songCovers={songCovers} onTrackMenu={onTrackMenu} />
          {visibleSongs.length < list.length ? (
            <button className="text-btn artist-more" onClick={() => setShowAll(true)}>
              Show all {list.length} songs
            </button>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

function AlbumShelf({
  albums,
  tracksFor,
  onOpen,
  onPlay,
  showArtist = false,
}: {
  albums: Album[];
  tracksFor: (album: Album) => Track[];
  onOpen: (albumId: string) => void;
  onPlay: (album: Album) => void;
  showArtist?: boolean;
}) {
  const player = usePlayer();
  return (
    <div className="album-shelf">
      {albums.map((album, index) => {
        const songs = tracksFor(album);
        const year = albumYear(songs);
        const playingHere = player.playing && songs.some((track) => track.id === player.track?.id);
        return (
          <div className="shelf-card" key={album.id} data-album-id={album.id} style={{ ['--i' as string]: index }}>
            <div className="shelf-art-wrap">
              <button className="card-open shelf-open" onClick={() => onOpen(album.id)} aria-label={album.name}>
                <Cover fileId={album.coverFileId} hue={album.hue} radius={22} className="card-cover" />
              </button>
              <button className="card-play shelf-play" aria-label={playingHere ? `Pause ${album.name}` : `Play ${album.name}`} onClick={() => onPlay(album)}>
                {playingHere ? <Pause size={14} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
              </button>
            </div>
            <button className="card-title shelf-title-btn" onClick={() => onOpen(album.id)}>
              {album.name}
            </button>
            <div className="shelf-sub">
              {showArtist ? album.artist : year ? String(year) : plural(songs.length, 'song')}
              {showArtist && year ? ` · ${year}` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SongRows({
  rows,
  list,
  artist,
  plays,
  songCovers,
  onTrackMenu,
}: {
  rows: Track[];
  list: Track[];
  artist: string;
  plays: Map<string, { plays: number }>;
  songCovers: boolean;
  onTrackMenu: (track: Track, at: Point, list: Track[]) => void;
}) {
  const player = usePlayer();
  const offline = useOffline();
  const online = useOnline();
  const { albums } = useLibrary();
  const byId = useMemo(() => new Map(albums.map((album) => [album.id, album])), [albums]);
  return (
    <div className="track-list">
      {rows.map((track, index) => {
        const active = player.track?.id === track.id;
        const unavailable = !online && !offline.isSaved(track.id);
        const album = track.albumId ? byId.get(track.albumId) : undefined;
        const count = plays.get(track.id)?.plays ?? 0;
        // Other artists on the song are links; the artist whose page this is goes without saying.
        const others = trackArtists(track).some((name) => artistKey(name) !== artistKey(artist));
        return (
          <div className={`track art-track${active ? ' active' : ''}${unavailable ? ' unavailable' : ''}`} key={track.id} onContextMenu={(event) => onTrackMenu(track, atPointer(event), list)}>
            <button className="track-hit" disabled={unavailable} onClick={() => (active ? player.toggle() : player.playTracks(list, Math.max(0, list.indexOf(track))))}>
              <span className="track-num">{active ? <AudioLines size={15} /> : index + 1}</span>
              <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="smart-track-art" radius={8} />
              <span className="track-copy">
                <span className="track-title">{track.title}</span>
                <span className="track-sub">
                  {others ? (
                    <>
                      <ArtistLinks artist={track.artist} />
                      {album?.kind === 'album' ? ' · ' : ''}
                    </>
                  ) : null}
                  {album?.kind === 'album' ? <AlbumLink album={album} /> : null}
                  {count ? ` · ${plural(count, 'play')}` : ''}
                </span>
              </span>
            </button>
            <span className="track-dur art-dur">
              <OfflineBadge trackId={track.id} />
              {formatTrackTime(track.durationMs)}
            </span>
            <button className="ghost-more track-more" aria-label={`Options for ${track.title}`} onClick={(event) => onTrackMenu(track, below(event.currentTarget, 'right'), list)}>
              <MoreHorizontal size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
