import { useEffect, useState } from 'react';
import { Download, Pause, Play, Shuffle } from 'lucide-react';
import { formatTotal, formatTrackTime, plural } from '../lib/format';
import { youtubeAlbum, YoutubeError } from '../lib/youtube-client';
import { importedTrackId, trackFromYoutube, type YtAlbum, type YtSong } from '../lib/youtube';
import { useLibrary } from '../state/LibraryProvider';
import { usePlayer } from '../state/PlayerProvider';
import { Cover } from './Cover';

export function YoutubeAlbumView({ album }: { album: YtAlbum }) {
  const library = useLibrary();
  const player = usePlayer();
  const [tracks, setTracks] = useState<YtSong[]>([]);
  const [page, setPage] = useState(album);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    void youtubeAlbum(album, controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setPage(next.album);
        setTracks(next.tracks);
        setStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setStatus('error');
        setMessage(error instanceof YoutubeError ? error.message : "Couldn't open that album");
      });
    return () => controller.abort();
  }, [album]);

  const onDevice = (song: YtSong) => {
    void savedTick;
    const id = importedTrackId(song.videoId);
    return Boolean(id && library.tracks.some((track) => track.id === id));
  };

  const playable = (song: YtSong) => {
    const id = importedTrackId(song.videoId);
    return library.tracks.find((track) => track.id === id) ?? trackFromYoutube(song);
  };

  const list = tracks.map(playable);
  const playingHere = list.some((track) => track.id === player.track?.id);

  const downloadAll = async () => {
    const pending = tracks.filter((song) => !onDevice(song));
    if (!pending.length || busy) return;
    setBusy(true);
    setMessage('');
    let failed = 0;
    for (const song of pending) {
      try {
        await library.saveYoutubeSong(song);
        setSavedTick((tick) => tick + 1);
      } catch {
        failed += 1;
      }
    }
    setBusy(false);
    setMessage(failed ? `${failed} of ${pending.length} songs could not be downloaded` : 'Saved on this device');
  };

  return (
    <main className="album yt-album-page">
      <section className="album-main">
        <div className="album-heading">
          <Cover fileId={null} src={page.thumbnail || null} radius={28} className="yt-page-art" />
          <div>
            <h2 className="album-title">{page.title}</h2>
            <p className="album-meta">
              {page.artist || 'YouTube Music'}
              {page.year ? ` · ${page.year}` : ''} · {plural(tracks.length, 'track')}
              {tracks.length ? ` · ${formatTotal(tracks.reduce((sum, song) => sum + song.durationMs, 0))}` : ''}
            </p>
          </div>
          <div className="play-cluster">
            <button
              className={player.shuffle ? 'shuffle-btn on' : 'shuffle-btn'}
              aria-label="Shuffle"
              disabled={!tracks.length}
              onClick={() => player.shuffleTracks(list)}
            >
              <Shuffle size={18} />
            </button>
            <button
              className="big-play"
              aria-label={playingHere && player.playing ? 'Pause' : 'Play'}
              disabled={!tracks.length}
              onClick={() => (playingHere ? player.toggle() : player.playTracks(list))}
            >
              {playingHere && player.playing ? <Pause size={22} fill="currentColor" strokeWidth={0} /> : <Play size={22} fill="currentColor" strokeWidth={0} />}
            </button>
          </div>
        </div>
        <button className="add-tracks" disabled={busy || !tracks.some((song) => !onDevice(song))} onClick={() => void downloadAll()}>
          <Download size={16} /> {busy ? 'Downloading…' : 'Download for offline'}
        </button>
        {status === 'loading' ? <p className="empty-note album-empty">Opening album</p> : null}
        {status === 'error' ? <p className="empty-note album-empty">{message}</p> : null}
        <div className="track-list">
          {tracks.map((song, index) => {
            const track = playable(song);
            const active = player.track?.id === track.id;
            return (
              <div key={song.videoId} className={`track${active ? ' active' : ''}`}>
                <button className="track-hit" onClick={() => (active ? player.toggle() : player.playTracks(list, index))}>
                  <span className="track-num">{song.trackNumber ?? index + 1}</span>
                  <span className="track-copy">
                    <span className="track-title">{song.title}</span>
                    <span className="track-sub">
                      {song.artist || page.artist || 'Unknown artist'}
                      {onDevice(song) ? ' · On this device' : ''}
                    </span>
                  </span>
                </button>
                <span className="track-dur">{formatTrackTime(song.durationMs)}</span>
                <button
                  className="ghost-more track-more"
                  aria-label={`Download ${song.title}`}
                  disabled={onDevice(song) || busy}
                  onClick={() =>
                    void library.saveYoutubeSong(song).then(
                      () => {
                        setSavedTick((tick) => tick + 1);
                        setMessage(`Saved “${song.title}” on this device`);
                      },
                      (error) => setMessage(error instanceof Error ? error.message : 'Could not download that song'),
                    )
                  }
                >
                  <Download size={16} />
                </button>
              </div>
            );
          })}
        </div>
        {message ? <p className="yt-status">{message}</p> : null}
      </section>
    </main>
  );
}
