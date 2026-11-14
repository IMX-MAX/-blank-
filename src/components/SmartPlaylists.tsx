import { memo, useMemo, useState, type ComponentType } from 'react';
import { AudioLines, CalendarPlus, CircleDashed, History, Hourglass, MoreHorizontal, Pause, Play, Shuffle, TrendingUp } from 'lucide-react';
import { coverFor } from '../lib/covers';
import { formatTotal, plural } from '../lib/format';
import { mosaicCovers, mosaicKey, mosaicLayout } from '../lib/mosaic';
import { SMART_PLAYLISTS, buildSmartPlaylist, type SmartDefinition, type SmartId, type SmartWindow } from '../lib/smart-playlists';
import { songTotals } from '../lib/stats';
import { useLibrary } from '../state/LibraryProvider';
import { useOffline, useOnline } from '../state/OfflineProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import { useStatsDays } from '../state/useStatsDays';
import type { Track } from '../types';
import { ArtistLinks } from './ArtistLinks';
import { Cover } from './Cover';
import { OfflineBadge } from './OfflineBadge';
import { atPointer, below, type Point } from './overlays';

const ICONS: Record<SmartId, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  'most-played': TrendingUp,
  'recently-added': CalendarPlus,
  'recently-played': History,
  'never-played': CircleDashed,
  forgotten: Hourglass,
};

const WINDOW_KEY = 'blank.smartWindow';

/** Every smart playlist's songs, recomputed as the library, the history and the stats change. */
export function useSmartPlaylists(period: SmartWindow = 'all') {
  const { tracks, albums } = useLibrary();
  const { history } = usePlayer();
  const { days } = useStatsDays();
  return useMemo(() => {
    const context = { tracks, days: days ?? [], history: history.map((track) => track.id), window: period };
    const lists = Object.fromEntries(SMART_PLAYLISTS.map((item) => [item.id, buildSmartPlaylist(item.id, context)])) as Record<SmartId, Track[]>;
    // Album covers, so songs from one album count once in the mosaic.
    const albumsById = new Map(albums.map((album) => [album.id, album]));
    const coverOf = (track: Track) => coverFor(track, track.albumId ? albumsById.get(track.albumId) : undefined, false);
    const covers = Object.fromEntries(SMART_PLAYLISTS.map((item) => [item.id, mosaicCovers(lists[item.id], coverOf)])) as Record<SmartId, string[]>;
    return { lists, covers, days: days ?? [], ready: days !== null };
  }, [tracks, albums, days, history, period]);
}

/**
 * A smart playlist's cover, drawn like the app's album covers: a squircle tile of up to four album covers from its
 * songs with fine gaps, a wash of the playlist's colour from one corner, and a frosted badge saying which smart
 * playlist it is. With no songs that have art it is the playlist's colour with its icon. Covers come from the
 * app's cover cache, and the mosaic only re-renders when the covers shown change.
 */
export const SmartArt = memo(
  function SmartArt({ item, covers = [], className }: { item: SmartDefinition; covers?: string[]; className?: string }) {
    const Icon = ICONS[item.id];
    const layout = mosaicLayout(covers.length);
    const style = { ['--hue' as string]: item.hue };
    if (layout === 'none') {
      return (
        <span className={`smart-art empty ${className ?? ''}`} style={style} aria-hidden>
          <span className="smart-empty-icon">
            <Icon size={34} strokeWidth={1.7} />
          </span>
        </span>
      );
    }
    return (
      <span className={`smart-art mosaic ${className ?? ''}`} style={style} aria-hidden>
        <span className={`mosaic-grid ${layout}`}>
          {covers.map((fileId) => (
            <Cover key={fileId} fileId={fileId} className="mosaic-tile" radius={0} />
          ))}
        </span>
        <span className="mosaic-wash" />
        <span className="smart-badge">
          <Icon size={15} strokeWidth={2.2} />
        </span>
      </span>
    );
  },
  (a, b) => a.item === b.item && a.className === b.className && mosaicKey(a.covers ?? []) === mosaicKey(b.covers ?? []),
);

/** The row of smart playlists at the top of the library, as cards like the albums below them. */
export function SmartShelf({ onOpen }: { onOpen: (id: SmartId) => void }) {
  const player = usePlayer();
  const { lists, covers } = useSmartPlaylists((localStorage.getItem(WINDOW_KEY) as SmartWindow) || 'all');
  return (
    <section className="smart-shelf" aria-label="Smart playlists">
      <h2 className="shelf-title">Smart playlists</h2>
      <div className="smart-row">
        {SMART_PLAYLISTS.map((item, index) => {
          const list = lists[item.id];
          const playingHere = player.playing && list.some((track) => track.id === player.track?.id);
          return (
            <div key={item.id} className="smart-card" style={{ ['--i' as string]: index }}>
              <div className="smart-art-wrap">
                <button className="smart-open" onClick={() => onOpen(item.id)} aria-label={`${item.name}, ${plural(list.length, 'song')}`}>
                  <SmartArt item={item} covers={covers[item.id]} />
                </button>
                {list.length ? (
                  <button
                    className="card-play smart-play"
                    aria-label={playingHere ? `Pause ${item.name}` : `Play ${item.name}`}
                    onClick={() => (playingHere ? player.toggle() : player.playTracks(list))}
                  >
                    {playingHere ? <Pause size={13} fill="currentColor" strokeWidth={0} /> : <Play size={14} fill="currentColor" strokeWidth={0} />}
                  </button>
                ) : null}
              </div>
              <button className="card-title smart-title" onClick={() => onOpen(item.id)} tabIndex={-1}>
                {item.name}
              </button>
              <div className="smart-sub">{list.length ? plural(list.length, 'song') : 'Empty for now'}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** One smart playlist: play, shuffle, and its songs, updating as you listen. */
export function SmartPlaylistView({ id, onTrackMenu }: { id: SmartId; onTrackMenu: (track: Track, at: Point, list: Track[]) => void }) {
  const item = SMART_PLAYLISTS.find((entry) => entry.id === id)!;
  const player = usePlayer();
  const offline = useOffline();
  const online = useOnline();
  const { albums } = useLibrary();
  const { songCovers } = useSettings();
  const [period, setWindowState] = useState<SmartWindow>(() => (localStorage.getItem(WINDOW_KEY) === '30d' ? '30d' : 'all'));
  const setWindow = (next: SmartWindow) => {
    localStorage.setItem(WINDOW_KEY, next);
    setWindowState(next);
  };
  const { lists, covers, days, ready } = useSmartPlaylists(period);
  const list = lists[id];
  const totals = useMemo(() => (id === 'most-played' || id === 'forgotten' ? songTotals(days, period === '30d' && id === 'most-played' ? { withinDays: 30 } : {}) : null), [days, id, period]);
  const albumsById = useMemo(() => new Map(albums.map((album) => [album.id, album])), [albums]);
  const totalMs = list.reduce((sum, track) => sum + track.durationMs, 0);
  const inQueue = list.some((track) => track.id === player.track?.id);
  const playingHere = inQueue && player.playing;

  return (
    <main className="album smart-page">
      <div className="album-cover-btn smart-cover">
        <SmartArt item={item} covers={covers[id]} className="large" />
      </div>
      <section className="album-main">
        <div className="album-heading">
          <div>
            <h2 className="album-title">{item.name}</h2>
            <p className="album-meta">
              {item.description} · {plural(list.length, 'song')}
              {list.length ? ` · ${formatTotal(totalMs)}` : ''}
            </p>
          </div>
          <div className="play-cluster">
            <button className={player.shuffle ? 'shuffle-btn on' : 'shuffle-btn'} aria-label="Shuffle" disabled={!list.length} onClick={() => player.shuffleTracks(list)}>
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
        </div>
        {id === 'most-played' ? (
          <div className="segmented smart-period" role="radiogroup" aria-label="Period">
            <button role="radio" aria-checked={period === '30d'} className={period === '30d' ? 'on' : ''} onClick={() => setWindow('30d')}>
              Last 30 days
            </button>
            <button role="radio" aria-checked={period === 'all'} className={period === 'all' ? 'on' : ''} onClick={() => setWindow('all')}>
              All time
            </button>
          </div>
        ) : null}
        <p className="smart-note">Updates by itself as you listen and add music.</p>
        {!list.length && ready ? <p className="empty-note smart-empty">{item.empty}</p> : null}
        <div className="track-list">
          {list.map((track, index) => {
            const active = player.track?.id === track.id;
            const unavailable = !online && !offline.isSaved(track.id);
            const album = track.albumId ? albumsById.get(track.albumId) : undefined;
            const plays = totals?.get(track.id)?.plays;
            return (
              <div className={`track smart-track${active ? ' active' : ''}${unavailable ? ' unavailable' : ''}`} key={track.id} onContextMenu={(event) => onTrackMenu(track, atPointer(event), list)}>
                <button className="track-hit" disabled={unavailable} onClick={() => (active ? player.toggle() : player.playTracks(list, index))}>
                  <span className="track-num">{active ? <AudioLines size={15} /> : index + 1}</span>
                  <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="smart-track-art" radius={8} />
                  <span className="track-copy">
                    <span className="track-title">{track.title}</span>
                    <span className="track-sub">
                      <ArtistLinks artist={track.artist} />
                      {plays ? ` · ${plural(plays, 'play')}` : ''}
                    </span>
                  </span>
                </button>
                <OfflineBadge trackId={track.id} />
                <button className="ghost-more track-more" aria-label={`Options for ${track.title}`} onClick={(event) => onTrackMenu(track, below(event.currentTarget, 'right'), list)}>
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
