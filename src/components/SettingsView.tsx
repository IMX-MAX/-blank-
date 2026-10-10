import { useAuth } from '../state/AuthProvider';
import { useLibrary } from '../state/LibraryProvider';
import { useOffline } from '../state/OfflineProvider';
import { useSettings, type ThemeChoice } from '../state/SettingsProvider';
import { formatBytes, plural } from '../lib/format';

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

export function SettingsView({
  onNewPlaylist,
  onRemoveDownloads,
  onSignOut,
}: {
  onNewPlaylist: () => void;
  onRemoveDownloads: () => void;
  onSignOut: () => void;
}) {
  const { user } = useAuth();
  const library = useLibrary();
  const offline = useOffline();
  const { theme, setTheme, songCovers, setSongCovers } = useSettings();

  return (
    <main className="stage settings-page">
      <h1 className="settings-title">Settings</h1>

      <section className="settings-group">
        <h2>Appearance</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">Theme</div>
            <div className="settings-hint">Switch between light and dark.</div>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Theme">
            {THEMES.map((item) => (
              <button
                key={item.id}
                role="radio"
                aria-checked={theme === item.id}
                className={theme === item.id ? 'on' : ''}
                onClick={() => setTheme(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2>Playback</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">Show each song&rsquo;s own cover</div>
            <div className="settings-hint">
              In the playback bar and the full player, use the song&rsquo;s cover instead of the album&rsquo;s when it has one.
            </div>
          </div>
          <button
            className={songCovers ? 'switch on' : 'switch'}
            role="switch"
            aria-checked={songCovers}
            aria-label="Show each song's own cover"
            onClick={() => setSongCovers(!songCovers)}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2>Library</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">{plural(library.tracks.length, 'song')}</div>
            <div className="settings-hint">
              {offline.count
                ? `${plural(offline.count, 'song')} saved on this device · ${formatBytes(offline.bytes)}`
                : 'Right-click or long-press a song or album to make it available offline.'}
            </div>
          </div>
          {offline.count ? (
            <button className="pill-btn" onClick={onRemoveDownloads}>
              Remove downloads
            </button>
          ) : null}
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-label">Playlists</div>
            <div className="settings-hint">Collect songs from anywhere in your library.</div>
          </div>
          <button className="pill-btn" onClick={onNewPlaylist}>
            New playlist
          </button>
        </div>
      </section>

      <section className="settings-group">
        <h2>Account</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">{user?.name || 'Listener'}</div>
            <div className="settings-hint">{user?.email}</div>
          </div>
          <button className="pill-btn" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
