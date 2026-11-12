import { useMemo, useState } from 'react';
import { BarChart3, Flame, Headphones, Play } from 'lucide-react';
import { coverFor } from '../lib/covers';
import { formatTotal, plural } from '../lib/format';
import { resetStats, summarise, type Period, type Ranked } from '../lib/stats';
import { useStatsDays } from '../state/useStatsDays';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { useSettings } from '../state/SettingsProvider';
import { Cover } from './Cover';
import { ConfirmDialog } from './overlays';
import { Presence } from './Presence';

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
];

const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'narrow' });
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dateOf = (day: string) => new Date(`${day}T00:00:00`);

export function StatsView({ notify }: { notify: (message: string) => void }) {
  const library = useLibrary();
  const player = usePlayer();
  const { songCovers } = useSettings();
  const { days, failed } = useStatsDays();
  const [period, setPeriod] = useState<Period>('7d');
  const [confirmReset, setConfirmReset] = useState(false);

  const summary = useMemo(() => {
    if (!days) return null;
    return summarise(days, period, new Date(), {
      trackIds: new Set(library.tracks.map((track) => track.id)),
      albumNames: new Map(library.albums.map((album) => [album.id, album.name])),
    });
  }, [days, period, library.tracks, library.albums]);

  const tracksById = useMemo(() => new Map(library.tracks.map((track) => [track.id, track])), [library.tracks]);
  const albumsById = useMemo(() => new Map(library.albums.map((album) => [album.id, album])), [library.albums]);
  const peak = summary ? Math.max(1, ...summary.daily.map((day) => day.ms)) : 1;
  const empty = summary !== null && summary.plays === 0 && summary.ms === 0;

  const songArt = (item: Ranked) => {
    const track = item.trackId ? tracksById.get(item.trackId) : undefined;
    if (!track) return <span className="stats-art removed" />;
    const album = track.albumId ? albumsById.get(track.albumId) : undefined;
    return <Cover fileId={coverFor(track, album, songCovers)} hue={album?.hue ?? track.hue} className="stats-art" radius={8} />;
  };
  const albumArt = (item: Ranked) => {
    const album = item.albumId ? albumsById.get(item.albumId) : undefined;
    if (!album) return <span className="stats-art removed" />;
    return <Cover fileId={album.coverFileId} hue={album.hue} className="stats-art" radius={8} />;
  };

  const list = (title: string, items: Ranked[], kind: 'song' | 'artist' | 'album') => (
    <section className="settings-group">
      <h2>{title}</h2>
      <div className="stats-list">
        {items.length ? (
          items.map((item, rank) => {
            const track = kind === 'song' && item.trackId ? tracksById.get(item.trackId) : undefined;
            const content = (
              <>
                <span className="stats-rank">{rank + 1}</span>
                {kind === 'song' ? songArt(item) : kind === 'album' ? albumArt(item) : null}
                <span className="stats-names">
                  <span className="stats-name">{item.title || 'Unknown'}</span>
                  <span className="stats-sub">
                    {item.removed ? 'Removed from your library' : kind === 'artist' ? formatTotal(item.ms) : item.subtitle || formatTotal(item.ms)}
                  </span>
                </span>
                <span className="stats-count">{plural(item.plays, 'play')}</span>
              </>
            );
            return track ? (
              <button key={item.key} className="stats-item" onClick={() => player.playTracks([track], 0)} aria-label={`Play ${item.title}`}>
                {content}
              </button>
            ) : (
              <div key={item.key} className={item.removed ? 'stats-item removed' : 'stats-item'}>
                {content}
              </div>
            );
          })
        ) : (
          <div className="stats-none">Nothing yet for this period.</div>
        )}
      </div>
    </section>
  );

  return (
    <main className="stage settings-page stats-page">
      <h1 className="settings-title">Listening stats</h1>
      <div className="segmented stats-period" role="radiogroup" aria-label="Period">
        {PERIODS.map((item) => (
          <button key={item.id} role="radio" aria-checked={period === item.id} className={period === item.id ? 'on' : ''} onClick={() => setPeriod(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      {failed ? <p className="empty-note">Your stats could not be opened on this device.</p> : null}
      {!summary && !failed ? <p className="empty-note">Adding up your listening</p> : null}

      {summary ? (
        <>
          <div className="stats-cards">
            <div className="stats-card">
              <Headphones size={18} />
              <div className="stats-value">{formatTotal(summary.ms)}</div>
              <div className="stats-label">Listening time</div>
            </div>
            <div className="stats-card">
              <Play size={18} />
              <div className="stats-value">{summary.plays.toLocaleString('en-GB')}</div>
              <div className="stats-label">{summary.plays === 1 ? 'Play' : 'Plays'}</div>
            </div>
            <div className="stats-card">
              <Flame size={18} />
              <div className="stats-value">{plural(summary.streak, 'day')}</div>
              <div className="stats-label">Streak</div>
            </div>
          </div>

          <section className="settings-group">
            <h2>Listening per day</h2>
            <div className="stats-chart-card">
              {empty ? (
                <div className="stats-none">
                  <BarChart3 size={20} /> Play some music and it shows up here. A song counts as played after 30 seconds.
                </div>
              ) : null}
              <div className={`stats-chart${summary.daily.length > 14 ? ' dense' : ''}`} role="img" aria-label={`Listening per day, ${PERIODS.find((item) => item.id === period)!.label}`}>
                {summary.daily.map((day) => (
                  <div key={day.day} className="stats-bar" title={`${SHORT_DATE.format(dateOf(day.day))}: ${formatTotal(day.ms)}, ${plural(day.plays, 'play')}`}>
                    <span style={{ height: `${Math.max(day.ms > 0 ? 4 : 0, (day.ms / peak) * 100)}%` }} />
                  </div>
                ))}
              </div>
              <div className="stats-axis">
                {summary.daily.length <= 7 ? (
                  summary.daily.map((day) => <span key={day.day}>{WEEKDAY.format(dateOf(day.day))}</span>)
                ) : (
                  <>
                    <span>{SHORT_DATE.format(dateOf(summary.daily[0]!.day))}</span>
                    <span>Today</span>
                  </>
                )}
              </div>
              <div className="stats-foot">
                {plural(summary.activeDays, 'day')} with music · busiest {formatTotal(Math.max(0, ...summary.daily.map((day) => day.ms)))}
              </div>
            </div>
          </section>

          {list('Top songs', summary.songs, 'song')}
          {list('Top artists', summary.artists, 'artist')}
          {list('Top albums', summary.albums, 'album')}

          <section className="settings-group">
            <h2>Data</h2>
            <div className="settings-row">
              <div>
                <div className="settings-label">Reset stats</div>
                <div className="settings-hint">Stats are kept only on this device. Resetting deletes every play and all listening time.</div>
              </div>
              <button className="danger-btn" onClick={() => setConfirmReset(true)} disabled={!days?.length}>
                Reset
              </button>
            </div>
          </section>
        </>
      ) : null}

      <Presence show={confirmReset}>
        <ConfirmDialog
          title="Reset listening stats?"
          body="Every play and all listening time recorded on this device will be deleted. This cannot be undone."
          confirm="Reset stats"
          onCancel={() => setConfirmReset(false)}
          onConfirm={() => {
            setConfirmReset(false);
            resetStats().then(
              () => notify('Listening stats reset'),
              () => notify('Stats could not be reset'),
            );
          }}
        />
      </Presence>
    </main>
  );
}
