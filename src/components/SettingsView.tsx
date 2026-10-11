import { useCallback, useEffect, useRef, useState } from 'react';
import { LOCAL_ONLY } from '../config';
import { EQ_FLAT, isFlat } from '../lib/audio-engine';
import type { GlyphMode } from '../lib/glyph';
import { EqualizerGraph } from './EqualizerGraph';
import { useAuth } from '../state/AuthProvider';
import { useLibrary } from '../state/LibraryProvider';
import { useOffline } from '../state/OfflineProvider';
import { useSettings, type ThemeChoice } from '../state/SettingsProvider';
import { formatBytes, plural } from '../lib/format';
import { clearSavedLyrics, onSavedLyricsChange, saveLyricsFor, savedLyricsTrackIds, type CacheSummary } from '../lib/lyrics-store';

function summaryText(summary: CacheSummary): string {
  if (summary.offline) return `Stopped: couldn\u2019t reach the lyrics services. Saved ${summary.saved}.`;
  const parts = [`Saved lyrics for ${plural(summary.saved, 'song')}`];
  if (summary.missing) parts.push(`${summary.missing} had none`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  return `${parts.join(' \u00b7 ')}.`;
}

function LyricsSettings() {
  const library = useLibrary();
  const { cacheLyrics, setCacheLyrics } = useSettings();
  const [saved, setSaved] = useState(0);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const { tracks, albums } = library;

  const refresh = useCallback(() => {
    savedLyricsTrackIds(tracks)
      .then((ids) => setSaved(ids.size))
      .catch(() => setSaved(0));
  }, [tracks]);

  useEffect(() => {
    refresh();
    return onSavedLyricsChange(refresh);
  }, [refresh]);

  useEffect(() => () => abort.current?.abort(), []);

  const download = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setResult(null);
    setProgress({ done: 0, total: 0 });
    try {
      const summary = await saveLyricsFor(tracks, albums, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      if (!controller.signal.aborted) setResult(summaryText(summary));
    } finally {
      abort.current = null;
      setProgress(null);
      refresh();
    }
  };

  const clear = async () => {
    await clearSavedLyrics().catch(() => undefined);
    setResult(null);
  };

  return (
    <section className="settings-group">
      <h2>Lyrics</h2>
      <div className="settings-row">
        <div>
          <div className="settings-label">Save lyrics for offline</div>
          <div className="settings-hint">Keep the lyrics of every song you open on this phone, so they show with no connection.</div>
        </div>
        <button
          className={cacheLyrics ? 'switch on' : 'switch'}
          role="switch"
          aria-checked={cacheLyrics}
          aria-label="Save lyrics for offline"
          onClick={() => setCacheLyrics(!cacheLyrics)}
        >
          <span />
        </button>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-label">
            {saved} of {plural(tracks.length, 'song')} saved
          </div>
          <div className="settings-hint">
            {progress
              ? progress.total
                ? `Looking up lyrics\u2026 ${progress.done} of ${progress.total}`
                : 'Looking up lyrics\u2026'
              : (result ?? 'Look up lyrics for your whole library now, while you are online.')}
          </div>
        </div>
        <div className="settings-actions">
          {progress ? (
            <button className="pill-btn" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <>
              {saved ? (
                <button className="pill-btn" onClick={() => void clear()}>
                  Clear
                </button>
              ) : null}
              <button className="pill-btn" disabled={!tracks.length || saved >= tracks.length} onClick={() => void download()}>
                Save all
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const GLYPH_MODES: Array<{ id: GlyphMode; label: string; hint: string }> = [
  { id: 'waveform', label: 'Waveform', hint: 'A slice of the waveform scrolls past the playhead.' },
  { id: 'lyrics', label: 'Lyrics', hint: 'The line being sung scrolls across as it plays. Falls back to the waveform when there are no synced lyrics.' },
  { id: 'pulse', label: 'Pulse', hint: 'Flashes and pulses to the beat. Falls back to the waveform while the song is being analysed.' },
];

function SoundSettings() {
  const { eq, setEq, crossfade, setCrossfade } = useSettings();
  const lastFade = useRef(6);
  if (crossfade > 0) lastFade.current = crossfade;
  return (
    <section className="settings-group">
      <h2>Sound</h2>
      <div className="settings-row settings-eq">
        <div>
          <div className="settings-label">Equalizer</div>
          <div className="settings-hint">Drag the three points to shape the sound of everything you play.</div>
        </div>
        {!isFlat(eq) ? (
          <button className="pill-btn" onClick={() => setEq(EQ_FLAT)}>
            Reset
          </button>
        ) : null}
        <EqualizerGraph value={eq} onChange={setEq} />
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-label">Crossfade</div>
          <div className="settings-hint">Fade the end of a song into the start of the next one.</div>
        </div>
        <button
          className={crossfade > 0 ? 'switch on' : 'switch'}
          role="switch"
          aria-checked={crossfade > 0}
          aria-label="Crossfade"
          onClick={() => setCrossfade(crossfade > 0 ? 0 : lastFade.current)}
        >
          <span />
        </button>
        {crossfade > 0 ? (
          <label className="settings-slider">
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={crossfade}
              aria-label="Crossfade length"
              onChange={(event) => setCrossfade(Number(event.target.value))}
            />
            <span>{crossfade} s</span>
          </label>
        ) : null}
      </div>
    </section>
  );
}

const THEMES: Array<{ id: ThemeChoice; label: string }> = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
  { id: 'system', label: 'System' },
];

export function SettingsView({
  onNewPlaylist,
  onRemoveDownloads,
  onSignOut,
  onChangeName,
}: {
  onNewPlaylist: () => void;
  onRemoveDownloads: () => void;
  onSignOut: () => void;
  onChangeName: () => void;
}) {
  const { user } = useAuth();
  const library = useLibrary();
  const offline = useOffline();
  const {
    theme,
    setTheme,
    songCovers,
    setSongCovers,
    glyphSupported,
    glyphWaveform,
    setGlyphWaveform,
    glyphMode,
    setGlyphMode,
    vibrateSupported,
    vibrate,
    setVibrate,
  } = useSettings();

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
        {glyphSupported ? (
          <>
            <div className="settings-row">
              <div>
                <div className="settings-label">Show on the Glyph Matrix</div>
                <div className="settings-hint">
                  Draws what is playing on the back of your phone. A Glyph Toy you switch to takes over the display.
                </div>
              </div>
              <button
                className={glyphWaveform ? 'switch on' : 'switch'}
                role="switch"
                aria-checked={glyphWaveform}
                aria-label="Show on the Glyph Matrix"
                onClick={() => setGlyphWaveform(!glyphWaveform)}
              >
                <span />
              </button>
              {glyphWaveform ? (
                <div className="settings-sub">
                  <div className="segmented" role="radiogroup" aria-label="Glyph Matrix visual">
                    {GLYPH_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        role="radio"
                        aria-checked={glyphMode === mode.id}
                        className={glyphMode === mode.id ? 'on' : ''}
                        onClick={() => setGlyphMode(mode.id)}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <div className="settings-hint">{GLYPH_MODES.find((mode) => mode.id === glyphMode)?.hint}</div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {vibrateSupported ? (
          <div className="settings-row">
            <div>
              <div className="settings-label">Vibrate to the beat</div>
              <div className="settings-hint">Taps the vibration motor on the hits of the song while it plays.</div>
            </div>
            <button
              className={vibrate ? 'switch on' : 'switch'}
              role="switch"
              aria-checked={vibrate}
              aria-label="Vibrate to the beat"
              onClick={() => setVibrate(!vibrate)}
            >
              <span />
            </button>
          </div>
        ) : null}
      </section>

      <SoundSettings />

      {LOCAL_ONLY ? <LyricsSettings /> : null}

      <section className="settings-group">
        <h2>Library</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">{plural(library.tracks.length, 'song')}</div>
            <div className="settings-hint">
              {LOCAL_ONLY
                ? 'Stored on this phone.'
                : offline.count
                  ? `${plural(offline.count, 'song')} saved on this device · ${formatBytes(offline.bytes)}`
                  : 'Right-click or long-press a song or album to make it available offline.'}
            </div>
          </div>
          {!LOCAL_ONLY && offline.count ? (
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
        <h2>{LOCAL_ONLY ? 'Profile' : 'Account'}</h2>
        <div className="settings-row">
          <div>
            <div className="settings-label">{user?.name || 'Listener'}</div>
            <div className="settings-hint">{LOCAL_ONLY ? 'Your profile on this phone' : user?.email}</div>
          </div>
          <button className="pill-btn" onClick={LOCAL_ONLY ? onChangeName : onSignOut}>
            {LOCAL_ONLY ? 'Change name' : 'Sign out'}
          </button>
        </div>
      </section>
    </main>
  );
}
